"""Chat API routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.chat import ChatSession, ChatMessage
from app.schemas.chat import (
    SessionCreate, SessionUpdate, SessionResponse,
    MessageCreate, MessageUpdate, MessageResponse
)

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
    sessions = result.scalars().all()
    return [_session_to_response(s) for s in sessions]


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
    return _session_to_response(session)


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
    return _session_to_response(session)


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
    return _session_to_response(session)


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
    messages = result.scalars().all()
    return [_message_to_response(m) for m in messages]


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
    return _message_to_response(message)


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
    return _message_to_response(message)


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
    return _message_to_response(message)


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


def _session_to_response(session: ChatSession) -> dict:
    """Convert ChatSession model to response dict."""
    return {
        "id": str(session.id),
        "app_id": session.app_id,
        "external_user_id": session.external_user_id,
        "thread_id": session.thread_id,
        "server_session_id": session.server_session_id,
        "last_response_id": session.last_response_id,
        "title": session.title,
        "status": session.status,
        "is_first_message": session.is_first_message,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "user_id": session.user_id,
    }


def _message_to_response(message: ChatMessage) -> dict:
    """Convert ChatMessage model to response dict."""
    return {
        "id": str(message.id),
        "session_id": str(message.session_id),
        "role": message.role,
        "content": message.content,
        "metadata_": message.metadata_,
        "status": message.status,
        "error_message": message.error_message,
        "created_at": message.created_at,
        "user_id": message.user_id,
    }
