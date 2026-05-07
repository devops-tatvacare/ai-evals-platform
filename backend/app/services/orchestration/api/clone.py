"""Clone a system-owned workflow into the requesting tenant.

Tenants opt into seeded workflows ("Default MQL Concierge", "DM2 Adherence
Watch") by cloning. Cloning creates a fresh Workflow lineage in the tenant's
namespace + a v1 WorkflowVersion that copies the system workflow's
definition. Tenants can then edit the cloned workflow visually without
affecting the system seed.

The system seed is identified by ``tenant_id == SYSTEM_TENANT_ID``; any
non-system workflow rejected here.

Phase 10 commit 1 adds **clone sanitization**: any node ``connection_id`` in
the cloned definition that does not point at a connection visible to
``(target_tenant_id, target_app_id)`` is cleared, so tenant clones never
inherit system-owned credential bindings. If anything was cleared, the
cloned workflow is created as a **draft** (``status='draft'``,
``current_published_version_id=NULL``) and the builder requires operator
rebind before publish/run.
"""
from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID
from app.models.mixins.shareable import Visibility
from app.models.orchestration import Workflow, WorkflowVersion
from app.models.provider_connection import ProviderConnection


class CloneError(ValueError):
    """Raised when the source workflow cannot be cloned (no published version,
    target slug already taken, etc.)."""


async def _allowed_connection_ids(
    db: AsyncSession, *, tenant_id: uuid.UUID, app_id: str, user_id: uuid.UUID,
) -> set[uuid.UUID]:
    """Connection ids the cloned workflow may legally reference.

    Per phase-10 §1.4: ``connection_id`` is a tenant-local pointer. Cloning
    a system workflow into tenant T may keep an id only if the row is
    visible to (T, target_app_id) — i.e. T already has an equivalent
    connection of its own. Otherwise the id is stripped.
    """
    rows = await db.scalars(
        select(ProviderConnection.id).where(
            ProviderConnection.tenant_id == tenant_id,
            ProviderConnection.app_id == app_id,
            or_(
                ProviderConnection.created_by == user_id,
                ProviderConnection.visibility == Visibility.SHARED,
            ),
        )
    )
    return set(rows.all())


def _strip_foreign_connection_ids(
    definition: dict[str, Any], allowed_ids: set[uuid.UUID],
) -> tuple[dict[str, Any], int]:
    """Return (sanitized_definition, cleared_count). Walks every node's
    ``config.connection_id`` and removes the key when the id isn't in
    ``allowed_ids`` (which for fresh tenants is empty)."""
    cleaned = deepcopy(definition)
    cleared = 0
    for node in cleaned.get("nodes", []):
        config = node.get("config")
        if not isinstance(config, dict):
            continue
        raw = config.get("connection_id")
        if raw is None:
            continue
        try:
            cid = uuid.UUID(str(raw))
        except (TypeError, ValueError):
            # Malformed value — treat as foreign and clear.
            del config["connection_id"]
            cleared += 1
            continue
        if cid not in allowed_ids:
            del config["connection_id"]
            cleared += 1
    return cleaned, cleared


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
            Workflow.active == True,
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

    allowed = await _allowed_connection_ids(
        db, tenant_id=tenant_id, app_id=target_app_id, user_id=created_by,
    )
    sanitized_definition, cleared = _strip_foreign_connection_ids(
        src_version.definition, allowed,
    )
    rebind_required = cleared > 0

    cloned_wf = Workflow(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=target_app_id,
        workflow_type=src.workflow_type,
        slug=new_slug,
        name=new_name,
        description=f"Cloned from system workflow {src.slug}",
        created_by=created_by,
        visibility=Visibility.PRIVATE,
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
        definition=sanitized_definition,
        status="draft" if rebind_required else "published",
        published_by=None if rebind_required else created_by,
        published_at=None if rebind_required else datetime.now(timezone.utc),
    )
    db.add(cloned_v)
    await db.flush()
    if not rebind_required:
        cloned_wf.current_published_version_id = cloned_v.id
    await db.commit()
    await db.refresh(cloned_wf)
    return cloned_wf
