"""Bolna webhook handler — match on execution_id, classify outcome, advance recipient."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.orchestration import (
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.webhook_handlers.bolna import (
    _classify_outcome,
    handle_bolna_event,
)


def test_classify_answered():
    assert _classify_outcome("completed", "answered") == "bolna_answered"
    assert _classify_outcome("answered", None) == "bolna_answered"


def test_classify_rnr():
    assert _classify_outcome("completed", "no-answer") == "bolna_rnr"
    assert _classify_outcome("rnr", None) == "bolna_rnr"
    assert _classify_outcome(None, "busy") == "bolna_rnr"


def test_classify_failed():
    assert _classify_outcome("failed", None) == "bolna_failed"
    assert _classify_outcome(None, None) == "bolna_failed"


def _seed_bolna_dispatch(db, *, run, version, workflow, node_step, tenant_id, app_id, recipient_id, exec_id):
    db.add(WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, recipient_id=recipient_id,
        channel="bolna", action_type="bolna_queued", status="success",
        idempotency_key=f"bk-{uuid.uuid4().hex[:8]}",
        payload={}, response={"execution_id": exec_id},
    ))


@pytest.mark.asyncio
async def test_bolna_completion_writes_outcome_and_resumes(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    _seed_bolna_dispatch(db_session, run=run, version=version, workflow=workflow, node_step=node_step,
                         tenant_id=tenant_id, app_id=app_id,
                         recipient_id="L-9", exec_id="ex-9")
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="L-9", current_node_id="wait_after_call",
        status="waiting", wakeup_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
        payload={},
    ))
    await db_session.flush()

    await handle_bolna_event(db_session, tenant_id=tenant_id, app_id=app_id, payload={
        "execution_id": "ex-9", "status": "completed", "status_reason": "answered",
    })

    actions = await db_session.execute(
        select(WorkflowRunRecipientAction.action_type)
        .where(WorkflowRunRecipientAction.run_id == run.id)
    )
    types = {a[0] for a in actions.all()}
    assert "bolna_answered" in types

    state = await db_session.execute(
        select(WorkflowRunRecipientState.status, WorkflowRunRecipientState.wakeup_at)
        .where(WorkflowRunRecipientState.run_id == run.id,
               WorkflowRunRecipientState.recipient_id == "L-9")
    )
    status, wakeup = state.first()
    assert status == "ready"
    assert wakeup is None


@pytest.mark.asyncio
async def test_bolna_rnr_does_not_block_action_row(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    _seed_bolna_dispatch(db_session, run=run, version=version, workflow=workflow, node_step=node_step,
                         tenant_id=tenant_id, app_id=app_id,
                         recipient_id="L-rnr", exec_id="ex-rnr")
    await db_session.flush()
    await handle_bolna_event(db_session, tenant_id=tenant_id, app_id=app_id, payload={
        "execution_id": "ex-rnr", "status": "completed", "status_reason": "no-answer",
    })
    rows = await db_session.execute(
        select(WorkflowRunRecipientAction.action_type)
        .where(WorkflowRunRecipientAction.run_id == run.id,
               WorkflowRunRecipientAction.recipient_id == "L-rnr")
    )
    types = sorted(t[0] for t in rows.all())
    assert "bolna_rnr" in types


@pytest.mark.asyncio
async def test_bolna_idempotent_redelivery(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    _seed_bolna_dispatch(db_session, run=run, version=version, workflow=workflow, node_step=node_step,
                         tenant_id=tenant_id, app_id=app_id,
                         recipient_id="L-id", exec_id="ex-id")
    await db_session.flush()
    payload = {"execution_id": "ex-id", "status": "answered"}
    await handle_bolna_event(db_session, tenant_id=tenant_id, app_id=app_id, payload=payload)
    await handle_bolna_event(db_session, tenant_id=tenant_id, app_id=app_id, payload=payload)

    rows = await db_session.execute(
        select(WorkflowRunRecipientAction.id)
        .where(WorkflowRunRecipientAction.run_id == run.id,
               WorkflowRunRecipientAction.recipient_id == "L-id",
               WorkflowRunRecipientAction.action_type == "bolna_answered")
    )
    assert len(list(rows.all())) == 1


@pytest.mark.asyncio
async def test_bolna_unknown_execution_id_drops_silently(db_session, seed_full_run):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    await handle_bolna_event(db_session, tenant_id=tenant_id, app_id=app_id, payload={
        "execution_id": "ex-orphan", "status": "answered",
    })
    rows = await db_session.execute(
        select(WorkflowRunRecipientAction.id).where(WorkflowRunRecipientAction.run_id == run.id)
    )
    assert list(rows.all()) == []
