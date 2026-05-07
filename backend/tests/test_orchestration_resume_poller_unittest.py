"""Resume poller — finds wakeup-due / ready recipients, advances them, submits resume jobs."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.job import BackgroundJob
from app.models.orchestration import WorkflowRunRecipientState
from app.services.orchestration.resume_poller import _wakeup_edge_target, poll_and_resume


def test_wakeup_edge_target_for_wait_node():
    defn = {
        "nodes": [
            {"id": "w", "type": "logic.wait"},
            {"id": "t", "type": "sink.complete"},
        ],
        "edges": [{"id": "e", "source": "w", "target": "t", "label": "wakeup"}],
    }
    assert _wakeup_edge_target(defn, "w") == "t"


def test_wakeup_edge_target_for_action_node_uses_success():
    defn = {
        "nodes": [
            {"id": "a", "type": "crm.send_wati"},
            {"id": "t", "type": "sink.complete"},
        ],
        "edges": [{"id": "e", "source": "a", "target": "t", "label": "success"}],
    }
    assert _wakeup_edge_target(defn, "a") == "t"


def test_wakeup_edge_target_falls_back_to_any_outgoing():
    defn = {
        "nodes": [{"id": "a", "type": "crm.send_wati"}, {"id": "t", "type": "sink.complete"}],
        "edges": [{"id": "e", "source": "a", "target": "t", "label": "default"}],
    }
    assert _wakeup_edge_target(defn, "a") == "t"


def test_wakeup_edge_target_missing_returns_none():
    assert _wakeup_edge_target({}, "x") is None
    assert _wakeup_edge_target({"nodes": [], "edges": []}, "x") is None


@pytest.mark.asyncio
async def test_due_waiting_recipients_advanced_to_next_node(db_session, seed_full_run):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    version.definition = {
        "nodes": [
            {"id": "wait_n", "type": "logic.wait", "config": {}},
            {"id": "term_n", "type": "sink.complete", "config": {}},
        ],
        "edges": [{"id": "e1", "source": "wait_n", "target": "term_n", "label": "wakeup"}],
        "canvas": {},
    }
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r-due", current_node_id="wait_n",
        status="waiting",
        wakeup_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        payload={},
    ))
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r-future", current_node_id="wait_n",
        status="waiting",
        wakeup_at=datetime.now(timezone.utc) + timedelta(hours=1),
        payload={},
    ))
    await db_session.flush()

    n = await poll_and_resume(db_session, batch_limit=100)
    assert n == 1

    rows = await db_session.execute(
        select(WorkflowRunRecipientState.recipient_id,
               WorkflowRunRecipientState.status,
               WorkflowRunRecipientState.current_node_id,
               WorkflowRunRecipientState.wakeup_at)
        .where(WorkflowRunRecipientState.run_id == run.id)
    )
    by_id = {r[0]: (r[1], r[2], r[3]) for r in rows.all()}
    assert by_id["r-due"][0] == "ready"
    assert by_id["r-due"][1] == "term_n"
    assert by_id["r-due"][2] is None
    assert by_id["r-future"][0] == "waiting"
    assert by_id["r-future"][1] == "wait_n"

    jobs = await db_session.execute(
        select(BackgroundJob).where(
            BackgroundJob.job_type == "run-workflow",
            BackgroundJob.status == "queued",
        )
    )
    matching = [j for j in jobs.scalars().all() if (j.params or {}).get("run_id") == str(run.id)]
    assert len(matching) == 1
    assert matching[0].params["resume_recipient_ids"] == ["r-due"]


@pytest.mark.asyncio
async def test_ready_recipients_picked_up_regardless_of_wakeup(db_session, seed_full_run):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    version.definition = {
        "nodes": [
            {"id": "act", "type": "crm.send_wati"},
            {"id": "next", "type": "sink.complete"},
        ],
        "edges": [{"id": "e", "source": "act", "target": "next", "label": "success"}],
        "canvas": {},
    }
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r-ready", current_node_id="act",
        status="ready", wakeup_at=None, payload={},
    ))
    await db_session.flush()

    n = await poll_and_resume(db_session, batch_limit=100)
    assert n == 1

    state = await db_session.execute(
        select(WorkflowRunRecipientState.current_node_id, WorkflowRunRecipientState.status)
        .where(WorkflowRunRecipientState.run_id == run.id,
               WorkflowRunRecipientState.recipient_id == "r-ready")
    )
    cn, st = state.first()
    assert cn == "next"
    assert st == "ready"


@pytest.mark.asyncio
async def test_no_due_returns_zero(db_session, seed_full_run):
    n = await poll_and_resume(db_session, batch_limit=100)
    assert n == 0
