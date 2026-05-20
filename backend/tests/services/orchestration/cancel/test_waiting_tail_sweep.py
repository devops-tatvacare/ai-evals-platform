"""waiting-tail TTL sweep: abort recipients parked in 'waiting' past a completed run's TTL."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.orchestration import (
    Workflow,
    WorkflowRun,
    WorkflowRunRecipientState,
    WorkflowVersion,
)
from app.services.orchestration.cancel.waiting_tail_sweep import (
    DEFAULT_WAIT_TTL_SECONDS,
    sweep_waiting_tail_ttl,
)


async def _seed_completed_run_with_waiting_recipient(
    db,
    *,
    tenant_id,
    user_id,
    app_id,
    completed_age_seconds: float,
    run_status: str = "completed",
    max_wait_seconds: int | None = None,
    now: datetime,
):
    """Create workflow + version + run (completed `completed_age_seconds` ago) + one
    'waiting' recipient. Returns the recipient state row."""
    workflow = Workflow(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_type="crm", slug=f"sweep-{uuid.uuid4().hex[:8]}",
        name="Sweep", created_by=user_id,
        max_wait_after_completion_seconds=max_wait_seconds,
    )
    db.add(workflow)
    await db.flush()

    version = WorkflowVersion(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, version=1,
        definition={"nodes": [], "edges": []}, status="published",
    )
    db.add(version)
    await db.flush()

    run = WorkflowRun(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        triggered_by="manual", triggered_by_user_id=user_id,
        status=run_status,
        completed_at=now - timedelta(seconds=completed_age_seconds),
    )
    db.add(run)
    await db.flush()

    state = WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id=f"R-{uuid.uuid4().hex[:6]}",
        status="waiting",
        wakeup_at=now + timedelta(days=30),  # CHECK: waiting rows carry a wakeup_at
    )
    db.add(state)
    await db.flush()
    return state


@pytest.fixture
def now():
    return datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_expired_waiting_recipient_aborted(db_session, seed_tenant_user_app, now):
    tenant_id, user_id, app_id = seed_tenant_user_app
    state = await _seed_completed_run_with_waiting_recipient(
        db_session, tenant_id=tenant_id, user_id=user_id, app_id=app_id,
        completed_age_seconds=DEFAULT_WAIT_TTL_SECONDS + 86400,  # 1 day past default TTL
        now=now,
    )

    swept = await sweep_waiting_tail_ttl(db_session, now=now)

    assert swept == 1
    await db_session.refresh(state)
    assert state.status == "aborted_expired"
    assert state.ignore_webhooks_after is not None


@pytest.mark.asyncio
async def test_within_ttl_untouched(db_session, seed_tenant_user_app, now):
    tenant_id, user_id, app_id = seed_tenant_user_app
    state = await _seed_completed_run_with_waiting_recipient(
        db_session, tenant_id=tenant_id, user_id=user_id, app_id=app_id,
        completed_age_seconds=3600,  # 1 hour ago — well within the 7d default
        now=now,
    )

    swept = await sweep_waiting_tail_ttl(db_session, now=now)

    assert swept == 0
    await db_session.refresh(state)
    assert state.status == "waiting"
    assert state.ignore_webhooks_after is None


@pytest.mark.asyncio
async def test_per_workflow_override_honored(db_session, seed_tenant_user_app, now):
    tenant_id, user_id, app_id = seed_tenant_user_app
    # Override TTL to 60s; the run completed 120s ago → past its (overridden) TTL.
    state = await _seed_completed_run_with_waiting_recipient(
        db_session, tenant_id=tenant_id, user_id=user_id, app_id=app_id,
        completed_age_seconds=120, max_wait_seconds=60, now=now,
    )

    swept = await sweep_waiting_tail_ttl(db_session, now=now)

    assert swept == 1
    await db_session.refresh(state)
    assert state.status == "aborted_expired"


@pytest.mark.asyncio
async def test_non_completed_run_untouched(db_session, seed_tenant_user_app, now):
    tenant_id, user_id, app_id = seed_tenant_user_app
    # A still-running run whose recipient is parked far in the past must NOT be swept —
    # the seal only applies after the run itself reaches 'completed'.
    state = await _seed_completed_run_with_waiting_recipient(
        db_session, tenant_id=tenant_id, user_id=user_id, app_id=app_id,
        completed_age_seconds=DEFAULT_WAIT_TTL_SECONDS + 86400,
        run_status="running", now=now,
    )

    swept = await sweep_waiting_tail_ttl(db_session, now=now)

    assert swept == 0
    await db_session.refresh(state)
    assert state.status == "waiting"
