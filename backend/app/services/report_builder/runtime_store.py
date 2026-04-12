"""Durable runtime state for Sherlock report-builder chat sessions."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.database import async_session
from app.models.chat import ChatMessage, ChatSession
from app.models.sherlock_runtime import (
    SherlockRuntimeEvent as SherlockRuntimeEventModel,
    SherlockRuntimeSession as SherlockRuntimeSessionModel,
)

_SHERLOCK_SOURCE = 'sherlock'


def _default_scratchpad() -> dict[str, Any]:
    return {
        'findings': [],
        'composed_report': None,
        'errors': [],
    }


def _title_from_message(message: str) -> str:
    text = (message or '').strip() or 'New Chat'
    return text if len(text) <= 60 else text[:57] + '...'


@dataclass(slots=True)
class SherlockRuntimeSession:
    chat_session_id: str
    app_id: str
    tenant_id: str
    user_id: str
    provider: str
    model: str
    message_state: list[dict[str, Any]]
    scratchpad: dict[str, Any]
    next_event_seq: int


def _to_runtime_state(row: SherlockRuntimeSessionModel) -> SherlockRuntimeSession:
    return SherlockRuntimeSession(
        chat_session_id=str(row.chat_session_id),
        app_id=row.app_id,
        tenant_id=str(row.tenant_id),
        user_id=str(row.user_id),
        provider=row.provider,
        model=row.model,
        message_state=list(row.message_state or []),
        scratchpad=dict(row.scratchpad or _default_scratchpad()),
        next_event_seq=row.next_event_seq,
    )


async def resolve_sherlock_runtime_session(
    *,
    session_id: str | None,
    app_id: str,
    auth: Any,
    provider: str,
    model: str,
    initial_user_message: str,
) -> SherlockRuntimeSession:
    """Load or create a Sherlock runtime session without touching Kaira chat semantics."""
    async with async_session() as db:
        session_row: ChatSession | None = None
        runtime_row: SherlockRuntimeSessionModel | None = None

        if session_id:
            try:
                session_uuid = uuid.UUID(str(session_id))
            except ValueError:
                session_uuid = None

            if session_uuid is not None:
                session_row = await db.scalar(
                    select(ChatSession).where(
                        ChatSession.id == session_uuid,
                        ChatSession.tenant_id == auth.tenant_id,
                        ChatSession.user_id == auth.user_id,
                        ChatSession.app_id == app_id,
                        ChatSession.server_session_id == _SHERLOCK_SOURCE,
                    )
                )
                if session_row is not None:
                    runtime_row = await db.scalar(
                        select(SherlockRuntimeSessionModel).where(
                            SherlockRuntimeSessionModel.chat_session_id == session_row.id
                        )
                    )

        if session_row is None:
            session_row = ChatSession(
                tenant_id=auth.tenant_id,
                user_id=auth.user_id,
                app_id=app_id,
                server_session_id=_SHERLOCK_SOURCE,
                title=_title_from_message(initial_user_message),
                status='active',
                is_first_message=False,
            )
            db.add(session_row)
            await db.flush()

        if runtime_row is None:
            runtime_row = SherlockRuntimeSessionModel(
                chat_session_id=session_row.id,
                tenant_id=auth.tenant_id,
                user_id=auth.user_id,
                app_id=app_id,
                provider=provider,
                model=model,
                message_state=[],
                scratchpad=_default_scratchpad(),
                next_event_seq=1,
                status='active',
            )
            db.add(runtime_row)

        await db.commit()
        await db.refresh(runtime_row)
        return _to_runtime_state(runtime_row)


async def get_sherlock_runtime_session(
    *,
    session_id: str,
    app_id: str,
    auth: Any,
) -> SherlockRuntimeSession | None:
    async with async_session() as db:
        try:
            session_uuid = uuid.UUID(str(session_id))
        except ValueError:
            return None

        session_row = await db.scalar(
            select(ChatSession).where(
                ChatSession.id == session_uuid,
                ChatSession.tenant_id == auth.tenant_id,
                ChatSession.user_id == auth.user_id,
                ChatSession.app_id == app_id,
                ChatSession.server_session_id == _SHERLOCK_SOURCE,
            )
        )
        if session_row is None:
            return None

        runtime_row = await db.scalar(
            select(SherlockRuntimeSessionModel).where(
                SherlockRuntimeSessionModel.chat_session_id == session_row.id
            )
        )
        if runtime_row is None:
            return None
        return _to_runtime_state(runtime_row)


async def record_user_message(*, runtime_session: SherlockRuntimeSession, content: str) -> str:
    async with async_session() as db:
        message = ChatMessage(
            tenant_id=uuid.UUID(runtime_session.tenant_id),
            user_id=uuid.UUID(runtime_session.user_id),
            session_id=uuid.UUID(runtime_session.chat_session_id),
            role='user',
            content=content,
            status='complete',
        )
        db.add(message)
        await db.commit()
        return str(message.id)


async def create_assistant_message(*, runtime_session: SherlockRuntimeSession) -> str:
    async with async_session() as db:
        message = ChatMessage(
            tenant_id=uuid.UUID(runtime_session.tenant_id),
            user_id=uuid.UUID(runtime_session.user_id),
            session_id=uuid.UUID(runtime_session.chat_session_id),
            role='assistant',
            content='',
            status='streaming',
        )
        db.add(message)
        await db.commit()
        return str(message.id)


async def finalize_assistant_message(
    *,
    runtime_session: SherlockRuntimeSession,
    message_id: str,
    content: str,
    metadata: dict[str, Any] | None,
    status: str,
    error_message: str | None = None,
) -> None:
    async with async_session() as db:
        row = await db.scalar(
            select(ChatMessage).where(
                ChatMessage.id == uuid.UUID(message_id),
                ChatMessage.session_id == uuid.UUID(runtime_session.chat_session_id),
                ChatMessage.tenant_id == uuid.UUID(runtime_session.tenant_id),
                ChatMessage.user_id == uuid.UUID(runtime_session.user_id),
            )
        )
        if row is None:
            return
        row.content = content
        row.metadata_ = metadata
        row.status = status
        row.error_message = error_message
        await db.commit()


async def save_runtime_state(
    *,
    runtime_session: SherlockRuntimeSession,
    message_state: list[dict[str, Any]],
    scratchpad: dict[str, Any],
    status: str = 'active',
    last_error: str | None = None,
) -> SherlockRuntimeSession:
    async with async_session() as db:
        row = await db.scalar(
            select(SherlockRuntimeSessionModel).where(
                SherlockRuntimeSessionModel.chat_session_id == uuid.UUID(runtime_session.chat_session_id)
            )
        )
        if row is None:
            raise ValueError(f'Runtime session {runtime_session.chat_session_id} not found')
        row.message_state = message_state
        row.scratchpad = scratchpad
        row.status = status
        row.last_error = last_error
        await db.commit()
        await db.refresh(row)
        return _to_runtime_state(row)


async def append_runtime_event(
    *,
    runtime_session: SherlockRuntimeSession,
    event_type: str,
    payload: dict[str, Any],
) -> int:
    async with async_session() as db:
        row = await db.scalar(
            select(SherlockRuntimeSessionModel)
            .where(SherlockRuntimeSessionModel.chat_session_id == uuid.UUID(runtime_session.chat_session_id))
            .with_for_update()
        )
        if row is None:
            raise ValueError(f'Runtime session {runtime_session.chat_session_id} not found')

        seq = row.next_event_seq
        row.next_event_seq = seq + 1
        event = SherlockRuntimeEventModel(
            chat_session_id=uuid.UUID(runtime_session.chat_session_id),
            tenant_id=uuid.UUID(runtime_session.tenant_id),
            user_id=uuid.UUID(runtime_session.user_id),
            app_id=runtime_session.app_id,
            seq=seq,
            event_type=event_type,
            payload=payload,
        )
        db.add(event)
        await db.commit()
        return seq
