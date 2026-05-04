"""Parse Bolna webhook events.

Per concierge spec §5.5:
  Match prior dispatch via response.execution_id.
  Terminal state derives one of bolna_answered / bolna_rnr / bolna_failed
  from status / status_reason. Idempotent on (event, execution_id, action).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)


def _classify_outcome(status: Optional[str], status_reason: Optional[str]) -> str:
    s = (status or "").lower()
    r = (status_reason or "").lower()
    if s in ("completed", "answered", "success") and "no-answer" not in r and "rnr" not in r and "busy" not in r:
        return "bolna_answered"
    if "no-answer" in r or "rnr" in s or "rnr" in r or "busy" in s or "busy" in r:
        return "bolna_rnr"
    return "bolna_failed"


async def handle_bolna_event(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    payload: dict[str, Any],
) -> None:
    execution_id = payload.get("execution_id")
    if not execution_id:
        return

    parent_stmt = select(WorkflowRunRecipientAction).where(
        WorkflowRunRecipientAction.tenant_id == tenant_id,
        WorkflowRunRecipientAction.channel == "bolna",
        WorkflowRunRecipientAction.action_type == "bolna_queued",
        WorkflowRunRecipientAction.response["execution_id"].astext == str(execution_id),
    ).limit(1)
    parent = (await db.execute(parent_stmt)).scalar_one_or_none()
    if parent is None:
        return

    new_action = _classify_outcome(payload.get("status"), payload.get("status_reason"))
    idem = f"webhook|bolna|{execution_id}|{new_action}"
    stmt = pg_insert(WorkflowRunRecipientAction).values(
        id=uuid.uuid4(),
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=parent.workflow_id, workflow_version_id=parent.workflow_version_id,
        run_id=parent.run_id, node_step_id=parent.node_step_id,
        recipient_id=parent.recipient_id, channel="bolna",
        action_type=new_action, status="success",
        idempotency_key=idem,
        payload={"event": "bolna_completion"},
        response=payload,
        parent_action_id=parent.id,
        completed_at=datetime.now(timezone.utc),
    ).on_conflict_do_nothing(constraint="uq_workflow_run_recipient_actions_idempotency")
    await db.execute(stmt)

    await db.execute(
        update(WorkflowRunRecipientState)
        .where(
            WorkflowRunRecipientState.run_id == parent.run_id,
            WorkflowRunRecipientState.recipient_id == parent.recipient_id,
            WorkflowRunRecipientState.status == "waiting",
        )
        .values(status="ready", wakeup_at=None)
    )
    # JSONB-merge the classified outcome into recipient payload so a
    # downstream conditional can route on it (mirrors the WATI handler's
    # ``wa_replied`` merge — same pattern, different field).
    await db.execute(
        update(WorkflowRunRecipientState)
        .where(
            WorkflowRunRecipientState.run_id == parent.run_id,
            WorkflowRunRecipientState.recipient_id == parent.recipient_id,
        )
        .values(
            payload=WorkflowRunRecipientState.payload.op("||")({"bolna_outcome": new_action})
        )
    )
    # Drive the workflow forward immediately. Replaces the ~60s
    # resume-waiting-cohorts cron latency with ±~1s worker pickup.
    # Idempotency key keys on execution_id + outcome so a webhook
    # arrival followed by a poller arrival collapses into one job.
    from app.services.orchestration.dispatch.resume_enqueue import (
        enqueue_resume_for_recipient,
    )
    await enqueue_resume_for_recipient(
        db,
        run_id=parent.run_id,
        recipient_id=parent.recipient_id,
        available_at=None,
        reason=f"ready:bolna:{execution_id}:{new_action}",
    )
    await db.flush()
