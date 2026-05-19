"""Durable runtime state for Sherlock report-builder chat sessions."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SHERLOCK_CHAT_SOURCE
from app.database import async_session
from app.models.chat import ChatMessage, ChatSession
from app.models.sherlock_runtime import SherlockAgentSession, SherlockPart


class SherlockSessionNotFoundError(Exception):
    """Raised when a requested Sherlock agent session cannot be resolved."""


def _title_from_message(message: str) -> str:
    text = (message or '').strip() or 'New Chat'
    return text if len(text) <= 60 else text[:57] + '...'


@dataclass(slots=True)
class SherlockAgentSessionState:
    chat_session_id: str
    app_id: str
    tenant_id: str
    user_id: str
    provider: str
    model: str
    message_state: list[dict[str, Any]]
    next_event_seq: int
    status: str = 'active'
    last_error: str | None = None
    last_response_id: str | None = None


def _to_runtime_state(row: SherlockAgentSession) -> SherlockAgentSessionState:
    return SherlockAgentSessionState(
        chat_session_id=str(row.chat_session_id),
        app_id=row.app_id,
        tenant_id=str(row.tenant_id),
        user_id=str(row.user_id),
        provider=row.provider,
        model=row.model,
        message_state=list(row.message_state or []),
        next_event_seq=row.next_event_seq,
        status=row.status,
        last_error=row.last_error,
        last_response_id=getattr(row, 'last_response_id', None),
    )


def _session_stmt(*, session_uuid: uuid.UUID, app_id: str, auth: Any):
    return select(ChatSession).where(
        ChatSession.id == session_uuid,
        ChatSession.tenant_id == auth.tenant_id,
        ChatSession.user_id == auth.user_id,
        ChatSession.app_id == app_id,
        ChatSession.server_session_id == SHERLOCK_CHAT_SOURCE,
    )


async def _load_runtime_row(
    db: AsyncSession,
    *,
    session_row: ChatSession | None,
) -> SherlockAgentSession | None:
    if session_row is None:
        return None
    return await db.scalar(
        select(SherlockAgentSession).where(
            SherlockAgentSession.chat_session_id == session_row.id
        )
    )


def _serialize_message(row: ChatMessage) -> dict[str, Any]:
    return {
        'id': str(row.id),
        'role': row.role,
        'content': row.content,
        'status': row.status,
        'error_message': row.error_message,
        'metadata': row.metadata_,
        'created_at': row.created_at,
    }


def _try_uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


async def resolve_sherlock_runtime_session(
    *,
    session_id: str | None,
    app_id: str,
    auth: Any,
    provider: str,
    model: str,
    initial_user_message: str,
    db: AsyncSession | None = None,
    strict_session_id: bool = False,
) -> SherlockAgentSessionState:
    """Load or create a Sherlock agent session without touching Kaira chat semantics.

    Pre-existing security gap (closed by this call): the route was passing
    `body.app_id` straight into session creation without verifying it
    landed in `auth.app_access`. A user could smuggle in an app slug they
    were not entitled to and create a session against it. We now run
    `ensure_registered_app_access` on every call so the check happens
    once at the choke point regardless of who calls into the resolver.
    """
    from app.auth.app_scope import ensure_registered_app_access

    if db is None:
        async with async_session() as session_db:
            runtime_session = await resolve_sherlock_runtime_session(
                session_id=session_id,
                app_id=app_id,
                auth=auth,
                provider=provider,
                model=model,
                initial_user_message=initial_user_message,
                db=session_db,
                strict_session_id=strict_session_id,
            )
            await session_db.commit()
            return runtime_session

    await ensure_registered_app_access(db, auth, app_id)

    session_row: ChatSession | None = None
    runtime_row: SherlockAgentSession | None = None

    if session_id:
        try:
            session_uuid = uuid.UUID(str(session_id))
        except ValueError as exc:
            if strict_session_id:
                raise SherlockSessionNotFoundError('session_not_found') from exc
            session_uuid = None

        if session_uuid is not None:
            session_row = await db.scalar(
                _session_stmt(session_uuid=session_uuid, app_id=app_id, auth=auth)
            )
            runtime_row = await _load_runtime_row(db, session_row=session_row)
            if strict_session_id and (session_row is None or runtime_row is None):
                raise SherlockSessionNotFoundError('session_not_found')

    if session_row is None:
        session_row = ChatSession(
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            app_id=app_id,
            server_session_id=SHERLOCK_CHAT_SOURCE,
            title=_title_from_message(initial_user_message),
            status='active',
            is_first_message=False,
        )
        db.add(session_row)
        await db.flush()

    if runtime_row is None:
        runtime_row = SherlockAgentSession(
            chat_session_id=session_row.id,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            app_id=app_id,
            provider=provider,
            model=model,
            message_state=[],
            next_event_seq=1,
            status='active',
            last_response_id=None,
        )
        db.add(runtime_row)
        await db.flush()

    return _to_runtime_state(runtime_row)


async def get_sherlock_runtime_session(
    *,
    session_id: str,
    app_id: str,
    auth: Any,
    db: AsyncSession | None = None,
) -> SherlockAgentSessionState | None:
    if db is None:
        async with async_session() as session_db:
            return await get_sherlock_runtime_session(
                session_id=session_id,
                app_id=app_id,
                auth=auth,
                db=session_db,
            )

    try:
        session_uuid = uuid.UUID(str(session_id))
    except ValueError:
        return None

    session_row = await db.scalar(
        _session_stmt(session_uuid=session_uuid, app_id=app_id, auth=auth)
    )
    runtime_row = await _load_runtime_row(db, session_row=session_row)
    if runtime_row is None:
        return None
    return _to_runtime_state(runtime_row)


async def get_sherlock_runtime_session_snapshot(
    *,
    session_id: str,
    app_id: str,
    auth: Any,
    db: AsyncSession | None = None,
) -> dict[str, Any]:
    if db is None:
        async with async_session() as session_db:
            return await get_sherlock_runtime_session_snapshot(
                session_id=session_id,
                app_id=app_id,
                auth=auth,
                db=session_db,
            )

    runtime_session = await get_sherlock_runtime_session(
        session_id=session_id,
        app_id=app_id,
        auth=auth,
        db=db,
    )
    if runtime_session is None:
        raise SherlockSessionNotFoundError('session_not_found')

    from app.services.report_builder.turn_store import get_latest_turn

    messages = (
        await db.execute(
            select(ChatMessage)
            .where(
                ChatMessage.session_id == uuid.UUID(runtime_session.chat_session_id),
                ChatMessage.tenant_id == uuid.UUID(runtime_session.tenant_id),
                ChatMessage.user_id == uuid.UUID(runtime_session.user_id),
            )
            .order_by(ChatMessage.created_at, ChatMessage.id)
        )
    ).scalars().all()
    latest_turn = await get_latest_turn(runtime_session=runtime_session, db=db)

    return {
        'session_id': runtime_session.chat_session_id,
        'provider': runtime_session.provider,
        'model': runtime_session.model,
        'last_event_seq': max(runtime_session.next_event_seq - 1, 0),
        'active_turn_id': latest_turn.client_turn_id if latest_turn is not None else None,
        'current_turn_status': latest_turn.status if latest_turn is not None else runtime_session.status,
        'messages': [_serialize_message(row) for row in messages],
    }


async def list_sherlock_parts(
    *,
    session_id: str,
    app_id: str,
    auth: Any,
    after_seq: int = 0,
    db: AsyncSession | None = None,
) -> dict[str, Any]:
    """Replay this session's typed Part stream, gated by tenant+user+app."""
    if db is None:
        async with async_session() as session_db:
            return await list_sherlock_parts(
                session_id=session_id,
                app_id=app_id,
                auth=auth,
                after_seq=after_seq,
                db=session_db,
            )

    runtime_session = await get_sherlock_runtime_session(
        session_id=session_id,
        app_id=app_id,
        auth=auth,
        db=db,
    )
    if runtime_session is None:
        raise SherlockSessionNotFoundError('session_not_found')

    rows = (
        await db.execute(
            select(SherlockPart)
            .where(
                SherlockPart.chat_session_id == uuid.UUID(runtime_session.chat_session_id),
                SherlockPart.tenant_id == uuid.UUID(runtime_session.tenant_id),
                SherlockPart.user_id == uuid.UUID(runtime_session.user_id),
                SherlockPart.app_id == app_id,
                SherlockPart.seq > after_seq,
            )
            .order_by(SherlockPart.seq)
        )
    ).scalars().all()

    parts: list[dict[str, Any]] = []
    for row in rows:
        parts.append({
            'seq': row.seq,
            'type': row.type,
            'call_id': row.call_id,
            'part': row.payload,
            'created_at': row.created_at,
        })
    return {
        'session_id': runtime_session.chat_session_id,
        'last_event_seq': max(runtime_session.next_event_seq - 1, 0),
        'parts': parts,
    }


