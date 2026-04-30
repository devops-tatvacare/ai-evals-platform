"""Async iterator over a cohort of recipients in a run.

Backed by a streaming SELECT against workflow_run_recipient_states. Yields
(recipient_id, payload) tuples. The engine constructs one CohortStream per
node-step from the recipients arriving on that node's input edge(s).
"""
from __future__ import annotations

import uuid
from typing import Any, AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import WorkflowRunRecipientState


class CohortStream:
    """Async-iterable wrapper around a list of (recipient_id, payload) pairs.

    Materializes upfront from the DB or accepts an in-memory list for tests.
    """

    def __init__(self, items: list[tuple[str, dict[str, Any]]]):
        self._items = items

    def __aiter__(self) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        async def gen():
            for item in self._items:
                yield item
        return gen()

    def __len__(self) -> int:
        return len(self._items)

    @classmethod
    async def from_run_node(
        cls,
        db: AsyncSession,
        run_id: uuid.UUID,
        recipient_ids: list[str] | None = None,
        statuses: tuple[str, ...] = ("pending", "ready"),
    ) -> "CohortStream":
        """Load recipients in `statuses` for `run_id`, optionally restricted to recipient_ids."""
        stmt = select(
            WorkflowRunRecipientState.recipient_id,
            WorkflowRunRecipientState.payload,
        ).where(
            WorkflowRunRecipientState.run_id == run_id,
            WorkflowRunRecipientState.status.in_(statuses),
        )
        if recipient_ids:
            stmt = stmt.where(WorkflowRunRecipientState.recipient_id.in_(recipient_ids))
        result = await db.execute(stmt)
        return cls([(row[0], row[1] or {}) for row in result.all()])
