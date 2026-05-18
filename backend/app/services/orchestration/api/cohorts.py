"""Saved cohort definition service.

Sister to ``datasets.py``: CRUD + version + publish + used-by helpers for
``orchestration.cohort_definitions`` and ``cohort_definition_versions``.
Service stays HTTP-agnostic; the route layer maps these exception classes
to status codes.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mixins.shareable import Visibility
from app.models.orchestration import (
    CohortDefinition,
    CohortDefinitionVersion,
    Workflow,
    WorkflowVersion,
)


class CohortNotFound(LookupError):
    """No cohort / version visible to the caller's tenant."""


class CohortConflict(ValueError):
    """Duplicate (tenant_id, app_id, slug) on insert."""


class CohortVersionNotEditable(ValueError):
    """Edit attempted on a non-draft version."""


class CohortVersionAlreadyPublished(ValueError):
    """Publish attempted on a version that is not draft."""


class CohortInUse(ValueError):
    """Delete rejected because at least one workflow version still pins a
    version of this cohort via ``source.saved_cohort`` node config.

    Carries ``workflow_ids`` and ``workflow_names`` so the route layer can
    build a structured 409 detail.
    """

    def __init__(
        self,
        message: str,
        *,
        workflow_ids: list[uuid.UUID],
        workflow_names: list[str],
    ) -> None:
        super().__init__(message)
        self.workflow_ids = workflow_ids
        self.workflow_names = workflow_names


# ─── helpers ────────────────────────────────────────────────────────────────


def _serialize_version(v: CohortDefinitionVersion) -> dict[str, Any]:
    return {
        "id": v.id,
        "cohort_definition_id": v.cohort_definition_id,
        "version": v.version,
        "source_ref": v.source_ref,
        "filters": list(v.filters or []),
        "payload_fields": list(v.payload_fields or []),
        "lookback_hours": v.lookback_hours,
        "lookback_column": v.lookback_column,
        "consent_gate_channel": v.consent_gate_channel,
        "status": v.status,
        "published_by": v.published_by,
        "published_at": v.published_at,
        "created_at": v.created_at,
    }


def _serialize_cohort(
    c: CohortDefinition,
    *,
    versions: list[CohortDefinitionVersion],
    used_by_workflow_count: int = 0,
) -> dict[str, Any]:
    latest = max(versions, key=lambda v: v.version) if versions else None
    return {
        "id": c.id,
        "tenant_id": c.tenant_id,
        "app_id": c.app_id,
        "slug": c.slug,
        "name": c.name,
        "description": c.description,
        "active": c.active,
        "visibility": c.visibility,
        "shared_by": c.shared_by,
        "shared_at": c.shared_at,
        "created_by": c.created_by,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
        "current_published_version_id": c.current_published_version_id,
        "latest_version": _serialize_version(latest) if latest else None,
        "used_by_workflow_count": used_by_workflow_count,
        "versions": [_serialize_version(v) for v in sorted(versions, key=lambda v: -v.version)],
    }


async def _load_cohort(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_id: uuid.UUID,
) -> CohortDefinition:
    row = await db.scalar(
        select(CohortDefinition).where(
            CohortDefinition.id == cohort_id,
            CohortDefinition.tenant_id == tenant_id,
        )
    )
    if row is None:
        raise CohortNotFound(f"cohort not found: {cohort_id}")
    return row


async def _load_versions(
    db: AsyncSession,
    *,
    cohort_id: uuid.UUID,
) -> list[CohortDefinitionVersion]:
    rows = (
        await db.execute(
            select(CohortDefinitionVersion)
            .where(CohortDefinitionVersion.cohort_definition_id == cohort_id)
            .order_by(CohortDefinitionVersion.version.desc())
        )
    ).scalars().all()
    return list(rows)


async def _load_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_id: uuid.UUID,
    version_id: uuid.UUID,
) -> CohortDefinitionVersion:
    row = await db.scalar(
        select(CohortDefinitionVersion).where(
            CohortDefinitionVersion.id == version_id,
            CohortDefinitionVersion.cohort_definition_id == cohort_id,
            CohortDefinitionVersion.tenant_id == tenant_id,
        )
    )
    if row is None:
        raise CohortNotFound(f"cohort version not found: {version_id}")
    return row


async def _count_used_by(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    version_ids: list[uuid.UUID],
) -> int:
    """COUNT(DISTINCT workflow_id) of workflow_versions whose definition
    contains a ``source.saved_cohort`` node pinned to any of the cohort's
    versions. Backed by the GIN index on ``workflow_versions.definition``.
    """
    if not version_ids:
        return 0
    # Build the JSONB containment predicates: one ``@>`` per version id.
    or_clauses = [
        WorkflowVersion.definition.contains(
            {"nodes": [{"config": {"cohort_definition_version_id": str(vid)}}]}
        )
        for vid in version_ids
    ]
    stmt = (
        select(func.count(func.distinct(WorkflowVersion.workflow_id)))
        .where(
            WorkflowVersion.tenant_id == tenant_id,
            or_(*or_clauses),
        )
    )
    return int((await db.execute(stmt)).scalar() or 0)


