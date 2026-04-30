"""NodeContext exposes db/run state/services/idempotency to handlers.

Verifies dispatch_actions writes rows + honours idempotency,
set_recipient_state mutates the pointer row.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.orchestration import WorkflowRunRecipientAction, WorkflowRunRecipientState
from app.services.orchestration.node_context import NodeContext, ServiceRegistry
from app.services.orchestration.node_protocol import ActionDispatch


@pytest.mark.asyncio
async def test_dispatch_actions_writes_action_rows(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    state = WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="recip-A", current_node_id="n1",
        status="running", payload={},
    )
    db_session.add(state)
    await db_session.flush()

    ctx = NodeContext(
        db=db_session,
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, current_node_id="n1",
        services=ServiceRegistry(),
        job_id=None,
    )
    dispatches = [
        ActionDispatch(
            recipient_id="recip-A", channel="system", action_type="test_action",
            idempotency_key=f"idem-A-1-{uuid.uuid4().hex[:8]}", payload={"hello": "world"},
        )
    ]
    results = await ctx.dispatch_actions(dispatches)
    assert len(results) == 1
    assert results[0].status == "pending"

    rows = await db_session.execute(
        select(WorkflowRunRecipientAction).where(
            WorkflowRunRecipientAction.run_id == run.id
        )
    )
    actions = rows.scalars().all()
    assert len(actions) == 1
    assert actions[0].recipient_id == "recip-A"


@pytest.mark.asyncio
async def test_dispatch_actions_idempotent_on_duplicate_key(db_session, seed_full_run):
    """Second dispatch with same idempotency_key is a no-op (returns existing row)."""
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    state = WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="recip-B", current_node_id="n1",
        status="running", payload={},
    )
    db_session.add(state)
    await db_session.flush()

    ctx = NodeContext(
        db=db_session, tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, current_node_id="n1",
        services=ServiceRegistry(), job_id=None,
    )
    d = ActionDispatch(
        recipient_id="recip-B", channel="system", action_type="test_action",
        idempotency_key=f"idem-B-1-{uuid.uuid4().hex[:8]}", payload={"x": 1},
    )
    r1 = await ctx.dispatch_actions([d])
    r2 = await ctx.dispatch_actions([d])
    assert r1[0].action_id == r2[0].action_id

    rows = await db_session.execute(
        select(WorkflowRunRecipientAction).where(
            WorkflowRunRecipientAction.run_id == run.id
        )
    )
    assert len(rows.scalars().all()) == 1


@pytest.mark.asyncio
async def test_set_recipient_state_updates_pointer(db_session, seed_full_run):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    state = WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="recip-C", current_node_id="n1",
        status="running", payload={},
    )
    db_session.add(state)
    await db_session.flush()

    wakeup = datetime.now(timezone.utc)
    ctx = NodeContext(
        db=db_session, tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, current_node_id="n1",
        services=ServiceRegistry(), job_id=None,
    )
    await ctx.set_recipient_state("recip-C", status="waiting", wakeup_at=wakeup)
    await db_session.refresh(state)
    assert state.status == "waiting"
    assert state.wakeup_at is not None


def test_idempotency_key_deterministic():
    ctx = NodeContext(
        db=None, tenant_id=uuid.uuid4(), app_id="x",  # type: ignore[arg-type]
        workflow_id=uuid.uuid4(), workflow_version_id=uuid.UUID(int=1),
        run_id=uuid.uuid4(), node_step_id=uuid.uuid4(), current_node_id="node-A",
        services=ServiceRegistry(), job_id=None,
    )
    k1 = ctx.idempotency_key("recip-X", "attempt-1")
    k2 = ctx.idempotency_key("recip-X", "attempt-1")
    assert k1 == k2
    k3 = ctx.idempotency_key("recip-X", "attempt-2")
    assert k1 != k3
