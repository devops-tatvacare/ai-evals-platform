"""WATI webhook handler — parses payload, matches prior dispatch, writes follow-up action,
flips recipient state from waiting → ready when applicable, idempotent on redelivery."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.orchestration import (
    WorkflowConsentRecord,
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.webhook_handlers.wati import handle_wati_event


def _seed_dispatch(db, *, run, version, workflow, node_step, tenant_id, app_id, recipient_id, local_msg_id, key):
    db.add(WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, recipient_id=recipient_id,
        channel="wati", action_type="wa_dispatched", status="success",
        idempotency_key=key, payload={"template_name": "x"},
        response={"localMessageId": local_msg_id},
    ))


@pytest.mark.asyncio
async def test_delivered_event_appends_action(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    _seed_dispatch(db_session, run=run, version=version, workflow=workflow, node_step=node_step,
                   tenant_id=tenant_id, app_id=app_id,
                   recipient_id="L-1", local_msg_id="lm-99", key=f"k-{uuid.uuid4().hex[:8]}")
    await db_session.flush()

    payload = {"eventType": "sentMessageDELIVERED_v2", "localMessageId": "lm-99"}
    await handle_wati_event(db_session, tenant_id=tenant_id, app_id=app_id, payload=payload)

    rows = await db_session.execute(
        select(WorkflowRunRecipientAction.action_type)
        .where(WorkflowRunRecipientAction.run_id == run.id,
               WorkflowRunRecipientAction.recipient_id == "L-1")
    )
    types = sorted(t[0] for t in rows.all())
    assert "wa_delivered" in types
    assert "wa_dispatched" in types


@pytest.mark.asyncio
async def test_replied_event_flips_waiting_recipient_to_ready(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    _seed_dispatch(db_session, run=run, version=version, workflow=workflow, node_step=node_step,
                   tenant_id=tenant_id, app_id=app_id,
                   recipient_id="L-2", local_msg_id="lm-100", key=f"k-{uuid.uuid4().hex[:8]}")
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="L-2", current_node_id="wait_node",
        status="waiting", wakeup_at=datetime(2026, 5, 30, tzinfo=timezone.utc),
        payload={},
    ))
    await db_session.flush()

    payload = {
        "eventType": "sentMessageREPLIED_v2",
        "localMessageId": "lm-100",
        "messageBody": "Yes, please send details",
    }
    await handle_wati_event(db_session, tenant_id=tenant_id, app_id=app_id, payload=payload)

    state = await db_session.execute(
        select(WorkflowRunRecipientState.status, WorkflowRunRecipientState.wakeup_at)
        .where(WorkflowRunRecipientState.run_id == run.id,
               WorkflowRunRecipientState.recipient_id == "L-2")
    )
    status, wakeup = state.first()
    assert status == "ready"
    assert wakeup is None


@pytest.mark.asyncio
async def test_stop_keyword_flips_consent_to_opted_out(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    _seed_dispatch(db_session, run=run, version=version, workflow=workflow, node_step=node_step,
                   tenant_id=tenant_id, app_id=app_id,
                   recipient_id="L-3", local_msg_id="lm-stop", key=f"k-{uuid.uuid4().hex[:8]}")
    await db_session.flush()

    payload = {
        "eventType": "messageReceived",
        "localMessageId": "lm-stop",
        "waId": "919999990003",
        "messageBody": "STOP",
    }
    await handle_wati_event(db_session, tenant_id=tenant_id, app_id=app_id, payload=payload)

    consent = await db_session.execute(
        select(WorkflowConsentRecord.status, WorkflowConsentRecord.source)
        .where(WorkflowConsentRecord.tenant_id == tenant_id,
               WorkflowConsentRecord.recipient_id == "L-3",
               WorkflowConsentRecord.channel == "wa")
        .order_by(WorkflowConsentRecord.created_at.desc())
    )
    row = consent.first()
    assert row is not None
    assert row[0] == "opted_out"
    assert row[1] == "wa_reply_stop"


@pytest.mark.asyncio
async def test_idempotent_redelivery_no_duplicate_action(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    _seed_dispatch(db_session, run=run, version=version, workflow=workflow, node_step=node_step,
                   tenant_id=tenant_id, app_id=app_id,
                   recipient_id="L-x", local_msg_id="lm-x", key=f"k-{uuid.uuid4().hex[:8]}")
    await db_session.flush()

    payload = {"eventType": "sentMessageDELIVERED_v2", "localMessageId": "lm-x"}
    await handle_wati_event(db_session, tenant_id=tenant_id, app_id=app_id, payload=payload)
    await handle_wati_event(db_session, tenant_id=tenant_id, app_id=app_id, payload=payload)  # redelivery

    rows = await db_session.execute(
        select(WorkflowRunRecipientAction.id)
        .where(WorkflowRunRecipientAction.run_id == run.id,
               WorkflowRunRecipientAction.recipient_id == "L-x",
               WorkflowRunRecipientAction.action_type == "wa_delivered")
    )
    assert len(list(rows.all())) == 1


@pytest.mark.asyncio
async def test_unknown_event_type_is_a_noop(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    payload = {"eventType": "somethingNew", "localMessageId": "lm-?"}
    # Should not raise even though we have no parent action.
    await handle_wati_event(db_session, tenant_id=tenant_id, app_id=app_id, payload=payload)


@pytest.mark.asyncio
async def test_no_parent_action_drops_silently(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    payload = {"eventType": "sentMessageDELIVERED_v2", "localMessageId": "lm-orphan"}
    await handle_wati_event(db_session, tenant_id=tenant_id, app_id=app_id, payload=payload)
    rows = await db_session.execute(
        select(WorkflowRunRecipientAction.id).where(WorkflowRunRecipientAction.run_id == run.id)
    )
    assert list(rows.all()) == []
