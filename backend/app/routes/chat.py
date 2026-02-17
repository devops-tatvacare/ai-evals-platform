"""Chat API routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from pydantic.alias_generators import to_camel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.chat import ChatSession, ChatMessage
from app.schemas.chat import (
    SessionCreate, SessionUpdate, SessionResponse,
    MessageCreate, MessageUpdate, MessageResponse
)


class TagRenameRequest(BaseModel):
    old_tag: str
    new_tag: str
    model_config = {"alias_generator": to_camel, "populate_by_name": True}


class TagDeleteRequest(BaseModel):
    tag: str

router = APIRouter(prefix="/api/chat", tags=["chat"])


# Session endpoints
@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """List all chat sessions for an app."""
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.app_id == app_id)
        .order_by(desc(ChatSession.updated_at))
    )
    return result.scalars().all()


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single chat session by ID."""
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    body: SessionCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new chat session."""
    session = ChatSession(**body.model_dump())
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.put("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: UUID,
    body: SessionUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a chat session. Only provided fields are updated."""
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
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
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat session. Messages are cascade deleted by DB."""
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
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
    db: AsyncSession = Depends(get_db),
):
    """Rename a tag across all messages that contain it in metadata.tags."""
    result = await db.execute(select(ChatMessage))
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
    db: AsyncSession = Depends(get_db),
):
    """Remove a tag from all messages that contain it in metadata.tags."""
    result = await db.execute(select(ChatMessage))
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
    db: AsyncSession = Depends(get_db),
):
    """List all messages in a chat session."""
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    return result.scalars().all()


@router.get("/messages/{message_id}", response_model=MessageResponse)
async def get_message(
    message_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single message by ID."""
    result = await db.execute(
        select(ChatMessage).where(ChatMessage.id == message_id)
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


@router.post("/messages", response_model=MessageResponse, status_code=201)
async def create_message(
    body: MessageCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new chat message."""
    message = ChatMessage(**body.model_dump())
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


@router.put("/messages/{message_id}", response_model=MessageResponse)
async def update_message(
    message_id: UUID,
    body: MessageUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a chat message. Only provided fields are updated."""
    result = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
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
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat message."""
    result = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    await db.delete(message)
    await db.commit()
    return {"deleted": True, "id": str(message_id)}
