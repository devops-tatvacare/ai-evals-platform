"""Two-stage cap enforcement: preview at T0, authoritative at dispatch.

A cap skip flips the recipient state row to ``skipped_capped`` and returns
``EnforcementResult(proceed=False, reason=stage)``. The dispatch ledger
(``workflow_run_recipient_actions``) is NOT written to — its CHECK and
required columns are for dispatch attempts, not policy decisions. The state
row + run-level preview summary cover the operator-visible audit.

Callers pass only the manifest row; ``tenant_id``, ``app_id``, ``run_id``,
and the recipient phone all hang off it, which keeps the dispatch-node call
site to a single line without forcing those nodes to fetch the
``WorkflowRun`` row.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    WorkflowRunRecipient,
    WorkflowRunRecipientState,
)
from app.services.orchestration.comm_cap.policy_resolver import is_capped


@dataclass(frozen=True)
class EnforcementResult:
    proceed: bool
    reason: str | None = None


async def enforce_comm_cap_or_skip(
    db: AsyncSession,
    *,
    recipient: WorkflowRunRecipient,
    stage: str = "cap_runtime",
) -> EnforcementResult:
    """Skip the recipient if the (tenant, app) cap is hit; otherwise proceed.

    ``stage`` is ``"cap_preview"`` (T0 walk over the frozen manifest) or
    ``"cap_runtime"`` (authoritative check at the dispatch node). Both flip
    the state row to ``skipped_capped``; the reason string surfaces the
    stage so the operator can distinguish them in logs.
    """
    capped = await is_capped(
        db,
        tenant_id=recipient.tenant_id,
        app_id=recipient.app_id,
        phone_e164=recipient.phone_e164,
    )
    if not capped:
        return EnforcementResult(proceed=True)

    await db.execute(
        update(WorkflowRunRecipientState)
        .where(
            WorkflowRunRecipientState.run_id == recipient.run_id,
            WorkflowRunRecipientState.recipient_id == recipient.recipient_id,
        )
        .values(status="skipped_capped")
    )
    await db.flush()
    return EnforcementResult(proceed=False, reason=stage)