async def touch_sherlock_chat_session(
    *,
    runtime_session: SherlockAgentSessionState,
    db: AsyncSession | None = None,
) -> None:
    if db is None:
        async with async_session() as session_db:
            await touch_sherlock_chat_session(runtime_session=runtime_session, db=session_db)
            await session_db.commit()
            return

    stmt = update(ChatSession).where(ChatSession.id == uuid.UUID(runtime_session.chat_session_id))
    tenant_uuid = _try_uuid(runtime_session.tenant_id)
    user_uuid = _try_uuid(runtime_session.user_id)
    if tenant_uuid is not None:
        stmt = stmt.where(ChatSession.tenant_id == tenant_uuid)
    if user_uuid is not None:
        stmt = stmt.where(ChatSession.user_id == user_uuid)

    await db.execute(stmt.values(updated_at=func.now()))
    await db.flush()


async def record_user_message(
    *,
    runtime_session: SherlockAgentSessionState,
    content: str,
    db: AsyncSession | None = None,
) -> str:
    if db is None:
        async with async_session() as session_db:
            message_id = await record_user_message(
                runtime_session=runtime_session,
                content=content,
                db=session_db,
            )
            await session_db.commit()
            return message_id

    message = ChatMessage(
        tenant_id=uuid.UUID(runtime_session.tenant_id),
        user_id=uuid.UUID(runtime_session.user_id),
        session_id=uuid.UUID(runtime_session.chat_session_id),
        role='user',
        content=content,
        status='complete',
    )
    db.add(message)
    await db.flush()
    return str(message.id)


