"""run-workflow handler — entry-mode and resume-mode dispatch."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from pydantic import BaseModel
from sqlalchemy import select

from app.models.orchestration import (
    WorkflowRun,
    WorkflowRunRecipientState,
)
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import register_node


class _NoopConfig(BaseModel):
    pass


@register_node(workflow_type="*", node_type="test.entry_seeder")
class _EntrySeeder:
    """Entry node that 'materializes' two test recipients into workflow_run_recipient_states."""
    node_type = "test.entry_seeder"
    config_schema = _NoopConfig
    output_edges = ["default"]
    category = "source"

    async def execute(self, input_cohort, config, ctx):
        for rid in ["seed-a", "seed-b"]:
            ctx.db.add(WorkflowRunRecipientState(
                id=uuid.uuid4(), tenant_id=ctx.tenant_id, app_id=ctx.app_id,
                workflow_id=ctx.workflow_id, workflow_version_id=ctx.workflow_version_id,
                run_id=ctx.run_id, recipient_id=rid, current_node_id="n_term",
                status="ready", payload={"seeded": True},
            ))
        await ctx.db.flush()
        return NodeResult(summary={"cohort_size": 2})


@register_node(workflow_type="*", node_type="test.term")
class _Term:
    node_type = "test.term"
    config_schema = _NoopConfig
    output_edges = []
    category = "sink"

    async def execute(self, input_cohort, config, ctx):
        async for rid, _ in input_cohort:
            await ctx.set_recipient_state(rid, status="completed",
                                          completed_at=datetime.now(timezone.utc))
        return NodeResult()


@pytest.mark.asyncio
async def test_run_workflow_job_dispatches_source_then_terminal(db_session, seed_full_run):
    """run-workflow with no resume_recipient_ids should walk source → terminal."""
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    version.definition = {
        "nodes": [
            {"id": "n_entry", "type": "test.entry_seeder", "config": {}},
            {"id": "n_term", "type": "test.term", "config": {}},
        ],
        "edges": [
            {"id": "e1", "source": "n_entry", "target": "n_term", "label": "default"},
        ],
        "canvas": {},
    }
    await db_session.flush()

    from app.services.orchestration.run_handler import run_workflow_job
    result = await run_workflow_job(run.id, db_session)

    assert result["status"] == "completed"

    rows = await db_session.execute(
        select(WorkflowRunRecipientState.recipient_id, WorkflowRunRecipientState.status)
        .where(WorkflowRunRecipientState.run_id == run.id)
    )
    final = dict(rows.all())
    assert final.get("seed-a") == "completed"
    assert final.get("seed-b") == "completed"

    refreshed = await db_session.execute(
        select(WorkflowRun.status).where(WorkflowRun.id == run.id)
    )
    assert refreshed.scalar() == "completed"
