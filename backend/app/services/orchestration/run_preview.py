"""Run-start preview: walk the frozen manifest, pre-skip capped recipients.

Runs once per workflow run, right after ``freeze_recipients`` lands the
manifest at T0. The active comm-cap policy is fetched once for the run and
each manifest row's recent-action count is checked against it; over-cap
recipients are flipped to ``skipped_capped`` so the operator sees the
will-skip count before any provider call fires.
"""
from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import WorkflowRun, WorkflowRunRecipient, WorkflowRunRecipientState
from app.services.orchestration.comm_cap.policy_resolver import (
    count_recent_comms,
    get_active_policy,
)


async def run_cap_preview(db: AsyncSession, *, run: WorkflowRun) -> int:
    """Return the number of manifest rows pre-flipped to ``skipped_capped``."""
    policy = await get_active_policy(db, tenant_id=run.tenant_id, app_id=run.app_id)
    if policy is None:
        return 0

    manifest_rows = (
        await db.execute(
            select(WorkflowRunRecipient).where(WorkflowRunRecipient.run_id == run.id)
        )
    ).scalars().all()

    capped = 0
    for recipient in manifest_rows:
        used = await count_recent_comms(
            db,
            tenant_id=recipient.tenant_id,
            app_id=recipient.app_id,
            phone_e164=recipient.phone_e164,
            window_seconds=policy.window_seconds,
        )
        if used < policy.max_count:
            continue
        await db.execute(
            update(WorkflowRunRecipientState)
            .where(
                WorkflowRunRecipientState.run_id == recipient.run_id,
                WorkflowRunRecipientState.recipient_id == recipient.recipient_id,
            )
            .values(status="skipped_capped")
        )
        capped += 1
    if capped:
        await db.flush()
    return capped
