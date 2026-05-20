"""Hard-Stop a run synchronously; provider cancels fan out via finalize-run-cancel."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import BackgroundJob
from app.models.orchestration import WorkflowRun, WorkflowRunRecipientState
from app.schemas.orchestration import TerminationReceipt


# Recipient states that already reached a settled outcome — Stop leaves them be.
TERMINAL_RECIPIENT_STATES: frozenset[str] = frozenset({
    "completed", "skipped", "failed", "overridden",
    "aborted", "aborted_expired", "skipped_capped", "skipped_invalid_phone",
})


class TerminationReason(StrEnum):
    operator = "operator"
    cap_breach = "cap_breach"
    admin_kill = "admin_kill"


async def terminate_run(
    db: AsyncSession,
    *,
    run_id: uuid.UUID,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    reason: TerminationReason | str = TerminationReason.operator,
) -> Optional[TerminationReceipt]:
    """Flip the run + its in-flight recipients to terminal, seal late webhooks,
    cancel the run-workflow job, and enqueue the async provider-cancel job.

    Idempotent: a second call on an already-cancelled run is a no-op flip and
    enqueues no second finalize job. Returns ``None`` when the run is missing or
    out of tenant scope (the route maps that to 404)."""
    run = (
        await db.execute(
            select(WorkflowRun).where(
                WorkflowRun.id == run_id,
                WorkflowRun.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if run is None:
        return None

    now = datetime.now(timezone.utc)

    if run.status == "cancelled":
        return TerminationReceipt(
            run_id=run.id,
            status=run.status,
            recipients_aborted=0,
            finalize_job_id=None,
            cancel_requested_at=run.cancel_requested_at or now,
        )

    run.status = "cancelled"
    run.completed_at = now
    run.cancel_requested_at = now
    run.cancel_requested_by = user_id

    aborted = await db.execute(
        update(WorkflowRunRecipientState)
        .where(
            WorkflowRunRecipientState.run_id == run_id,
            WorkflowRunRecipientState.status.notin_(TERMINAL_RECIPIENT_STATES),
        )
        .values(status="aborted", ignore_webhooks_after=now)
    )
    aborted_count = aborted.rowcount or 0

    if run.job_id:
        from app.services.job_worker import mark_job_cancelled
        mark_job_cancelled(str(run.job_id))

    finalize_job = BackgroundJob(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=run.app_id,
        user_id=user_id,
        job_type="finalize-run-cancel",
        queue_class="standard",
        priority=5,
        params={
            "run_id": str(run_id),
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "reason": str(reason),
        },
        status="queued",
    )
    db.add(finalize_job)

    await db.flush()
    return TerminationReceipt(
        run_id=run.id,
        status=run.status,
        recipients_aborted=aborted_count,
        finalize_job_id=finalize_job.id,
        cancel_requested_at=now,
    )
