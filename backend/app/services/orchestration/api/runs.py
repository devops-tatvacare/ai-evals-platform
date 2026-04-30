"""Run lifecycle: manual fire, list, detail, recipients, actions, cancel, override."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import BackgroundJob
from app.models.orchestration import (
    Workflow,
    WorkflowRun,
    WorkflowRunRecipientAction,
    WorkflowRunRecipientOverride,
    WorkflowRunRecipientState,
)


class RunFireError(ValueError):
    pass


async def fire_manual_run(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    workflow_id: uuid.UUID,
    user_id: uuid.UUID,
    params: dict[str, Any],
) -> Optional[WorkflowRun]:
    wf = (await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if wf is None:
        return None
    if wf.current_published_version_id is None:
        raise RunFireError("workflow has no published version")

    run = WorkflowRun(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=wf.app_id,
        workflow_id=wf.id,
        workflow_version_id=wf.current_published_version_id,
        triggered_by="manual",
        triggered_by_user_id=user_id,
        status="pending",
        params=params,
    )
    db.add(run)
    await db.flush()

    job = BackgroundJob(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=wf.app_id,
        user_id=user_id,
        job_type="run-workflow",
        queue_class="standard",
        priority=5,
        params={"run_id": str(run.id)},
        status="queued",
    )
    db.add(job)
    await db.flush()
    run.job_id = job.id

    await db.commit()
    await db.refresh(run)
    return run


async def list_runs(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    workflow_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    app_ids: Optional[frozenset[str]] = None,
) -> list[WorkflowRun]:
    """List runs in a tenant. Pass ``app_ids`` to additionally restrict to a
    set of apps the caller has access to; pass None to disable that filter
    (callers using ``workflow_id`` typically gate via the workflow's app_id
    upstream and don't need to filter again here)."""
    stmt = select(WorkflowRun).where(WorkflowRun.tenant_id == tenant_id)
    if workflow_id:
        stmt = stmt.where(WorkflowRun.workflow_id == workflow_id)
    if app_ids is not None:
        if not app_ids:
            return []  # caller has no app access; cannot see any runs
        stmt = stmt.where(WorkflowRun.app_id.in_(app_ids))
    if status:
        stmt = stmt.where(WorkflowRun.status == status)
    stmt = stmt.order_by(WorkflowRun.created_at.desc()).limit(limit).offset(offset)
    return list((await db.execute(stmt)).scalars().all())


async def get_run(
    db: AsyncSession, *, tenant_id: uuid.UUID, run_id: uuid.UUID,
) -> Optional[WorkflowRun]:
    return (await db.execute(
        select(WorkflowRun).where(WorkflowRun.id == run_id, WorkflowRun.tenant_id == tenant_id)
    )).scalar_one_or_none()


async def list_recipients(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    run_id: uuid.UUID,
    limit: int = 100,
    offset: int = 0,
) -> list[WorkflowRunRecipientState]:
    stmt = select(WorkflowRunRecipientState).where(
        WorkflowRunRecipientState.run_id == run_id,
        WorkflowRunRecipientState.tenant_id == tenant_id,
    ).order_by(WorkflowRunRecipientState.enrolled_at.desc()).limit(limit).offset(offset)
    return list((await db.execute(stmt)).scalars().all())


async def list_actions(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    run_id: uuid.UUID,
    channel: Optional[str] = None,
    action_type: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[WorkflowRunRecipientAction]:
    stmt = select(WorkflowRunRecipientAction).where(
        WorkflowRunRecipientAction.run_id == run_id,
        WorkflowRunRecipientAction.tenant_id == tenant_id,
    )
    if channel:
        stmt = stmt.where(WorkflowRunRecipientAction.channel == channel)
    if action_type:
        stmt = stmt.where(WorkflowRunRecipientAction.action_type == action_type)
    stmt = stmt.order_by(WorkflowRunRecipientAction.created_at.desc()).limit(limit).offset(offset)
    return list((await db.execute(stmt)).scalars().all())


async def cancel_run(
    db: AsyncSession, *, tenant_id: uuid.UUID, run_id: uuid.UUID,
) -> bool:
    run = await get_run(db, tenant_id=tenant_id, run_id=run_id)
    if run is None:
        return False
    if run.status in ("completed", "failed", "cancelled"):
        return True
    from app.services.job_worker import mark_job_cancelled
    if run.job_id:
        mark_job_cancelled(str(run.job_id))
    run.status = "cancelled"
    run.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return True


async def apply_override(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    run_id: uuid.UUID,
    recipient_id: str,
    action: str,
    target_node_id: Optional[str],
    reason: Optional[str],
    applied_by: uuid.UUID,
) -> Optional[WorkflowRunRecipientOverride]:
    run = await get_run(db, tenant_id=tenant_id, run_id=run_id)
    if run is None:
        return None
    ov = WorkflowRunRecipientOverride(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=run.app_id,
        workflow_id=run.workflow_id,
        workflow_version_id=run.workflow_version_id,
        run_id=run_id,
        recipient_id=recipient_id,
        action=action,
        target_node_id=target_node_id,
        reason=reason,
        applied_by=applied_by,
        applied_at=datetime.now(timezone.utc),
    )
    db.add(ov)
    await db.commit()
    await db.refresh(ov)
    return ov
