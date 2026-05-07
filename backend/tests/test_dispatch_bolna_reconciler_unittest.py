"""Phase 13 / E.1 — bolna_reconciler.apply_event idempotency + capture.

The reconciler is the shared persistence path for both webhook events
and poller-fetched executions. These tests focus on the bits the
existing webhook unit suite doesn't cover:

- idempotency on action.completed_at (a second reconcile no-ops),
- capture-field extraction from telephony_data,
- recipient state payload merge with bolna_recording_url / duration /
  transcript / total_cost when the upstream supplies them.
- cost normalization from Bolna provider subunits into major units.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.orchestration import (
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.dispatch import bolna_reconciler


def test_classify_outcome_pure_function():
    cls = bolna_reconciler.classify_outcome
    assert cls("completed", "answered") == "bolna_answered"
    assert cls("completed", "no-answer") == "bolna_rnr"
    assert cls("busy", None) == "bolna_rnr"
    assert cls("rnr", None) == "bolna_rnr"
    assert cls("failed", None) == "bolna_failed"
    assert cls("error", "balance-low") == "bolna_failed"


def test_is_terminal_recognises_documented_set():
    is_t = bolna_reconciler.is_terminal
    for s in ("completed", "failed", "no-answer", "busy", "stopped",
              "error", "balance-low", "canceled", "cancelled"):
        assert is_t(s), s
    for s in ("queued", "in-progress", "ringing", None, ""):
        assert not is_t(s), s


def _seed_dispatch(db, *, run, version, workflow, node_step, tenant_id, app_id,
                   recipient_id, exec_id) -> WorkflowRunRecipientAction:
    action = WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, recipient_id=recipient_id,
        channel="bolna", action_type="bolna_queued", status="success",
        idempotency_key=f"bk-{uuid.uuid4().hex[:8]}",
        payload={}, response={"execution_id": exec_id},
    )
    db.add(action)
    return action


@pytest.mark.asyncio
async def test_apply_event_captures_telephony_data(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    parent = _seed_dispatch(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-cap", exec_id="ex-cap",
    )
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="L-cap", current_node_id="bn",
        status="waiting", wakeup_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
        payload={},
    ))
    await db_session.flush()

    event = {
        "execution_id": "ex-cap",
        "status": "completed",
        "status_reason": "answered",
        "transcript": "hi - bye",
        "total_cost": "3.4",
        "cost_breakdown": {
            "llm": 1.2,
            "telephony": 2.2,
            "llm_breakdown": {
                "conversation": 1.0,
                "summary": 0.2,
            },
        },
        "telephony_data": {
            "recording_url": "https://r.example/rec/ex-cap.wav",
            "duration": 42,
            "telephony_provider": "plivo",
        },
    }
    applied = await bolna_reconciler.apply_event(db_session, action=parent, event=event)
    assert applied is True

    # Parent action picked up the capture fields + provider hints.
    # ``completed_at`` stays at queue time (set by the dispatch node) — the
    # reconciler flips ``provider_terminal`` instead so the poller knows
    # the row is closed without disturbing the dispatch-time timestamp.
    await db_session.refresh(parent)
    refreshed = parent
    assert refreshed is not None
    assert refreshed.provider_terminal is True
    assert refreshed.provider_status == "completed"
    assert refreshed.response["bolna_outcome"] == "bolna_answered"
    assert refreshed.response["recording_url"] == "https://r.example/rec/ex-cap.wav"
    assert refreshed.response["duration_sec"] == 42
    assert refreshed.response["transcript"] == "hi - bye"
    assert refreshed.response["total_cost"] == 0.034
    assert refreshed.response["cost_breakdown"] == {
        "llm": 0.012,
        "telephony": 0.022,
        "llm_breakdown": {
            "conversation": 0.01,
            "summary": 0.002,
        },
    }

    # Recipient state state flipped + payload merged.
    state = (await db_session.execute(
        select(WorkflowRunRecipientState.status, WorkflowRunRecipientState.payload)
        .where(WorkflowRunRecipientState.run_id == run.id,
               WorkflowRunRecipientState.recipient_id == "L-cap")
    )).first()
    assert state is not None
    status, payload = state
    assert status == "ready"
    assert payload["bolna_outcome"] == "bolna_answered"
    assert payload["bolna_recording_url"] == "https://r.example/rec/ex-cap.wav"
    assert payload["bolna_duration_sec"] == 42
    assert payload["bolna_transcript"] == "hi - bye"
    assert payload["bolna_total_cost"] == 0.034

    # Audit child action persisted.
    child_types = (await db_session.execute(
        select(WorkflowRunRecipientAction.action_type).where(
            WorkflowRunRecipientAction.parent_action_id == parent.id,
        )
    )).scalars().all()
    assert "bolna_answered" in child_types
    child_response = (await db_session.execute(
        select(WorkflowRunRecipientAction.response).where(
            WorkflowRunRecipientAction.parent_action_id == parent.id,
            WorkflowRunRecipientAction.action_type == "bolna_answered",
        )
    )).scalar_one()
    assert child_response["total_cost"] == 0.034
    assert child_response["last_event"]["total_cost"] == "3.4"


@pytest.mark.asyncio
async def test_apply_event_is_idempotent_on_completed_at(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    parent = _seed_dispatch(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-id", exec_id="ex-id",
    )
    await db_session.flush()

    event = {"execution_id": "ex-id", "status": "completed", "status_reason": "answered"}
    first = await bolna_reconciler.apply_event(db_session, action=parent, event=event)
    await db_session.refresh(parent)
    refreshed = parent
    assert first is True
    assert refreshed is not None and refreshed.provider_terminal is True

    # Re-applying must no-op — return False, exactly one child action row.
    second = await bolna_reconciler.apply_event(db_session, action=refreshed, event=event)
    assert second is False
    children = (await db_session.execute(
        select(WorkflowRunRecipientAction.id).where(
            WorkflowRunRecipientAction.parent_action_id == parent.id,
            WorkflowRunRecipientAction.action_type == "bolna_answered",
        )
    )).all()
    assert len(children) == 1


@pytest.mark.asyncio
async def test_apply_event_skips_non_terminal(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    parent = _seed_dispatch(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-mid", exec_id="ex-mid",
    )
    await db_session.flush()

    event = {"execution_id": "ex-mid", "status": "in-progress"}
    applied = await bolna_reconciler.apply_event(db_session, action=parent, event=event)
    assert applied is False
    await db_session.refresh(parent)
    refreshed = parent
    assert refreshed is not None
    assert refreshed.provider_terminal is False