async def create_assistant_message(
    *,
    runtime_session: SherlockAgentSessionState,
    db: AsyncSession | None = None,
) -> str:
    if db is None:
        async with async_session() as session_db:
            message_id = await create_assistant_message(
                runtime_session=runtime_session,
                db=session_db,
            )
            await session_db.commit()
            return message_id

    # Use clock_timestamp() (wall-clock, not transaction-start) so the
    # assistant message always sorts after the user message even when both
    # are flushed in the same transaction.
    from sqlalchemy import text as sa_text
    result = await db.execute(sa_text('SELECT clock_timestamp()'))
    wall_clock = result.scalar()

    message = ChatMessage(
        tenant_id=uuid.UUID(runtime_session.tenant_id),
        user_id=uuid.UUID(runtime_session.user_id),
        session_id=uuid.UUID(runtime_session.chat_session_id),
        role='assistant',
        content='',
        status='streaming',
        created_at=wall_clock,
    )
    db.add(message)
    await db.flush()
    return str(message.id)


async def finalize_assistant_message(
    *,
    runtime_session: SherlockAgentSessionState,
    message_id: str,
    content: str,
    metadata: dict[str, Any] | None,
    status: str,
    error_message: str | None = None,
    db: AsyncSession | None = None,
) -> None:
    if db is None:
        async with async_session() as session_db:
            await finalize_assistant_message(
                runtime_session=runtime_session,
                message_id=message_id,
                content=content,
                metadata=metadata,
                status=status,
                error_message=error_message,
                db=session_db,
            )
            await session_db.commit()
            return

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
    await db.flush()


async def save_runtime_state(
    *,
    runtime_session: SherlockAgentSessionState,
    message_state: list[dict[str, Any]],
    status: str = 'active',
    last_error: str | None = None,
    db: AsyncSession | None = None,
) -> SherlockAgentSessionState:
    if db is None:
        async with async_session() as session_db:
            next_state = await save_runtime_state(
                runtime_session=runtime_session,
                message_state=message_state,
                status=status,
                last_error=last_error,
                db=session_db,
            )
            await session_db.commit()
            return next_state

    row = await db.scalar(
        select(SherlockAgentSession).where(
            SherlockAgentSession.chat_session_id == uuid.UUID(runtime_session.chat_session_id)
        )
    )
    if row is None:
        raise ValueError(f'Sherlock agent session {runtime_session.chat_session_id} not found')
    row.message_state = message_state
    row.status = status
    row.last_error = last_error
    if hasattr(runtime_session, 'last_response_id'):
        row.last_response_id = runtime_session.last_response_id
    await db.flush()
    return _to_runtime_state(row)


async def update_last_response_id(
    *,
    runtime_session: SherlockAgentSessionState,
    last_response_id: str | None,
    db: AsyncSession,
) -> None:
    row = await db.scalar(
        select(SherlockAgentSession).where(
            SherlockAgentSession.chat_session_id == uuid.UUID(runtime_session.chat_session_id)
        )
    )
    if row is not None:
        row.last_response_id = last_response_id
        await db.flush()


async def list_sherlock_history_for_responses_input(
    *,
    runtime_session: SherlockAgentSessionState,
    db: AsyncSession,
) -> list[dict[str, str]]:
    """Reconstruct OpenAI Responses-API ``input`` items from chat_messages.

    Used as the fallback when ``last_response_id`` has aged past OpenAI's
    30-day retention. Returns the conversation as a plain ``[{role, content}]``
    list ordered by creation time. The current turn's user message is
    already persisted (chat_handler records it before the SDK call) and
    appears as the final entry, so callers pass this list straight through
    to ``Runner.run_streamed`` with ``previous_response_id=None``.

    Tool calls/results are intentionally not replayed — Responses API
    accepts simple message items, and the model rebuilds tool context from
    the assistant's prior textual output.
    """
    rows = (
        await db.execute(
            select(ChatMessage.role, ChatMessage.content)
            .where(
                ChatMessage.session_id == uuid.UUID(runtime_session.chat_session_id),
                ChatMessage.tenant_id == uuid.UUID(runtime_session.tenant_id),
                ChatMessage.user_id == uuid.UUID(runtime_session.user_id),
                ChatMessage.status == 'complete',
                ChatMessage.role.in_(('user', 'assistant')),
            )
            .order_by(ChatMessage.created_at, ChatMessage.id)
        )
    ).all()
    return [
        {'role': role, 'content': content}
        for role, content in rows
        if content
    ]


