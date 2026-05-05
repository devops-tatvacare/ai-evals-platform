"""Graph traversal — walk_graph + edge resolution + override consumption.

Uses an in-process NoopHandler that emits all recipients down 'default' edge,
to exercise the engine without dragging in real node implementations.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from pydantic import BaseModel
from sqlalchemy import select

from app.models.orchestration import (
    WorkflowRunNodeStep,
    WorkflowRunRecipientOverride,
    WorkflowRunRecipientState,
)
from app.services.orchestration.node_protocol import NodeResult, RecipientOutcome
from app.services.orchestration.node_registry import register_node
from app.services.orchestration.traversal import RunExecutor


class _NoopConfig(BaseModel):
    pass


@register_node(workflow_type="*", node_type="test.passthrough")
class _PassthroughHandler:
    node_type = "test.passthrough"
    config_schema = _NoopConfig
    output_edges = ["default"]
    category = "logic"

    async def execute(self, input_cohort, config, ctx):
        outcomes = []
        async for rid, _payload in input_cohort:
            outcomes.append(RecipientOutcome(recipient_id=rid))
        return NodeResult(by_output_id={"default": outcomes})


@register_node(workflow_type="*", node_type="test.terminal")
class _TerminalHandler:
    node_type = "test.terminal"
    config_schema = _NoopConfig
    output_edges = []
    category = "sink"

    async def execute(self, input_cohort, config, ctx):
        async for rid, _ in input_cohort:
            await ctx.set_recipient_state(rid, status="completed",
                                          completed_at=datetime.now(timezone.utc))
        return NodeResult()


@register_node(workflow_type="*", node_type="test.terminal_payload")
class _TerminalPayloadHandler:
    node_type = "test.terminal_payload"
    config_schema = _NoopConfig
    output_edges = []
    category = "sink"

    async def execute(self, input_cohort, config, ctx):
        del config, ctx
        outcomes = []
        async for rid, payload in input_cohort:
            outcomes.append(
                RecipientOutcome(
                    recipient_id=rid,
                    payload_delta={"final_note": payload.get("note", "done")},
                )
            )
        return NodeResult(by_output_id={"default": outcomes})


def _make_definition():
    return {
        "nodes": [
            {"id": "n_entry", "type": "test.passthrough", "config": {}},
            {"id": "n_b", "type": "test.terminal", "config": {}},
        ],
        "edges": [
            {"id": "e1", "source": "n_entry", "target": "n_b", "label": "default"},
        ],
        "canvas": {},
    }


def test_node_result_accepts_legacy_by_edge_label_alias():
    result = NodeResult(by_edge_label={"default": [RecipientOutcome(recipient_id="r-1")]})

    assert list(result.by_output_id) == ["default"]
    assert result.by_output_id["default"][0].recipient_id == "r-1"


@pytest.mark.asyncio
async def test_walk_graph_advances_recipients_to_terminal(db_session, seed_full_run):
    """Recipients flow entry → terminal, end up status='completed'."""
    run, version, workflow, _entry_step, tenant_id, app_id = seed_full_run
    version.definition = _make_definition()
    await db_session.flush()

    for rid in ["r-1", "r-2"]:
        db_session.add(WorkflowRunRecipientState(
            id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
            workflow_id=workflow.id, workflow_version_id=version.id,
            run_id=run.id, recipient_id=rid, current_node_id="n_entry",
            status="ready", payload={},
        ))
    await db_session.flush()

    executor = RunExecutor(db=db_session, run=run, version=version, workflow=workflow, job_id=None)
    await executor.run_until_quiescent()

    rows = await db_session.execute(
        select(WorkflowRunRecipientState.recipient_id, WorkflowRunRecipientState.status)
        .where(WorkflowRunRecipientState.run_id == run.id)
    )
    states = dict(rows.all())
    assert states == {"r-1": "completed", "r-2": "completed"}


@pytest.mark.asyncio
async def test_override_pause_skips_node_dispatch(db_session, seed_full_run):
    """A 'pause' override on a recipient flips them to 'overridden' before dispatch."""
    run, version, workflow, _entry_step, tenant_id, app_id = seed_full_run
    version.definition = _make_definition()
    await db_session.flush()

    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r-paused", current_node_id="n_entry",
        status="ready", payload={},
    ))
    db_session.add(WorkflowRunRecipientOverride(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r-paused", action="pause",
        applied_by=run.triggered_by_user_id, applied_at=datetime.now(timezone.utc),
    ))
    await db_session.flush()

    executor = RunExecutor(db=db_session, run=run, version=version, workflow=workflow, job_id=None)
    await executor.run_until_quiescent()

    state = await db_session.execute(
        select(WorkflowRunRecipientState).where(
            WorkflowRunRecipientState.run_id == run.id,
            WorkflowRunRecipientState.recipient_id == "r-paused",
        )
    )
    s = state.scalar_one()
    assert s.status == "overridden"


@pytest.mark.asyncio
async def test_node_step_rows_persisted(db_session, seed_full_run):
    """One workflow_run_node_steps row per node visited."""
    run, version, workflow, _entry_step, tenant_id, app_id = seed_full_run
    version.definition = _make_definition()
    await db_session.flush()

    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r-step", current_node_id="n_entry",
        status="ready", payload={},
    ))
    await db_session.flush()

    executor = RunExecutor(db=db_session, run=run, version=version, workflow=workflow, job_id=None)
    await executor.run_until_quiescent()

    steps = await db_session.execute(
        select(WorkflowRunNodeStep.node_id, WorkflowRunNodeStep.status)
        .where(WorkflowRunNodeStep.run_id == run.id)
    )
    by_node = dict(steps.all())
    assert by_node.get("n_entry") == "completed"
    assert by_node.get("n_b") == "completed"


@pytest.mark.asyncio
async def test_terminal_branch_merges_payload_delta_without_outgoing_edges(
    db_session, seed_full_run,
):
    run, version, workflow, _entry_step, tenant_id, app_id = seed_full_run
    version.definition = {
        "nodes": [
            {"id": "n_entry", "type": "test.terminal_payload", "config": {}},
        ],
        "edges": [],
        "canvas": {},
    }
    await db_session.flush()

    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r-1", current_node_id="n_entry",
        status="ready", payload={"note": "queued"},
    ))
    await db_session.flush()

    executor = RunExecutor(db=db_session, run=run, version=version, workflow=workflow, job_id=None)
    await executor.run_until_quiescent()

    state = await db_session.execute(
        select(WorkflowRunRecipientState).where(
            WorkflowRunRecipientState.run_id == run.id,
            WorkflowRunRecipientState.recipient_id == "r-1",
        )
    )
    row = state.scalar_one()
    assert row.status == "completed"
    assert row.payload["final_note"] == "queued"
