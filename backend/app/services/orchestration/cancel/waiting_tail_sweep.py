"""Platform-wide sweep that aborts recipients still parked in 'waiting' after their run completed beyond the workflow's TTL."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    Workflow,
    WorkflowRun,
    WorkflowRunRecipientState,
)

DEFAULT_WAIT_TTL_SECONDS = 7 * 24 * 3600


async def sweep_waiting_tail_ttl(
    db: AsyncSession, *, now: datetime | None = None
) -> int:
    """Abort waiting recipients of completed runs past their workflow TTL.

    Returns the number of recipients aborted. TTL is
    ``workflow.max_wait_after_completion_seconds`` or ``DEFAULT_WAIT_TTL_SECONDS``.
    Global across tenants — a platform maintenance pass like the cost rollup.
    """
    now = now or datetime.now(timezone.utc)

    ttl_seconds = func.coalesce(
        Workflow.max_wait_after_completion_seconds, DEFAULT_WAIT_TTL_SECONDS
    )
    age_seconds = func.extract("epoch", now - WorkflowRun.completed_at)

    due_ids = (
        await db.execute(
            select(WorkflowRunRecipientState.id)
            .join(WorkflowRun, WorkflowRunRecipientState.run_id == WorkflowRun.id)
            .join(Workflow, WorkflowRun.workflow_id == Workflow.id)
            .where(
                WorkflowRunRecipientState.status == "waiting",
                WorkflowRun.status == "completed",
                WorkflowRun.completed_at.is_not(None),
                age_seconds > ttl_seconds,
            )
        )
    ).scalars().all()
    if not due_ids:
        return 0

    await db.execute(
        update(WorkflowRunRecipientState)
        .where(WorkflowRunRecipientState.id.in_(due_ids))
        .values(status="aborted_expired", ignore_webhooks_after=now)
    )
    await db.flush()
    return len(due_ids)
