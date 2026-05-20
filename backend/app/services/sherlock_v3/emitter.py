"""PartEmitter — single producer for platform.sherlock_parts + SSE Part-add/update events."""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Awaitable, Callable

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sherlock_runtime import SherlockAgentSession, SherlockPart
from app.services.sherlock_v3.contracts.parts import (
    SherlockPart as SherlockPartModel,
    new_part_id,
)


logger = logging.getLogger(__name__)


PublishFn = Callable[[str, dict[str, Any]], Awaitable[None]]


class PartEmitter:
    """Per-turn producer — emit(part) atomically writes a sherlock_parts row and publishes the SSE event."""

    def __init__(
        self,
        *,
        db: AsyncSession,
        chat_session_id: uuid.UUID,
        tenant_id: uuid.UUID,
        user_id: uuid.UUID,
        app_id: str,
        turn_id: str,
        publish: PublishFn,
    ) -> None:
        self._db = db
        self._chat_session_id = chat_session_id
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._app_id = app_id
        self._turn_id = turn_id
        self._publish = publish

    @property
    def chat_session_id(self) -> uuid.UUID:
        return self._chat_session_id

    async def _next_seq(self) -> int:
        result = await self._db.execute(
            select(SherlockAgentSession.next_event_seq)
            .where(SherlockAgentSession.chat_session_id == self._chat_session_id)
            .with_for_update()
        )
        current = result.scalar_one()
        await self._db.execute(
            update(SherlockAgentSession)
            .where(SherlockAgentSession.chat_session_id == self._chat_session_id)
            .values(next_event_seq=current + 1)
        )
        return int(current)

    async def emit(self, part: SherlockPartModel) -> SherlockPartModel:
        """Persist + publish one Part; returned Part has seq/id/chat_session_id/created_at materialized."""
        seq = await self._next_seq()
        if not part.id:
            part = part.model_copy(update={'id': new_part_id()})
        part = part.model_copy(update={
            'chat_session_id': str(self._chat_session_id),
            'seq': seq,
            'created_at': int(time.time() * 1000),
        })

        call_id = getattr(part, 'call_id', None) if part.type == 'tool' else None

        row = SherlockPart(
            id=part.id,
            chat_session_id=self._chat_session_id,
            tenant_id=self._tenant_id,
            user_id=self._user_id,
            app_id=self._app_id,
            seq=seq,
            type=part.type,
            call_id=call_id,
            payload=part.model_dump(mode='json'),
        )
        self._db.add(row)
        await self._db.flush()

        await self._publish(self._turn_id, {
            'kind': 'part_added',
            'seq': seq,
            'part': part.model_dump(mode='json'),
        })
        return part

    async def update(self, part: SherlockPartModel) -> SherlockPartModel:
        """Persist + publish a state change — caller must pass an already-emitted Part with id/seq set."""
        if not part.id:
            raise ValueError('PartEmitter.update requires part.id to be set; call emit() first')

        await self._db.execute(
            update(SherlockPart)
            .where(SherlockPart.id == part.id)
            .values(
                type=part.type,
                call_id=getattr(part, 'call_id', None) if part.type == 'tool' else None,
                payload=part.model_dump(mode='json'),
            )
        )
        await self._db.flush()

        await self._publish(self._turn_id, {
            'kind': 'part_updated',
            'seq': part.seq,
            'part': part.model_dump(mode='json'),
        })
        return part


__all__ = ['PartEmitter', 'PublishFn']
