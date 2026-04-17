"""Durable turn persistence helpers for Sherlock runtime sessions."""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sherlock_runtime import SherlockRuntimeTurn as SherlockRuntimeTurnModel
from app.services.report_builder.runtime_store import SherlockRuntimeSession


@dataclass(slots=True)
class SherlockRuntimeTurnState:
    id: str
    chat_session_id: str
    app_id: str
    client_turn_id: str
    provider: str
    model: str
    user_message: str | None
    status: str
    assistant_message_id: str | None
    last_event_seq: int
    last_error: str | None = None


def _to_turn_state(row: SherlockRuntimeTurnModel) -> SherlockRuntimeTurnState:
    return SherlockRuntimeTurnState(
        id=str(row.id),
        chat_session_id=str(row.chat_session_id),
        app_id=row.app_id,
        client_turn_id=row.client_turn_id,
        provider=row.provider,
        model=row.model,
        user_message=row.user_message,
        status=row.status,
        assistant_message_id=str(row.assistant_message_id) if row.assistant_message_id is not None else None,
        last_event_seq=row.last_event_seq,
        last_error=row.last_error,
    )


def _turn_lookup_stmt(*, runtime_session: SherlockRuntimeSession, turn_id: str):
    return (
        select(SherlockRuntimeTurnModel)
        .where(SherlockRuntimeTurnModel.chat_session_id == uuid.UUID(runtime_session.chat_session_id))
        .where(SherlockRuntimeTurnModel.client_turn_id == turn_id)
        .with_for_update()
    )


@asynccontextmanager
async def _maybe_nested_transaction(db: AsyncSession):
    begin_nested = getattr(db, 'begin_nested', None)
    if begin_nested is None:
        yield
        return

    async with begin_nested():
        yield


async def get_or_create_turn(
    *,
    runtime_session: SherlockRuntimeSession,
    turn_id: str,
    user_message: str | None,
    provider: str,
    model: str,
    db: AsyncSession,
) -> SherlockRuntimeTurnState:
    row = await db.scalar(_turn_lookup_stmt(runtime_session=runtime_session, turn_id=turn_id))
    if row is not None:
        return _to_turn_state(row)

    row = SherlockRuntimeTurnModel(
        chat_session_id=uuid.UUID(runtime_session.chat_session_id),
        tenant_id=uuid.UUID(runtime_session.tenant_id),
        user_id=uuid.UUID(runtime_session.user_id),
        app_id=runtime_session.app_id,
        client_turn_id=turn_id,
        provider=provider,
        model=model,
        user_message=user_message,
        status='queued',
    )
    try:
        async with _maybe_nested_transaction(db):
            db.add(row)
            await db.flush()
    except IntegrityError:
        row = await db.scalar(_turn_lookup_stmt(runtime_session=runtime_session, turn_id=turn_id))
        if row is None:
            raise
        return _to_turn_state(row)

    return _to_turn_state(row)


async def mark_turn_active(
    *,
    turn_id: str,
    assistant_message_id: str | None,
    db: AsyncSession,
) -> SherlockRuntimeTurnState:
    row = await db.scalar(
        select(SherlockRuntimeTurnModel)
        .where(SherlockRuntimeTurnModel.id == uuid.UUID(turn_id))
        .with_for_update()
    )
    if row is None:
        raise ValueError(f'Runtime turn {turn_id} not found')

    row.status = 'active'
    row.assistant_message_id = uuid.UUID(assistant_message_id) if assistant_message_id else None
    await db.flush()
    return _to_turn_state(row)


async def mark_turn_terminal(
    *,
    turn_id: str,
    status: str,
    last_event_seq: int,
    last_error: str | None,
    db: AsyncSession,
) -> SherlockRuntimeTurnState:
    row = await db.scalar(
        select(SherlockRuntimeTurnModel)
        .where(SherlockRuntimeTurnModel.id == uuid.UUID(turn_id))
        .with_for_update()
    )
    if row is None:
        raise ValueError(f'Runtime turn {turn_id} not found')

    row.status = status
    row.last_event_seq = last_event_seq
    row.last_error = last_error
    await db.flush()
    return _to_turn_state(row)


async def get_latest_turn(
    *,
    runtime_session: SherlockRuntimeSession,
    db: AsyncSession,
) -> SherlockRuntimeTurnState | None:
    row = await db.scalar(
        select(SherlockRuntimeTurnModel)
        .where(SherlockRuntimeTurnModel.chat_session_id == uuid.UUID(runtime_session.chat_session_id))
        .order_by(SherlockRuntimeTurnModel.created_at.desc(), SherlockRuntimeTurnModel.id.desc())
        .limit(1)
    )
    return _to_turn_state(row) if row is not None else None
