"""Chat API routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from pydantic.alias_generators import to_camel
from sqlalchemy import select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission, require_app_access
from app.constants import SHERLOCK_CHAT_SOURCE
from app.database import get_db
from app.models.chat import ChatSession, ChatMessage
from app.schemas.chat import (
    SessionCreate, SessionUpdate, SessionResponse,
    MessageCreate, MessageUpdate, MessageResponse, ChatSearchHit,
)


_SNIPPET_WINDOW = 42


def _snippet(content: str, term: str, window: int = _SNIPPET_WINDOW) -> str:
    """A short text window around the first case-insensitive match of `term`."""
    lowered = content.lower()
    idx = lowered.find(term.lower())
    if idx == -1:
        head = content[: window * 2].strip()
        return head + ("…" if len(content) > window * 2 else "")
    start = max(0, idx - window)
    end = min(len(content), idx + len(term) + window)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(content) else ""
    return f"{prefix}{content[start:end].strip()}{suffix}"


class TagRenameRequest(BaseModel):
    old_tag: str
    new_tag: str
    model_config = {"alias_generator": to_camel, "populate_by_name": True}


class TagDeleteRequest(BaseModel):
    tag: str

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _owned_session_query(*, session_id: UUID, auth: AuthContext, app_id: str):
    return select(ChatSession).where(
        ChatSession.id == session_id,
        ChatSession.tenant_id == auth.tenant_id,
        ChatSession.user_id == auth.user_id,
        ChatSession.app_id == app_id,
    )


# Session endpoints
@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    app_id: str = Query(...),
    source: str | None = Query(None),
    search: str | None = Query(None, alias="q"),
    limit: int | None = Query(None, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """List chat sessions for an app, newest first.

    Optional ``source`` filter (e.g. 'sherlock'). Optional ``q`` matches the
    session title OR any message body in the session (user + assistant text),
    both ILIKE and trigram-indexed. ``limit``/``offset`` page the result.
    """
    query = (
        select(ChatSession)
        .where(
            ChatSession.tenant_id == auth.tenant_id,
            ChatSession.user_id == auth.user_id,
            ChatSession.app_id == app_id,
        )
        .order_by(desc(ChatSession.updated_at))
    )
    if source:
        query = query.where(ChatSession.server_session_id == source)
    else:
        query = query.where(ChatSession.server_session_id.is_distinct_from(SHERLOCK_CHAT_SOURCE))

    term = (search or "").strip()
    if term:
        pattern = f"%{term}%"
        message_hit = (
            select(ChatMessage.id)
            .where(
                ChatMessage.session_id == ChatSession.id,
                ChatMessage.content.ilike(pattern),
            )
            .exists()
        )
        query = query.where(or_(ChatSession.title.ilike(pattern), message_hit))

    if limit is not None:
        query = query.limit(limit)
    query = query.offset(offset)
    result = await db.execute(query)
    return result.scalars().all()


# Declared before /sessions/{session_id} so "search" is not parsed as a UUID.
@router.get("/sessions/search", response_model=list[ChatSearchHit])
async def search_sessions(
    app_id: str = Query(...),
    q: str = Query(..., min_length=1),
    source: str | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Flat search hits: one row per matching message (windowed snippet) plus a
    title-only row for sessions whose title matches but no message does. Newest
    session first; messages within a session keep chronological order."""
    term = q.strip()
    if not term:
        return []
    pattern = f"%{term}%"
    scan_cap = 300

    scope = [
        ChatSession.tenant_id == auth.tenant_id,
        ChatSession.user_id == auth.user_id,
        ChatSession.app_id == app_id,
    ]
    if source:
        scope.append(ChatSession.server_session_id == source)

    message_rows = await db.execute(
        select(ChatSession.id, ChatSession.title, ChatSession.updated_at, ChatMessage.content)
        .join(ChatMessage, ChatMessage.session_id == ChatSession.id)
        .where(*scope, ChatMessage.content.ilike(pattern))
        .order_by(desc(ChatSession.updated_at), ChatMessage.created_at)
        .limit(scan_cap)
    )
    hits: list[ChatSearchHit] = []
    sessions_with_message: set = set()
    for sid, title, updated, content in message_rows.all():
        hits.append(ChatSearchHit(
            session_id=sid, title=title, snippet=_snippet(content, term),
            matched_in="message", updated_at=updated,
        ))
        sessions_with_message.add(sid)

    title_rows = await db.execute(
        select(ChatSession.id, ChatSession.title, ChatSession.updated_at)
        .where(*scope, ChatSession.title.ilike(pattern))
        .order_by(desc(ChatSession.updated_at))
        .limit(scan_cap)
    )
    for sid, title, updated in title_rows.all():
        if sid not in sessions_with_message:
            hits.append(ChatSearchHit(
                session_id=sid, title=title, snippet=None,
                matched_in="title", updated_at=updated,
            ))

    hits.sort(key=lambda h: h.updated_at, reverse=True)
    return hits[offset:offset + limit]


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: UUID,
    app_id: str = Query(...),
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Get a single chat session by ID."""
    result = await db.execute(
        _owned_session_query(session_id=session_id, auth=auth, app_id=app_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    body: SessionCreate,
    auth: AuthContext = require_permission('asset:create'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Create a new chat session."""
    session = ChatSession(
        **body.model_dump(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.put("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: UUID,
    body: SessionUpdate,
    app_id: str = Query(...),
    auth: AuthContext = require_permission('asset:edit'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Update a chat session. Only provided fields are updated."""
    result = await db.execute(
        _owned_session_query(session_id=session_id, auth=auth, app_id=app_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(session, key, value)

    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: UUID,
    app_id: str = Query(...),
    auth: AuthContext = require_permission('asset:delete'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat session. Messages are cascade deleted by DB."""
    result = await db.execute(
        _owned_session_query(session_id=session_id, auth=auth, app_id=app_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return {"deleted": True, "id": str(session_id)}


# Bulk tag operations (operate on metadata.tags inside messages)
# NOTE: these must be registered before /messages/{message_id} routes
@router.put("/messages/tags/rename")
async def rename_tag_in_all_messages(
    body: TagRenameRequest,
    auth: AuthContext = require_permission('asset:edit'),
    db: AsyncSession = Depends(get_db),
):
    """Rename a tag across all messages owned by this user."""
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.tenant_id == auth.tenant_id,
            ChatMessage.user_id == auth.user_id,
        )
    )
    messages = result.scalars().all()
    count = 0
    for msg in messages:
        meta = msg.metadata_ or {}
        tags = meta.get("tags", [])
        if body.old_tag in tags:
            new_tags = [body.new_tag if t == body.old_tag else t for t in tags]
            msg.metadata_ = {**meta, "tags": new_tags}
            count += 1
    await db.commit()
    return {"renamed": True, "oldTag": body.old_tag, "newTag": body.new_tag, "messagesUpdated": count}


@router.post("/messages/tags/delete")
async def delete_tag_from_all_messages(
    body: TagDeleteRequest,
    auth: AuthContext = require_permission('asset:delete'),
    db: AsyncSession = Depends(get_db),
):
    """Remove a tag from all messages owned by this user."""
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.tenant_id == auth.tenant_id,
            ChatMessage.user_id == auth.user_id,
        )
    )
    messages = result.scalars().all()
    count = 0
    for msg in messages:
        meta = msg.metadata_ or {}
        tags = meta.get("tags", [])
        if body.tag in tags:
            msg.metadata_ = {**meta, "tags": [t for t in tags if t != body.tag]}
            count += 1
    await db.commit()
    return {"deleted": True, "tag": body.tag, "messagesUpdated": count}


# Message endpoints
@router.get("/sessions/{session_id}/messages", response_model=list[MessageResponse])
async def list_messages(
    session_id: UUID,
    app_id: str = Query(...),
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """List all messages in a chat session (verify session ownership first)."""
    session = await db.scalar(
        _owned_session_query(session_id=session_id, auth=auth, app_id=app_id)
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    return result.scalars().all()


@router.get("/messages/{message_id}", response_model=MessageResponse)
async def get_message(
    message_id: UUID,
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Get a single message by ID."""
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.tenant_id == auth.tenant_id,
            ChatMessage.user_id == auth.user_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


@router.post("/messages", response_model=MessageResponse, status_code=201)
async def create_message(
    body: MessageCreate,
    app_id: str = Query(...),
    auth: AuthContext = require_permission('asset:create'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Create a new chat message (verify session ownership first)."""
    session = await db.scalar(
        _owned_session_query(session_id=UUID(body.session_id), auth=auth, app_id=app_id)
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    message = ChatMessage(
        **body.model_dump(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


@router.put("/messages/{message_id}", response_model=MessageResponse)
async def update_message(
    message_id: UUID,
    body: MessageUpdate,
    auth: AuthContext = require_permission('asset:edit'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Update a chat message. Only provided fields are updated."""
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.tenant_id == auth.tenant_id,
            ChatMessage.user_id == auth.user_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(message, key, value)

    await db.commit()
    await db.refresh(message)
    return message


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: UUID,
    auth: AuthContext = require_permission('asset:delete'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat message."""
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.tenant_id == auth.tenant_id,
            ChatMessage.user_id == auth.user_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    await db.delete(message)
    await db.commit()
    return {"deleted": True, "id": str(message_id)}
