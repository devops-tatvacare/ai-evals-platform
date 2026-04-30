"""Webhook handlers must merge wa_replied / bolna_outcome into recipient
payload so downstream conditionals can route on them.

Phase 8 introduced this — the seeded MQL Concierge workflow's "Replied?"
node reads ``payload.wa_replied``, populated only by the WATI webhook.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.orchestration import (
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.webhook_handlers.bolna import handle_bolna_event
from app.services.orchestration.webhook_handlers.wati import handle_wati_event


async def _seed_waiting_recipient_with_dispatched_action(
    db_session, run, version, workflow, node_step, tenant_id, app_id,
    *, channel: str, action_type: str, response_blob: dict,
):
    """Insert a 'waiting' recipient state + the parent dispatched action that
    a webhook would later resume."""
    state = WorkflowRunRecipientState(
        id=uuid.uuid4(),
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id,
        recipient_id="L-1",
        current_node_id="wait_node",
        status="waiting",
        wakeup_at=datetime.now(timezone.utc) + timedelta(hours=4),
        payload={"first_name": "A"},
        enrolled_at=datetime.now(timezone.utc),
    )
    db_session.add(state)

    parent = WorkflowRunRecipientAction(
        id=uuid.uuid4(),
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id,
        node_step_id=node_step.id,
        recipient_id="L-1",
        channel=channel,
        action_type=action_type,
        status="success",
        idempotency_key=f"test|{channel}|{uuid.uuid4()}",
        payload={},
        response=response_blob,
        completed_at=datetime.now(timezone.utc),
    )
    db_session.add(parent)
    await db_session.flush()
    return state, parent


@pytest.mark.asyncio
async def test_wati_replied_merges_wa_replied_flag_into_payload(
    db_session, seed_full_run,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    await _seed_waiting_recipient_with_dispatched_action(
        db_session, run, version, workflow, node_step, tenant_id, app_id,
        channel="wati", action_type="wa_dispatched",
        response_blob={"localMessageId": "lm-1"},
    )

    await handle_wati_event(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        payload={
            "eventType": "sentMessageREPLIED_v2",
            "localMessageId": "lm-1",
            "messageBody": "Yes please",
        },
    )

    state = await db_session.scalar(
        select(WorkflowRunRecipientState).where(
            WorkflowRunRecipientState.run_id == run.id,
            WorkflowRunRecipientState.recipient_id == "L-1",
        )
    )
    assert state is not None
    assert state.status == "ready"
    assert state.wakeup_at is None
    assert state.payload.get("wa_replied") is True
    assert state.payload.get("wa_reply_body") == "Yes please"
    # original payload preserved
    assert state.payload.get("first_name") == "A"


@pytest.mark.asyncio
async def test_wati_delivered_does_not_merge_replied_flag(
    db_session, seed_full_run,
):
    """sentMessageDELIVERED_v2 must not flip the recipient or merge wa_replied."""
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    await _seed_waiting_recipient_with_dispatched_action(
        db_session, run, version, workflow, node_step, tenant_id, app_id,
        channel="wati", action_type="wa_dispatched",
        response_blob={"localMessageId": "lm-2"},
    )

    await handle_wati_event(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        payload={
            "eventType": "sentMessageDELIVERED_v2",
            "localMessageId": "lm-2",
        },
    )

    state = await db_session.scalar(
        select(WorkflowRunRecipientState).where(
            WorkflowRunRecipientState.run_id == run.id,
            WorkflowRunRecipientState.recipient_id == "L-1",
        )
    )
    assert state.status == "waiting"
    assert "wa_replied" not in state.payload


@pytest.mark.asyncio
async def test_bolna_completion_merges_outcome_into_payload(
    db_session, seed_full_run,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    await _seed_waiting_recipient_with_dispatched_action(
        db_session, run, version, workflow, node_step, tenant_id, app_id,
        channel="bolna", action_type="bolna_queued",
        response_blob={"execution_id": "ex-1"},
    )

    await handle_bolna_event(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        payload={"execution_id": "ex-1", "status": "completed", "status_reason": "ok"},
    )

    state = await db_session.scalar(
        select(WorkflowRunRecipientState).where(
            WorkflowRunRecipientState.run_id == run.id,
            WorkflowRunRecipientState.recipient_id == "L-1",
        )
    )
    assert state is not None
    assert state.status == "ready"
    assert state.payload.get("bolna_outcome") == "bolna_answered"
