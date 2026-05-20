"""Service layer for /api/orchestration/datasets.

Wraps the pure CSV importer (``services.orchestration.datasets.csv_importer``)
with DB writes against the Phase-12 schema rows:

- ``orchestration.cohort_datasets``         — catalog row, tenant + app scoped
- ``orchestration.cohort_dataset_versions`` — one row per import; rows live by
  ``(dataset_id, version_number)``
- ``orchestration.cohort_dataset_rows``     — bulk-inserted parsed payloads

Tenant scoping is mandatory on every read and write. Cross-tenant access
returns ``DatasetNotFound`` rather than leaking a row from another tenant.

Delete safety: a dataset (or one of its versions) cannot be removed while a
``WorkflowVersion.definition`` references it via a ``source.dataset`` node
whose ``config.dataset_version_id`` matches. The check is shared between
``delete_dataset`` and ``delete_version``.

Mirrors the pattern from ``services.orchestration.api.connections``: helpers
+ public async functions, exception classes for the route layer to translate
to HTTP. Service stays HTTP-agnostic.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import insert, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mixins.shareable import Visibility
from app.models.orchestration import (
    CohortDataset,
    CohortDatasetRow,
    CohortDatasetVersion,
    Workflow,
    WorkflowVersion,
)
from app.services.orchestration.datasets.dataset_validator import ImportedDataset


class DatasetNotFound(LookupError):
    """No dataset / version visible to the caller's tenant."""


class DatasetConflict(ValueError):
    """Duplicate (tenant_id, app_id, name) on insert."""


