"""Trigger CRUD with cron→platform.scheduled_job_definitions sync.

Cron triggers atomically materialize one ScheduledJobDefinition row that fires
``fire-orchestration-trigger`` with ``params={'trigger_id': ...}``. The
``fire-orchestration-trigger`` job handler (job_worker.py) then loads the
trigger, creates a fresh WorkflowRun, and queues a ``run-workflow`` job
pointing at that run. We deliberately do NOT point the schedule at
``run-workflow`` directly — ``run-workflow`` requires a pre-existing
``run_id`` and would no-op without one.

Update / delete cascades to the linked schedule row in the same transaction.

Uses the ScheduledJobDefinition ORM (not raw SQL) so column names stay correct
with the live schema (``job_type`` / ``cron`` / ``enabled`` etc.).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import Workflow, WorkflowTrigger
from app.models.scheduled_job import ScheduledJobDefinition
from app.services.scheduler.engine import next_cron_tick, validate_cron_expression


_TRIGGER_SCHEDULE_KEY_PREFIX = "orchestration:trigger:"


def _schedule_key_for_trigger(trigger_id: uuid.UUID) -> str:
    return f"{_TRIGGER_SCHEDULE_KEY_PREFIX}{trigger_id}"


async def _create_scheduled_job(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    workflow_id: uuid.UUID,
    trigger: WorkflowTrigger,
    cron_expression: str,
    created_by: uuid.UUID,
) -> ScheduledJobDefinition:
    sched = ScheduledJobDefinition(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        job_type="fire-orchestration-trigger",
        schedule_key=_schedule_key_for_trigger(trigger.id),
        name=f"orch-trigger-{trigger.id}",
        description=f"Orchestration cron trigger for workflow {workflow_id}",
        cron=cron_expression,
        params={"trigger_id": str(trigger.id)},
        override={},
        enabled=True,
        next_check_at=next_cron_tick(cron_expression, datetime.now(timezone.utc)),
        current_cycle_attempts=0,
        created_by=created_by,
    )
    db.add(sched)
    await db.flush()
    trigger.scheduled_job_id = sched.id
    return sched


async def create_trigger(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    workflow_id: uuid.UUID,
    kind: str,
    cron_expression: Optional[str],
    event_name: Optional[str],
    params: dict[str, Any],
    active: bool,
    created_by: uuid.UUID,
) -> Optional[WorkflowTrigger]:
    wf = (await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if wf is None:
        return None

    if kind == "cron":
        validate_cron_expression(cron_expression or "")

    trigger = WorkflowTrigger(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=wf.app_id,
        workflow_id=workflow_id,
        kind=kind,
        cron_expression=cron_expression,
        event_name=event_name,
        params=params,
        active=active,
        created_by=created_by,
    )
    db.add(trigger)
    await db.flush()  # trigger.id materialized for FK + schedule_key

    if kind == "cron" and active:
        await _create_scheduled_job(
            db,
            tenant_id=tenant_id,
            app_id=wf.app_id,
            workflow_id=wf.id,
            trigger=trigger,
            cron_expression=cron_expression or "",
            created_by=created_by,
        )

    await db.commit()
    await db.refresh(trigger)
    return trigger


async def get_trigger(
    db: AsyncSession, *, tenant_id: uuid.UUID, trigger_id: uuid.UUID,
) -> Optional[WorkflowTrigger]:
    return (await db.execute(
        select(WorkflowTrigger).where(
            WorkflowTrigger.id == trigger_id,
            WorkflowTrigger.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()


async def list_triggers(
    db: AsyncSession, *, tenant_id: uuid.UUID, workflow_id: uuid.UUID,
) -> list[WorkflowTrigger]:
    return list((await db.execute(
        select(WorkflowTrigger).where(
            WorkflowTrigger.workflow_id == workflow_id,
            WorkflowTrigger.tenant_id == tenant_id,
        ).order_by(WorkflowTrigger.created_at.desc())
    )).scalars().all())


async def update_trigger(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    trigger_id: uuid.UUID,
    active: Optional[bool] = None,
    cron_expression: Optional[str] = None,
    params: Optional[dict[str, Any]] = None,
) -> Optional[WorkflowTrigger]:
    trig = (await db.execute(
        select(WorkflowTrigger).where(
            WorkflowTrigger.id == trigger_id,
            WorkflowTrigger.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if trig is None:
        return None

    wf = (await db.execute(
        select(Workflow).where(
            Workflow.id == trig.workflow_id,
            Workflow.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if wf is None:
        return None

    sched = None
    if trig.scheduled_job_id is not None:
        sched = (await db.execute(
            select(ScheduledJobDefinition).where(
                ScheduledJobDefinition.id == trig.scheduled_job_id
            )
        )).scalar_one_or_none()

    if cron_expression is not None and trig.kind == "cron":
        validate_cron_expression(cron_expression)
        trig.cron_expression = cron_expression
    if active is not None:
        trig.active = active
    if params is not None:
        trig.params = params

    if trig.active and not wf.active:
        return None

    if trig.kind == "cron":
        desired_cron = trig.cron_expression or ""
        if trig.active and sched is None:
            sched = await _create_scheduled_job(
                db,
                tenant_id=tenant_id,
                app_id=trig.app_id,
                workflow_id=trig.workflow_id,
                trigger=trig,
                cron_expression=desired_cron,
                created_by=trig.created_by,
            )
        elif sched is not None:
            sched.enabled = trig.active
            if cron_expression is not None:
                sched.cron = desired_cron
                sched.next_check_at = next_cron_tick(desired_cron, datetime.now(timezone.utc))

    await db.commit()
    await db.refresh(trig)
    return trig


async def delete_trigger(
    db: AsyncSession, *, tenant_id: uuid.UUID, trigger_id: uuid.UUID,
) -> bool:
    trig = (await db.execute(
        select(WorkflowTrigger).where(
            WorkflowTrigger.id == trigger_id,
            WorkflowTrigger.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if trig is None:
        return False
    if trig.scheduled_job_id is not None:
        sched = (await db.execute(
            select(ScheduledJobDefinition).where(
                ScheduledJobDefinition.id == trig.scheduled_job_id
            )
        )).scalar_one_or_none()
        # Break the FK from trigger → schedule before deleting either, since
        # workflow_triggers.scheduled_job_id ON DELETE SET NULL only fires when
        # the schedule is deleted via FK cascade.
        trig.scheduled_job_id = None
        if sched is not None:
            await db.delete(sched)
        await db.flush()
    await db.delete(trig)
    await db.commit()
    return True
