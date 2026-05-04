"""Workflow version create / list / publish.

Publish runs the Phase 11 contract pipeline:

  1. ``definition_normalizer.normalize_definition`` — rewrites pre-Phase-11
     edge labels, source ``next_node_id`` pointers, split branch labels,
     wait config, merge config, and consent_gate config into the canonical
     shape.
  2. ``definition_validator.validate_definition`` — enforces graph rules,
     per-node-config validity, source / sink / split / wait routing
     constraints. Aggregates errors and raises ``VersionPublishError`` with
     a human-readable list.

Successful validation persists the canonical (post-normalization)
definition and flips the version to 'published'. Pointing the workflow at
the version is the same row update.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import Workflow, WorkflowVersion
from app.services.orchestration.definition_normalizer import normalize_definition
from app.services.orchestration.definition_validator import (
    DefinitionValidationError,
    DispatchRequiredFieldsError,
    validate_definition,
    validate_dispatch_required_fields,
)


class VersionPublishError(ValueError):
    pass


async def create_draft_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    workflow_id: uuid.UUID,
    definition: dict[str, Any],
) -> Optional[WorkflowVersion]:
    wf = (await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if wf is None:
        return None
    next_version = (await db.execute(
        select(func.coalesce(func.max(WorkflowVersion.version), 0))
        .where(WorkflowVersion.workflow_id == workflow_id)
    )).scalar_one() + 1
    v = WorkflowVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=wf.app_id,
        workflow_id=workflow_id,
        version=next_version,
        definition=definition,
        status="draft",
    )
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return v


async def list_versions(
    db: AsyncSession, *, tenant_id: uuid.UUID, workflow_id: uuid.UUID,
) -> list[WorkflowVersion]:
    return list((await db.execute(
        select(WorkflowVersion).where(
            WorkflowVersion.workflow_id == workflow_id,
            WorkflowVersion.tenant_id == tenant_id,
        ).order_by(WorkflowVersion.version.desc())
    )).scalars().all())


async def get_version(
    db: AsyncSession, *, tenant_id: uuid.UUID, version_id: uuid.UUID,
) -> Optional[WorkflowVersion]:
    return (await db.execute(
        select(WorkflowVersion).where(
            WorkflowVersion.id == version_id,
            WorkflowVersion.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()


async def publish_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    published_by: uuid.UUID,
) -> Optional[WorkflowVersion]:
    v = await get_version(db, tenant_id=tenant_id, version_id=version_id)
    if v is None or v.workflow_id != workflow_id:
        return None
    wf = (await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if wf is None:
        return None

    canonical = normalize_definition(v.definition)
    # Phase 13 publish-gate: dispatch nodes must carry UI-supplied
    # provider identifiers before the workflow can publish. Runs before
    # the structural validator so authors get a clean per-field message
    # instead of a Pydantic stack from the config-schema rule.
    dispatch_errors = validate_dispatch_required_fields(canonical)
    if dispatch_errors:
        raise DispatchRequiredFieldsError(dispatch_errors)
    try:
        validate_definition(canonical, workflow_type=wf.workflow_type)
    except DefinitionValidationError as exc:
        # Surface the structured error list under the same VersionPublishError
        # type the route handler already maps to a 400.
        raise VersionPublishError(str(exc)) from exc

    v.definition = canonical
    v.status = "published"
    v.published_by = published_by
    v.published_at = datetime.now(timezone.utc)
    wf.current_published_version_id = v.id
    await db.commit()
    await db.refresh(v)
    return v
