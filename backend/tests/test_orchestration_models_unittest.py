"""ORM model round-trip + FK behaviour for orchestration.* tables.

Uses the live-DB `db_session` fixture from conftest.py — assertions are real
inserts against Postgres, so CHECK / UNIQUE / FK behaviour matches production.
Each test rolls back at teardown so test rows don't persist.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, DBAPIError

from app.models.orchestration import (
    Workflow,
    WorkflowVersion,
    WorkflowRunRecipientAction,
    WorkflowRunRecipientOverride,
    WorkflowRunRecipientState,
)


@pytest.mark.asyncio
async def test_workflow_round_trip(db_session, seed_tenant_user_app):
    """Insert + select."""
    tenant_id, user_id, app_id = seed_tenant_user_app
    wf_id = uuid.uuid4()
    wf = Workflow(
        id=wf_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_type="crm",
        slug=f"test-wf-{wf_id.hex[:8]}",
        name="Test Workflow",
        created_by=user_id,
    )
    db_session.add(wf)
    await db_session.flush()

    result = await db_session.execute(select(Workflow).where(Workflow.id == wf_id))
    loaded = result.scalar_one()
    assert loaded.workflow_type == "crm"
    assert loaded.current_published_version_id is None


@pytest.mark.asyncio
async def test_workflow_version_unique_per_workflow(db_session, seed_tenant_user_app):
    """version is unique within workflow — second insert with same (workflow_id, version) fails."""
    tenant_id, user_id, app_id = seed_tenant_user_app
    wf = Workflow(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_type="crm", slug=f"uniq-wf-{uuid.uuid4().hex[:8]}",
        name="Uniq", created_by=user_id,
    )
    db_session.add(wf)
    await db_session.flush()

    v1 = WorkflowVersion(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=wf.id, version=1, definition={"nodes": [], "edges": []},
    )
    db_session.add(v1)
    await db_session.flush()

    v2_dup = WorkflowVersion(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=wf.id, version=1, definition={"nodes": [], "edges": []},
    )
    db_session.add(v2_dup)
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_action_double_dispatch_guard(db_session, seed_full_run):
    """Concurrent pending wa_dispatched for same recipient is rejected by partial unique index."""
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    a1 = WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, recipient_id="recip-1",
        channel="wati", action_type="wa_dispatched", status="pending",
        idempotency_key=f"key-1-{uuid.uuid4().hex[:8]}", payload={"template": "x"},
    )
    db_session.add(a1)
    await db_session.flush()

    a2 = WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, recipient_id="recip-1",
        channel="wati", action_type="wa_dispatched", status="pending",
        idempotency_key=f"key-2-{uuid.uuid4().hex[:8]}", payload={"template": "y"},
    )
    db_session.add(a2)
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_recipient_state_waiting_requires_wakeup(db_session, seed_full_run):
    """status='waiting' requires non-null wakeup_at (CHECK constraint)."""
    run, version, workflow, _node_step, tenant_id, app_id = seed_full_run
    bad = WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="recip-2", current_node_id="n1",
        status="waiting", wakeup_at=None,
        payload={},
    )
    db_session.add(bad)
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_override_jump_requires_target(db_session, seed_full_run):
    """action='jump_to_node' requires target_node_id (CHECK constraint)."""
    run, version, workflow, _node_step, tenant_id, app_id = seed_full_run
    user_id = run.triggered_by_user_id
    bad = WorkflowRunRecipientOverride(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r", action="jump_to_node",
        target_node_id=None, applied_by=user_id, applied_at=datetime.now(timezone.utc),
    )
    db_session.add(bad)
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()
