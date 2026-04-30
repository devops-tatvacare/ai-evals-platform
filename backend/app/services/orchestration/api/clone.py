"""Clone a system-owned workflow into the requesting tenant.

Tenants opt into seeded workflows ("Default MQL Concierge", "DM2 Adherence
Watch") by cloning. Cloning creates a fresh Workflow lineage in the tenant's
namespace + a v1 published WorkflowVersion that copies the system
workflow's definition. Tenants can then edit the cloned workflow visually
without affecting the system seed.

The system seed is identified by ``tenant_id == SYSTEM_TENANT_ID``; any
non-system workflow rejected here.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID
from app.models.orchestration import Workflow, WorkflowVersion


class CloneError(ValueError):
    """Raised when the source workflow cannot be cloned (no published version,
    target slug already taken, etc.)."""


async def clone_system_workflow(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    source_workflow_id: uuid.UUID,
    new_slug: str,
    new_name: str,
    target_app_id: str,
    created_by: uuid.UUID,
) -> Optional[Workflow]:
    """Clone a system workflow. Returns ``None`` if the source is missing or
    not system-owned. Raises ``CloneError`` if the source has no published
    version or the target slug collides.
    """
    src = await db.scalar(
        select(Workflow).where(
            Workflow.id == source_workflow_id,
            Workflow.tenant_id == SYSTEM_TENANT_ID,
        )
    )
    if src is None:
        return None
    if src.current_published_version_id is None:
        raise CloneError("source workflow has no published version")

    src_version = await db.scalar(
        select(WorkflowVersion).where(
            WorkflowVersion.id == src.current_published_version_id
        )
    )
    if src_version is None:
        raise CloneError("source workflow's current_published_version_id is dangling")

    cloned_wf = Workflow(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=target_app_id,
        workflow_type=src.workflow_type,
        slug=new_slug,
        name=new_name,
        description=f"Cloned from system workflow {src.slug}",
        created_by=created_by,
    )
    db.add(cloned_wf)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise CloneError(
            f"workflow with slug={new_slug!r} already exists for this tenant + app"
        )

    cloned_v = WorkflowVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=target_app_id,
        workflow_id=cloned_wf.id,
        version=1,
        definition=src_version.definition,
        status="published",
        published_by=created_by,
        published_at=datetime.now(timezone.utc),
    )
    db.add(cloned_v)
    await db.flush()
    cloned_wf.current_published_version_id = cloned_v.id
    await db.commit()
    await db.refresh(cloned_wf)
    return cloned_wf