class DatasetInUse(ValueError):
    """Delete rejected because at least one published or draft workflow
    version still references this dataset (or one of its versions) via a
    ``source.dataset`` node ``config.dataset_version_id``.

    Carries ``workflow_ids`` and ``workflow_names`` so the route layer can
    build a useful 409 detail.
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


# ─── Helpers ────────────────────────────────────────────────────────────────


def _serialize_dataset(
    row: CohortDataset,
    *,
    latest_version: Optional[CohortDatasetVersion] = None,
    version_ids: Optional[list[uuid.UUID]] = None,
) -> dict[str, Any]:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "app_id": row.app_id,
        "name": row.name,
        "description": row.description,
        "created_by": row.created_by,
        "visibility": row.visibility,
        "shared_by": row.shared_by,
        "shared_at": row.shared_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "latest_version": (
            _serialize_version(latest_version) if latest_version is not None else None
        ),
        "version_ids": list(version_ids or []),
    }


def _serialize_version(
    row: CohortDatasetVersion,
    *,
    sample_rows: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": row.id,
        "dataset_id": row.dataset_id,
        "version_number": row.version_number,
        "source_type": row.source_type,
        "source_filename": row.source_filename,
        "source_byte_size": row.source_byte_size,
        "row_count": row.row_count,
        "id_strategy": row.id_strategy,
        "id_column": row.id_column,
        "schema_descriptor": row.schema_descriptor,
        "imported_by": row.imported_by,
        "imported_at": row.imported_at,
        "sample_rows": list(sample_rows) if sample_rows is not None else [],
    }
    return payload


async def _load_dataset(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    dataset_id: uuid.UUID,
    for_update: bool = False,
) -> CohortDataset:
    stmt = select(CohortDataset).where(
        CohortDataset.id == dataset_id,
        CohortDataset.tenant_id == tenant_id,
    )
    if for_update:
        stmt = stmt.with_for_update()
    row = await db.scalar(stmt)
    if row is None:
        raise DatasetNotFound(f"dataset {dataset_id} not found")
    return row


async def _load_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    dataset_id: uuid.UUID,
    version_id: uuid.UUID,
) -> CohortDatasetVersion:
    row = await db.scalar(
        select(CohortDatasetVersion).where(
            CohortDatasetVersion.id == version_id,
            CohortDatasetVersion.dataset_id == dataset_id,
            CohortDatasetVersion.tenant_id == tenant_id,
        )
    )
    if row is None:
        raise DatasetNotFound(
            f"dataset version {version_id} not found under dataset {dataset_id}"
        )
    return row


async def _find_workflow_bindings(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    version_ids: list[uuid.UUID],
) -> list[tuple[uuid.UUID, str]]:
    """Return ``(workflow_id, workflow_name)`` for every WorkflowVersion whose
    definition contains a ``source.dataset`` node bound to one of the given
    dataset version ids via ``config.dataset_version_id``.

    Tenant-scoped via ``Workflow.tenant_id``. Result is deduped by workflow id.
    """
    if not version_ids:
        return []

    target_ids = {str(vid) for vid in version_ids}
    stmt = (
        select(WorkflowVersion.workflow_id, WorkflowVersion.definition, Workflow.name)
        .join(Workflow, Workflow.id == WorkflowVersion.workflow_id)
        .where(
            WorkflowVersion.tenant_id == tenant_id,
            Workflow.tenant_id == tenant_id,
        )
    )
    rows = (await db.execute(stmt)).all()

    seen: set[uuid.UUID] = set()
    out: list[tuple[uuid.UUID, str]] = []
    for workflow_id, definition, workflow_name in rows:
        if workflow_id in seen:
            continue
        if not isinstance(definition, dict):
            continue
        nodes = definition.get("nodes")
        if not isinstance(nodes, list):
            continue
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if node.get("type") != "source.dataset":
                continue
            cfg = node.get("config")
            if not isinstance(cfg, dict):
                continue
            version_id = cfg.get("dataset_version_id")
            if isinstance(version_id, str) and version_id in target_ids:
                seen.add(workflow_id)
                out.append((workflow_id, workflow_name))
                break
    return out


# ─── Public service API ─────────────────────────────────────────────────────


async def create_dataset(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    name: str,
    description: Optional[str],
    created_by: uuid.UUID,
    visibility: Visibility = Visibility.PRIVATE,
) -> dict[str, Any]:
    normalized_visibility = Visibility.normalize(visibility) or Visibility.PRIVATE
    row = CohortDataset(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        name=name,
        description=description,
        created_by=created_by,
        visibility=normalized_visibility,
        shared_by=created_by if normalized_visibility == Visibility.SHARED else None,
        shared_at=(
            datetime.now(timezone.utc)
            if normalized_visibility == Visibility.SHARED
            else None
        ),
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise DatasetConflict(
            f"dataset name {name!r} already exists for app_id={app_id!r}"
        ) from exc
    await db.refresh(row)
    return _serialize_dataset(row, latest_version=None)


async def list_datasets(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: Optional[uuid.UUID] = None,
    app_id: Optional[str] = None,
    visibility: str = "all",
) -> list[dict[str, Any]]:
    stmt = select(CohortDataset).where(CohortDataset.tenant_id == tenant_id)
    if user_id is not None:
        if visibility == "private":
            stmt = stmt.where(CohortDataset.created_by == user_id)
        elif visibility == "shared":
            stmt = stmt.where(CohortDataset.visibility == Visibility.SHARED)
        else:
            stmt = stmt.where(
                or_(
                    CohortDataset.created_by == user_id,
                    CohortDataset.visibility == Visibility.SHARED,
                )
            )
    if app_id is not None:
        stmt = stmt.where(CohortDataset.app_id == app_id)
    stmt = stmt.order_by(CohortDataset.created_at.desc())
    datasets = (await db.execute(stmt)).scalars().all()

    if not datasets:
        return []

    # Second round-trip: fetch the (id, version_number, dataset_id) of
    # every version owned by these datasets. Derive (a) the latest row per
    # dataset and (b) the full list of version_ids the picker needs to
    # reverse-resolve an older pinned version.
    dataset_ids = [d.id for d in datasets]
    versions_stmt = (
        select(CohortDatasetVersion)
        .where(CohortDatasetVersion.dataset_id.in_(dataset_ids))
        .order_by(
            CohortDatasetVersion.dataset_id,
            CohortDatasetVersion.version_number.desc(),
        )
    )
    version_rows = (await db.execute(versions_stmt)).scalars().all()
    latest_by_ds: dict[uuid.UUID, CohortDatasetVersion] = {}
    ids_by_ds: dict[uuid.UUID, list[uuid.UUID]] = {}
    for v in version_rows:
        latest_by_ds.setdefault(v.dataset_id, v)
        ids_by_ds.setdefault(v.dataset_id, []).append(v.id)
    return [
        _serialize_dataset(
            d,
            latest_version=latest_by_ds.get(d.id),
            version_ids=ids_by_ds.get(d.id, []),
        )
        for d in datasets
    ]


async def get_dataset(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    dataset_id: uuid.UUID,
) -> dict[str, Any]:
    dataset = await _load_dataset(db, tenant_id=tenant_id, dataset_id=dataset_id)
    versions = (
        await db.execute(
            select(CohortDatasetVersion)
            .where(CohortDatasetVersion.dataset_id == dataset.id)
            .order_by(CohortDatasetVersion.version_number.desc())
        )
    ).scalars().all()
    latest = versions[0] if versions else None
    payload = _serialize_dataset(
        dataset,
        latest_version=latest,
        version_ids=[v.id for v in versions],
    )
    payload["versions"] = [_serialize_version(v) for v in versions]
    return payload


async def update_dataset(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    dataset_id: uuid.UUID,
    name: Optional[str] = None,
    description: Optional[str] = None,
    visibility: Optional[Visibility] = None,
) -> dict[str, Any]:
    dataset = await _load_dataset(db, tenant_id=tenant_id, dataset_id=dataset_id)
    if name is not None:
        dataset.name = name
    if description is not None:
        dataset.description = description
    if visibility is not None:
        normalized_visibility = Visibility.normalize(visibility) or Visibility.PRIVATE
        dataset.visibility = normalized_visibility
        if normalized_visibility == Visibility.SHARED:
            dataset.shared_by = dataset.created_by
            dataset.shared_at = dataset.shared_at or datetime.now(timezone.utc)
        else:
            dataset.shared_by = None
            dataset.shared_at = None
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise DatasetConflict(
            f"dataset name {name!r} already exists for app_id={dataset.app_id!r}"
        ) from exc
    await db.refresh(dataset)
    return await get_dataset(db, tenant_id=tenant_id, dataset_id=dataset_id)


async def delete_dataset(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    dataset_id: uuid.UUID,
) -> None:
    dataset = await _load_dataset(db, tenant_id=tenant_id, dataset_id=dataset_id)
    version_ids = (
        await db.execute(
            select(CohortDatasetVersion.id).where(
                CohortDatasetVersion.dataset_id == dataset.id
            )
        )
    ).scalars().all()
    if version_ids:
        bindings = await _find_workflow_bindings(
            db, tenant_id=tenant_id, version_ids=list(version_ids),
        )
        if bindings:
            workflow_ids = [b[0] for b in bindings]
            workflow_names = [b[1] for b in bindings]
            raise DatasetInUse(
                f"dataset {dataset.id} is referenced by "
                f"{len(bindings)} workflow version(s); unbind before deleting",
                workflow_ids=workflow_ids,
                workflow_names=workflow_names,
            )
    await db.delete(dataset)
    await db.commit()


async def import_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    dataset_id: uuid.UUID,
    imported: ImportedDataset,
    source_type: str,
    source_filename: Optional[str],
    source_byte_size: Optional[int],
    id_strategy: str,
    id_column: Optional[str],
    imported_by: uuid.UUID,
) -> dict[str, Any]:
    dataset = await _load_dataset(
        db, tenant_id=tenant_id, dataset_id=dataset_id, for_update=True,
    )

    next_version = (
        await db.scalar(
            select(CohortDatasetVersion.version_number)
            .where(CohortDatasetVersion.dataset_id == dataset.id)
            .order_by(CohortDatasetVersion.version_number.desc())
            .limit(1)
        )
    )
    next_version = (next_version or 0) + 1

    version = CohortDatasetVersion(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        version_number=next_version,
        source_type=source_type,
        source_filename=source_filename,
        source_byte_size=source_byte_size,
        row_count=len(imported.rows),
        id_strategy=id_strategy,
        id_column=id_column,
        schema_descriptor=imported.schema_descriptor,
        imported_by=imported_by,
    )
    db.add(version)
    await db.flush()  # version.id needs to exist for the row insert below.

    if imported.rows:
        row_dicts = [
            {
                "dataset_version_id": version.id,
                "row_seq": idx,
                "tenant_id": tenant_id,
                "recipient_id": imported.recipient_ids[idx],
                "payload": imported.rows[idx],
            }
            for idx in range(len(imported.rows))
        ]
        await db.execute(insert(CohortDatasetRow), row_dicts)

    await db.commit()
    await db.refresh(version)
    return _serialize_version(version)


async def get_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    dataset_id: uuid.UUID,
    version_id: uuid.UUID,
    sample_rows: int = 0,
) -> dict[str, Any]:
    version = await _load_version(
        db, tenant_id=tenant_id, dataset_id=dataset_id, version_id=version_id,
    )
    sample: Optional[list[dict[str, Any]]] = None
    if sample_rows > 0:
        # Clamp at 50; the importer caps datasets at 20k rows but the API
        # surface should still keep response payloads bounded.
        limit = min(sample_rows, 50)
        rows = (
            await db.execute(
                select(CohortDatasetRow)
                .where(CohortDatasetRow.dataset_version_id == version.id)
                .order_by(CohortDatasetRow.row_seq.asc())
                .limit(limit)
            )
        ).scalars().all()
        sample = [
            {"recipient_id": r.recipient_id, "payload": r.payload} for r in rows
        ]
    return _serialize_version(version, sample_rows=sample)


async def delete_version(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    dataset_id: uuid.UUID,
    version_id: uuid.UUID,
) -> None:
    version = await _load_version(
        db, tenant_id=tenant_id, dataset_id=dataset_id, version_id=version_id,
    )
    bindings = await _find_workflow_bindings(
        db, tenant_id=tenant_id, version_ids=[version.id],
    )
    if bindings:
        workflow_ids = [b[0] for b in bindings]
        workflow_names = [b[1] for b in bindings]
        raise DatasetInUse(
            f"dataset version {version.id} is referenced by "
            f"{len(bindings)} workflow version(s); unbind before deleting",
            workflow_ids=workflow_ids,
            workflow_names=workflow_names,
        )
    await db.delete(version)
    await db.commit()


__all__ = [
    "DatasetNotFound",
    "DatasetConflict",
    "DatasetInUse",
    "create_dataset",
    "list_datasets",
    "get_dataset",
    "delete_dataset",
    "import_version",
    "get_version",
    "delete_version",
]
