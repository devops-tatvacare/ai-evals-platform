"""Workflow lineage CRUD."""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import Workflow


class WorkflowConflict(ValueError):
    pass


async def create_workflow(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    workflow_type: str,
    slug: str,
    name: str,
    description: Optional[str],
    created_by: uuid.UUID,
) -> Workflow:
    wf = Workflow(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_type=workflow_type,
        slug=slug,
        name=name,
        description=description,
        created_by=created_by,
    )
    db.add(wf)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise WorkflowConflict(
            f"workflow with slug={slug!r} already exists for this tenant + app"
        )
    await db.refresh(wf)
    return wf


async def list_workflows(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: Optional[str] = None,
    workflow_type: Optional[str] = None,
    app_ids: Optional[frozenset[str]] = None,
) -> list[Workflow]:
    """List workflows in a tenant. Pass ``app_ids`` to additionally restrict
    output to apps the caller has access to (used when the caller didn't
    specify an explicit ``app_id`` filter)."""
    stmt = select(Workflow).where(Workflow.tenant_id == tenant_id)
    if app_id:
        stmt = stmt.where(Workflow.app_id == app_id)
    elif app_ids is not None:
        if not app_ids:
            return []
        stmt = stmt.where(Workflow.app_id.in_(app_ids))
    if workflow_type:
        stmt = stmt.where(Workflow.workflow_type == workflow_type)
    stmt = stmt.order_by(Workflow.created_at.desc())
    return list((await db.execute(stmt)).scalars().all())


async def get_workflow(
    db: AsyncSession, *, tenant_id: uuid.UUID, workflow_id: uuid.UUID,
) -> Optional[Workflow]:
    stmt = select(Workflow).where(
        Workflow.id == workflow_id, Workflow.tenant_id == tenant_id,
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def update_workflow(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    workflow_id: uuid.UUID,
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Optional[Workflow]:
    wf = await get_workflow(db, tenant_id=tenant_id, workflow_id=workflow_id)
    if wf is None:
        return None
    if name is not None:
        wf.name = name
    if description is not None:
        wf.description = description
    await db.commit()
    await db.refresh(wf)
    return wf


async def archive_workflow(
    db: AsyncSession, *, tenant_id: uuid.UUID, workflow_id: uuid.UUID,
) -> bool:
    """v1: hard-delete. The schema cascades versions / runs / triggers."""
    wf = await get_workflow(db, tenant_id=tenant_id, workflow_id=workflow_id)
    if wf is None:
        return False
    # Break the workflow → current_published_version_id self-loop before deleting.
    if wf.current_published_version_id is not None:
        wf.current_published_version_id = None
        await db.flush()
    await db.delete(wf)
    await db.commit()
    return True
