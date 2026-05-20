"""After a hard-Stop seals a recipient, a late provider webhook must not mutate
its state. The ``_reconciler`` TTL gate (ignore_webhooks_after) is the seal."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.models.orchestration import (
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.cancel.run_terminator import terminate_run
from app.services.orchestration.dispatch._reconciler import apply_terminal_event


PHONE = "+919876543210"


@pytest.mark.asyncio
async def test_late_webhook_after_abort_does_not_flip_state(db_session, seed_full_run):
    run, _version, _workflow, node_step, tenant_id, app_id = seed_full_run

    # A recipient mid-flight: waiting for a voice callback.
    state = WorkflowRunRecipientState(
        id=uuid.uuid4(),
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=run.workflow_id, workflow_version_id=run.workflow_version_id,
        run_id=run.id, recipient_id="R1", status="waiting",
        wakeup_at=datetime.now(timezone.utc) + timedelta(hours=1),
        payload={"contact": PHONE},
    )
    db_session.add(state)
    action = WorkflowRunRecipientAction(
        id=uuid.uuid4(),
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=run.workflow_id, workflow_version_id=run.workflow_version_id,
        run_id=run.id, node_step_id=node_step.id, recipient_id="R1",
        channel="voice", action_type="voice_queued", status="pending",
        idempotency_key=f"idem-{uuid.uuid4().hex[:8]}",
        provider_correlation_id="exec-1",
        payload={"contact": PHONE},
    )
    db_session.add(action)
    await db_session.flush()

    # Hard-Stop: recipient → aborted, ignore_webhooks_after stamped.
    await terminate_run(
        db_session, run_id=run.id, tenant_id=tenant_id,
        user_id=run.triggered_by_user_id, reason="operator",
    )
    await db_session.refresh(state)
    assert state.status == "aborted"
    assert state.ignore_webhooks_after is not None

    # The abort deadline is in the past for any webhook arriving afterward.
    await db_session.execute(
        text(
            "UPDATE orchestration.workflow_run_recipient_states "
            "SET ignore_webhooks_after = now() - interval '60 seconds' "
            "WHERE run_id = :rid AND recipient_id = 'R1'"
        ),
        {"rid": run.id},
    )
    await db_session.flush()

    # A delivery webhook lands late and is funnelled through the reconciler.
    await apply_terminal_event(
        db_session,
        action=action,
        response_patch={"provider_status": "completed", "last_event": {}},
        recipient_payload_patch={"voice_outcome": "answered"},
        node_id=node_step.node_id,
        provider_status="completed",
        child_action_type="bolna_answered",
        child_idempotency_key=f"webhook|bolna|exec-1|{uuid.uuid4().hex[:6]}",
    )

    refreshed = (
        await db_session.execute(
            select(WorkflowRunRecipientState).where(
                WorkflowRunRecipientState.run_id == run.id,
                WorkflowRunRecipientState.recipient_id == "R1",
            )
        )
    ).scalar_one()
    # State sealed: still aborted, and the gated payload merge never landed.
    assert refreshed.status == "aborted"
    assert "voice_outcome" not in (refreshed.payload or {})
    assert "last_outcome" not in (refreshed.payload or {})
