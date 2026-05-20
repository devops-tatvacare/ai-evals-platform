"""run_terminator: synchronous flip of run + recipient states, finalize job, idempotent."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.job import BackgroundJob
from app.models.orchestration import WorkflowRunRecipientState
from app.services.orchestration.cancel.run_terminator import (
    TerminationReason,
    terminate_run,
)


def _state(*, run, tenant_id, app_id, recipient_id, status):
    return WorkflowRunRecipientState(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=run.workflow_id,
        workflow_version_id=run.workflow_version_id,
        run_id=run.id,
        recipient_id=recipient_id,
        status=status,
        payload={"contact": f"+9198765{recipient_id}"},
    )


@pytest_asyncio.fixture
async def run_with_states(db_session, seed_full_run):
    """A running run + a spread of recipient states (non-terminal + terminal)."""
    run, _version, _workflow, _node_step, tenant_id, app_id = seed_full_run
    rows = [
        _state(run=run, tenant_id=tenant_id, app_id=app_id, recipient_id="10001", status="pending"),
        _state(run=run, tenant_id=tenant_id, app_id=app_id, recipient_id="10002", status="ready"),
        _state(run=run, tenant_id=tenant_id, app_id=app_id, recipient_id="10003", status="completed"),
        _state(run=run, tenant_id=tenant_id, app_id=app_id, recipient_id="10004", status="skipped_capped"),
    ]
    for r in rows:
        db_session.add(r)
    await db_session.flush()
    return run, tenant_id


@pytest.mark.asyncio
async def test_terminate_flips_run_and_recipient_states(db_session, run_with_states):
    run, tenant_id = run_with_states
    receipt = await terminate_run(
        db_session,
        run_id=run.id, tenant_id=tenant_id, user_id=run.triggered_by_user_id,
        reason=TerminationReason.operator,
    )
    assert receipt is not None
    assert receipt.run_id == run.id
    assert receipt.recipients_aborted == 2  # pending + ready

    await db_session.refresh(run)
    assert run.status == "cancelled"
    assert run.cancel_requested_at is not None
    assert run.cancel_requested_by == run.triggered_by_user_id

    states = {
        s.recipient_id: s
        for s in (
            await db_session.execute(
                select(WorkflowRunRecipientState).where(
                    WorkflowRunRecipientState.run_id == run.id
                )
            )
        ).scalars().all()
    }
    assert states["10001"].status == "aborted"
    assert states["10001"].ignore_webhooks_after is not None
    assert states["10002"].status == "aborted"
    assert states["10003"].status == "completed"  # terminal untouched
    assert states["10004"].status == "skipped_capped"  # terminal untouched


@pytest.mark.asyncio
async def test_terminate_submits_one_finalize_job(db_session, run_with_states):
    run, tenant_id = run_with_states
    await terminate_run(
        db_session, run_id=run.id, tenant_id=tenant_id,
        user_id=run.triggered_by_user_id, reason="operator",
    )
    jobs = [
        j
        for j in (
            await db_session.execute(
                select(BackgroundJob).where(
                    BackgroundJob.job_type == "finalize-run-cancel",
                )
            )
        ).scalars().all()
        if j.params.get("run_id") == str(run.id)
    ]
    assert len(jobs) == 1
    assert jobs[0].params["tenant_id"] == str(tenant_id)
    assert jobs[0].params["user_id"] == str(run.triggered_by_user_id)


@pytest.mark.asyncio
async def test_terminate_is_idempotent(db_session, run_with_states):
    run, tenant_id = run_with_states
    r1 = await terminate_run(
        db_session, run_id=run.id, tenant_id=tenant_id,
        user_id=run.triggered_by_user_id, reason="operator",
    )
    r2 = await terminate_run(
        db_session, run_id=run.id, tenant_id=tenant_id,
        user_id=run.triggered_by_user_id, reason="operator",
    )
    assert r1.run_id == r2.run_id == run.id
    assert r2.status == "cancelled"
    # Second call must not flip already-aborted recipients again, nor enqueue a
    # second finalize job.
    assert r2.recipients_aborted == 0
    jobs = [
        j
        for j in (
            await db_session.execute(
                select(BackgroundJob).where(
                    BackgroundJob.job_type == "finalize-run-cancel",
                )
            )
        ).scalars().all()
        if j.params.get("run_id") == str(run.id)
    ]
    assert len(jobs) == 1


@pytest.mark.asyncio
async def test_terminate_unknown_run_returns_none(db_session, seed_tenant_user_app):
    tenant_id, user_id, _app_id = seed_tenant_user_app
    result = await terminate_run(
        db_session, run_id=uuid.uuid4(), tenant_id=tenant_id,
        user_id=user_id, reason="operator",
    )
    assert result is None
