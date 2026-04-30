"""Generic event dispatcher + LSQ webhook handler.

Both fan out to matching workflow_triggers, create one workflow_run + one
BackgroundJob('run-workflow') per match. The job is queued for the worker.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.job import BackgroundJob
from app.models.orchestration import (
    WorkflowRun,
    WorkflowTrigger,
)
from app.services.orchestration.webhook_handlers.generic_event import (
    EventPayloadContractError,
    fire_event,
)
from app.services.orchestration.webhook_handlers.lsq import handle_lsq_event


@pytest.mark.asyncio
async def test_event_creates_runs_for_matching_triggers(db_session, seed_full_run):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = version.id

    db_session.add(WorkflowTrigger(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, kind="event", event_name=f"lead.new.{uuid.uuid4().hex[:6]}",
        active=True, params={}, created_by=run.triggered_by_user_id,
    ))
    await db_session.flush()

    trigger_row = await db_session.execute(
        select(WorkflowTrigger).where(WorkflowTrigger.workflow_id == workflow.id)
    )
    trigger = trigger_row.scalars().first()
    event_name = trigger.event_name

    created = await fire_event(
        db_session, tenant_id=tenant_id, app_id=app_id,
        event_name=event_name,
        event_payload={"recipients": [{"recipient_id": "evt-NEW", "payload": {}}]},
    )
    assert len(created) == 1

    new_run = (await db_session.execute(
        select(WorkflowRun).where(WorkflowRun.id == created[0])
    )).scalar_one()
    assert new_run.triggered_by == "event"
    assert new_run.params["event_payload"]["recipients"][0]["recipient_id"] == "evt-NEW"
    assert new_run.workflow_version_id == version.id

    jobs = (await db_session.execute(
        select(BackgroundJob).where(BackgroundJob.job_type == "run-workflow")
    )).scalars().all()
    matching = [j for j in jobs if (j.params or {}).get("run_id") == str(new_run.id)]
    assert len(matching) == 1
    job = matching[0]
    assert job.status == "queued"
    assert new_run.job_id == job.id


@pytest.mark.asyncio
async def test_no_active_trigger_creates_no_run(db_session, seed_full_run):
    _, _, _, _, tenant_id, app_id = seed_full_run
    created = await fire_event(
        db_session, tenant_id=tenant_id, app_id=app_id,
        event_name="lead.never.matches",
        event_payload={"recipient_id": "evt-none"},
    )
    assert created == []


@pytest.mark.asyncio
async def test_inactive_trigger_skipped(db_session, seed_full_run):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = version.id
    event_name = f"e.{uuid.uuid4().hex[:6]}"
    db_session.add(WorkflowTrigger(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, kind="event", event_name=event_name,
        active=False, params={}, created_by=run.triggered_by_user_id,
    ))
    await db_session.flush()
    created = await fire_event(
        db_session, tenant_id=tenant_id, app_id=app_id,
        event_name=event_name, event_payload={"recipient_id": "evt-inactive"},
    )
    assert created == []


@pytest.mark.asyncio
async def test_unpublished_workflow_skipped(db_session, seed_full_run):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = None  # unpublished
    event_name = f"e.{uuid.uuid4().hex[:6]}"
    db_session.add(WorkflowTrigger(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, kind="event", event_name=event_name,
        active=True, params={}, created_by=run.triggered_by_user_id,
    ))
    await db_session.flush()
    created = await fire_event(
        db_session, tenant_id=tenant_id, app_id=app_id,
        event_name=event_name, event_payload={"recipient_id": "evt-unpublished"},
    )
    assert created == []


@pytest.mark.asyncio
async def test_generic_event_normalizes_top_level_recipient_id(db_session, seed_full_run):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = version.id
    event_name = f"evt.{uuid.uuid4().hex[:6]}"
    db_session.add(WorkflowTrigger(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, kind="event", event_name=event_name,
        active=True, params={}, created_by=run.triggered_by_user_id,
    ))
    await db_session.flush()

    created = await fire_event(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        event_name=event_name,
        event_payload={"recipient_id": "evt-top-level", "foo": "bar"},
    )
    assert len(created) == 1
    new_run = (await db_session.execute(
        select(WorkflowRun).where(WorkflowRun.id == created[0])
    )).scalar_one()
    recipients = new_run.params["event_payload"]["recipients"]
    assert recipients == [{"recipient_id": "evt-top-level", "payload": {"recipient_id": "evt-top-level", "foo": "bar"}}]


@pytest.mark.asyncio
async def test_generic_event_requires_recipient_contract(db_session, seed_full_run):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = version.id
    event_name = f"evt.{uuid.uuid4().hex[:6]}"
    db_session.add(WorkflowTrigger(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, kind="event", event_name=event_name,
        active=True, params={}, created_by=run.triggered_by_user_id,
    ))
    await db_session.flush()

    with pytest.raises(EventPayloadContractError):
        await fire_event(
            db_session,
            tenant_id=tenant_id,
            app_id=app_id,
            event_name=event_name,
            event_payload={"foo": "bar"},
        )


@pytest.mark.asyncio
async def test_lsq_handler_dispatches_event(db_session, seed_full_run):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = version.id
    db_session.add(WorkflowTrigger(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, kind="event", event_name="lsq.lead.updated",
        active=True, params={}, created_by=run.triggered_by_user_id,
    ))
    await db_session.flush()

    created = await handle_lsq_event(
        db_session, tenant_id=tenant_id, app_id=app_id,
        payload={"prospect_id": "P-42", "stage": "Qualified"},
    )
    assert len(created) == 1
    new_run = (await db_session.execute(
        select(WorkflowRun).where(WorkflowRun.id == created[0])
    )).scalar_one()
    assert new_run.params["event_payload"]["prospect_id"] == "P-42"
