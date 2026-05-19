"""Run-start preview: walk the frozen manifest, pre-skip capped recipients.

Runs once per workflow run, right after ``freeze_recipients`` lands the
manifest at T0. Each manifest row is checked against the active comm-cap
policy via :func:`enforce_comm_cap_or_skip` in ``stage="cap_preview"`` mode,
so the operator sees the will-skip count before any provider call fires.
Returns a small receipt the caller can fold into the run params for the API
response.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import WorkflowRun, WorkflowRunRecipient
from app.services.orchestration.comm_cap.enforcement import enforce_comm_cap_or_skip


@dataclass(frozen=True)
class PreviewReceipt:
    capped_count: int
    proceeded_count: int


async def run_cap_preview(
    db: AsyncSession, *, run: WorkflowRun
) -> PreviewReceipt:
    manifest_rows = (
        await db.execute(
            select(WorkflowRunRecipient).where(
                WorkflowRunRecipient.run_id == run.id
            )
        )
    ).scalars().all()

    capped = 0
    proceeded = 0
    for recipient in manifest_rows:
        result = await enforce_comm_cap_or_skip(
            db, recipient=recipient, stage="cap_preview"
        )
        if result.proceed:
            proceeded += 1
        else:
            capped += 1
    return PreviewReceipt(capped_count=capped, proceeded_count=proceeded)