async def _find_workflow_bindings(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_version_ids: list[uuid.UUID],
) -> list[dict[str, Any]]:
    """Return one row per (workflow, workflow_version) that pins any of the
    given cohort version ids. Used by used-by listing and the 409 delete-block.
    """
    if not cohort_version_ids:
        return []
    or_clauses = [
        WorkflowVersion.definition.contains(
            {"nodes": [{"config": {"cohort_definition_version_id": str(vid)}}]}
        )
        for vid in cohort_version_ids
    ]
    stmt = (
        select(
            Workflow.id,
            Workflow.name,
            WorkflowVersion.id,
            WorkflowVersion.definition,
        )
        .join(Workflow, Workflow.id == WorkflowVersion.workflow_id)
        .where(
            WorkflowVersion.tenant_id == tenant_id,
            Workflow.tenant_id == tenant_id,
            or_(*or_clauses),
        )
    )
    rows = (await db.execute(stmt)).all()
    target_ids = {str(vid) for vid in cohort_version_ids}
    out: list[dict[str, Any]] = []
    for workflow_id, workflow_name, version_id, definition in rows:
        if not isinstance(definition, dict):
            continue
        for node in definition.get("nodes") or []:
            if not isinstance(node, dict):
                continue
            if node.get("type") != "source.saved_cohort":
                continue
            cfg = node.get("config")
            if not isinstance(cfg, dict):
                continue
            pinned = cfg.get("cohort_definition_version_id")
            if isinstance(pinned, str) and pinned in target_ids:
                out.append({
                    "workflow_id": workflow_id,
                    "workflow_name": workflow_name,
                    "workflow_version_id": version_id,
                    "pinned_cohort_version_id": uuid.UUID(pinned),
                })
                break
    return out


# ─── Public service API ─────────────────────────────────────────────────────


async def create_cohort(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    slug: str,
    name: str,
    description: Optional[str],
    created_by: uuid.UUID,
    visibility: Visibility,
    initial_version: dict[str, Any],
) -> dict[str, Any]:
    cohort = CohortDefinition(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        slug=slug,
        name=name,
        description=description,
        created_by=created_by,
        visibility=visibility or Visibility.PRIVATE,
    )
    db.add(cohort)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise CohortConflict(
            f"a cohort named {slug!r} already exists in this app"
        ) from exc

    version = CohortDefinitionVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        cohort_definition_id=cohort.id,
        version=1,
        source_ref=initial_version["source_ref"],
        payload_fields=list(initial_version.get("payload_fields") or []),
        filters=list(initial_version.get("filters") or []),
        lookback_hours=initial_version.get("lookback_hours"),
        lookback_column=initial_version.get("lookback_column"),
        consent_gate_channel=initial_version.get("consent_gate_channel"),
        status="draft",
    )
    db.add(version)
    await db.flush()
    return _serialize_cohort(cohort, versions=[version], used_by_workflow_count=0)


async def list_cohorts(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
) -> list[dict[str, Any]]:
    stmt = (
        select(CohortDefinition)
        .where(
            CohortDefinition.tenant_id == tenant_id,
            CohortDefinition.app_id == app_id,
            or_(
                CohortDefinition.created_by == user_id,
                CohortDefinition.visibility == Visibility.SHARED,
            ),
        )
        .order_by(CohortDefinition.updated_at.desc())
    )
    cohorts = (await db.execute(stmt)).scalars().all()
    out: list[dict[str, Any]] = []
    for cohort in cohorts:
        versions = await _load_versions(db, cohort_id=cohort.id)
        used_by = await _count_used_by(
            db,
            tenant_id=tenant_id,
            version_ids=[v.id for v in versions],
        )
        out.append(_serialize_cohort(cohort, versions=versions, used_by_workflow_count=used_by))
    return out


async def get_cohort(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_id: uuid.UUID,
) -> dict[str, Any]:
    cohort = await _load_cohort(db, tenant_id=tenant_id, cohort_id=cohort_id)
    versions = await _load_versions(db, cohort_id=cohort.id)
    used_by = await _count_used_by(
        db, tenant_id=tenant_id,
        version_ids=[v.id for v in versions],
    )
    return _serialize_cohort(cohort, versions=versions, used_by_workflow_count=used_by)


async def update_cohort(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_id: uuid.UUID,
    name: Optional[str],
    description: Optional[str],
    visibility: Optional[Visibility],
    active: Optional[bool],
) -> dict[str, Any]:
    cohort = await _load_cohort(db, tenant_id=tenant_id, cohort_id=cohort_id)
    if name is not None:
        cohort.name = name
    if description is not None:
        cohort.description = description
    if visibility is not None:
        cohort.visibility = Visibility.normalize(visibility) or Visibility.PRIVATE
    if active is not None:
        cohort.active = active
    cohort.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return await get_cohort(db, tenant_id=tenant_id, cohort_id=cohort_id)


