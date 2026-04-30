"""Trigger CRUD with cron→platform.scheduled_job_definitions sync.

Cron triggers atomically materialize one ScheduledJobDefinition row that fires
``run-workflow`` with ``params={trigger_id}``. Update / delete cascades to the
linked schedule row in the same transaction.

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
        sched = ScheduledJobDefinition(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            app_id=wf.app_id,
            job_type="run-workflow",
            schedule_key=_schedule_key_for_trigger(trigger.id),
            name=f"orch-trigger-{trigger.id}",
            description=f"Orchestration cron trigger for workflow {wf.id}",
            cron=cron_expression or "",
            params={"trigger_id": str(trigger.id)},
            override={},
            enabled=True,
            next_check_at=next_cron_tick(cron_expression or "", datetime.now(timezone.utc)),
            current_cycle_attempts=0,
            created_by=created_by,
        )
        db.add(sched)
        await db.flush()
        trigger.scheduled_job_id = sched.id

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

    sched = None
    if trig.scheduled_job_id is not None:
        sched = (await db.execute(
            select(ScheduledJobDefinition).where(
                ScheduledJobDefinition.id == trig.scheduled_job_id
            )
        )).scalar_one_or_none()

    if active is not None:
        trig.active = active
        if sched is not None:
            sched.enabled = active
    if cron_expression is not None and trig.kind == "cron":
        validate_cron_expression(cron_expression)
        trig.cron_expression = cron_expression
        if sched is not None:
            sched.cron = cron_expression
            sched.next_check_at = next_cron_tick(cron_expression, datetime.now(timezone.utc))
    if params is not None:
        trig.params = params

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