async def delete_cohort(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_id: uuid.UUID,
) -> None:
    """Soft-delete by flipping ``active=false``. Rejected when any workflow
    version still pins a version of this cohort — caller renders the 409 with
    the bindings list from ``CohortInUse``.
    """
    cohort = await _load_cohort(db, tenant_id=tenant_id, cohort_id=cohort_id)
    versions = await _load_versions(db, cohort_id=cohort.id)
    bindings = await _find_workflow_bindings(
        db, tenant_id=tenant_id,
        cohort_version_ids=[v.id for v in versions],
    )
    if bindings:
        workflow_ids = sorted({b["workflow_id"] for b in bindings})
        workflow_names = sorted({b["workflow_name"] for b in bindings})
        raise CohortInUse(
            f"cohort is referenced by workflow(s): {', '.join(workflow_names)}",
            workflow_ids=list(workflow_ids),
            workflow_names=workflow_names,
        )
    cohort.active = False
    cohort.updated_at = datetime.now(timezone.utc)
    await db.flush()


# ─── version operations ─────────────────────────────────────────────────────


async def create_draft_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_id: uuid.UUID,
    payload: dict[str, Any],
) -> dict[str, Any]:
    cohort = await _load_cohort(db, tenant_id=tenant_id, cohort_id=cohort_id)
    next_version = int(
        (await db.execute(
            select(func.coalesce(func.max(CohortDefinitionVersion.version), 0))
            .where(CohortDefinitionVersion.cohort_definition_id == cohort.id)
        )).scalar() or 0
    ) + 1
    row = CohortDefinitionVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=cohort.app_id,
        cohort_definition_id=cohort.id,
        version=next_version,
        source_ref=payload["source_ref"],
        payload_fields=list(payload.get("payload_fields") or []),
        filters=list(payload.get("filters") or []),
        lookback_hours=payload.get("lookback_hours"),
        lookback_column=payload.get("lookback_column"),
        consent_gate_channel=payload.get("consent_gate_channel"),
        status="draft",
    )
    db.add(row)
    await db.flush()
    return _serialize_version(row)


async def edit_draft_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_id: uuid.UUID,
    version_id: uuid.UUID,
    payload: dict[str, Any],
) -> dict[str, Any]:
    version = await _load_version(
        db, tenant_id=tenant_id, cohort_id=cohort_id, version_id=version_id,
    )
    if version.status != "draft":
        raise CohortVersionNotEditable(
            "only draft versions may be edited; create a new draft to revise a published cohort"
        )
    version.source_ref = payload["source_ref"]
    version.payload_fields = list(payload.get("payload_fields") or [])
    version.filters = list(payload.get("filters") or [])
    version.lookback_hours = payload.get("lookback_hours")
    version.lookback_column = payload.get("lookback_column")
    version.consent_gate_channel = payload.get("consent_gate_channel")
    await db.flush()
    return _serialize_version(version)


async def publish_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_id: uuid.UUID,
    version_id: uuid.UUID,
    published_by: uuid.UUID,
) -> dict[str, Any]:
    """Flip a draft version to published AND point the cohort's
    ``current_published_version_id`` at it inside one transaction. The
    deferred FK on ``cohort_definitions.current_published_version_id`` fires
    at commit, tolerating the in-progress state.
    """
    version = await _load_version(
        db, tenant_id=tenant_id, cohort_id=cohort_id, version_id=version_id,
    )
    if version.status != "draft":
        raise CohortVersionAlreadyPublished(
            f"version {version.version} is already {version.status}"
        )

    now = datetime.now(timezone.utc)
    async with db.begin_nested():
        await db.execute(
            update(CohortDefinitionVersion)
            .where(CohortDefinitionVersion.id == version_id)
            .values(status="published", published_by=published_by, published_at=now)
        )
        await db.execute(
            update(CohortDefinition)
            .where(CohortDefinition.id == cohort_id)
            .values(current_published_version_id=version_id, updated_at=now)
        )

    refreshed = await _load_version(
        db, tenant_id=tenant_id, cohort_id=cohort_id, version_id=version_id,
    )
    return _serialize_version(refreshed)


async def list_used_by(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    cohort_id: uuid.UUID,
) -> list[dict[str, Any]]:
    versions = await _load_versions(db, cohort_id=cohort_id)
    return await _find_workflow_bindings(
        db, tenant_id=tenant_id,
        cohort_version_ids=[v.id for v in versions],
    )


__all__ = [
    "CohortNotFound",
    "CohortConflict",
    "CohortVersionNotEditable",
    "CohortVersionAlreadyPublished",
    "CohortInUse",
    "create_cohort",
    "list_cohorts",
    "get_cohort",
    "update_cohort",
    "delete_cohort",
    "create_draft_version",
    "edit_draft_version",
    "publish_version",
    "list_used_by",
]
