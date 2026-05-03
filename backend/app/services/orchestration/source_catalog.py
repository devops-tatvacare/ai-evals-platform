"""Phase 11 — registered cohort sources.

A ``source.cohort_query`` node selects a cohort source by a stable
``source_ref`` key (e.g. ``crm.lead_record``). The catalog says which
underlying ``schema.table`` and id column back that ref, plus the columns
authors are allowed to project into payload, filter on, or use as a lookback
column. Authors never name raw tables or column lists themselves — that
keeps "what fields exist on a recipient" a tenant-stable contract instead
of a per-workflow free-form string.

Design intent:

  - The catalog is **engineering-owned**, not user-editable. Adding a source
    is a code change reviewed alongside any new fact / dimension table.
  - The catalog drives both **runtime SQL compilation** (cohort query) and
    **builder authoring affordances** (which fields show up in the
    payload-field picker, which columns are filter-able).
  - Per-app sources scope authoring: a workflow under ``app_id='inside-sales'``
    sees CRM sources; a workflow under a clinical app sees clinical sources.
    A single source may be shared across apps when its row-level security
    naturally filters by ``app_id`` (the cohort compiler always adds the
    tenant + app filter, regardless of catalog config).
  - The legacy ``source_table`` / ``id_column`` config remains supported via
    the normalization layer so old saved definitions and seed JSON load
    without churn — but new authoring should produce ``source_ref``.

This is the Commit 1 catalog scaffolding. A later commit will surface it
through an API route for builder dropdowns; this commit only wires the
in-process registry needed by the contract.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional, Union

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import CohortDataset, CohortDatasetVersion


class CohortSource(BaseModel):
    """One registered cohort source.

    ``schema_qualified_table`` is always written ``schema.table`` (never
    bare) so cohort-query SQL is schema-qualified per the project invariant.
    ``allowed_payload_columns`` and ``allowed_filter_columns`` may overlap.
    ``allowed_lookback_columns`` lists timestamp columns valid for the
    ``lookback_hours`` mechanic; if empty, lookback is not supported on
    this source.
    """
    source_ref: str
    display_label: str
    description: str
    workflow_types: list[str]  # ["crm"], ["clinical"], or both
    app_ids: list[str]
    schema_qualified_table: str
    id_column: str
    allowed_payload_columns: list[str] = Field(default_factory=list)
    allowed_filter_columns: list[str] = Field(default_factory=list)
    allowed_lookback_columns: list[str] = Field(default_factory=list)


_CATALOG: dict[str, CohortSource] = {
    "crm.lead_record": CohortSource(
        source_ref="crm.lead_record",
        display_label="CRM Leads",
        description="Lead records ingested from LeadSquared (analytics.crm_lead_record).",
        workflow_types=["crm"],
        app_ids=["inside-sales"],
        schema_qualified_table="analytics.crm_lead_record",
        # Phase 11 (Commit 2 hotfix): the actual recipient id column on
        # ``analytics.crm_lead_record`` is ``prospect_id`` — there is no
        # ``lead_id`` column. The cohort query compiler emits
        # ``src.{id_column}::text`` so a wrong value here fails at runtime
        # with ``UndefinedColumn``.
        id_column="prospect_id",
        # Allowed columns must match the actual model
        # (``app/models/source_records.py::CrmLeadRecord``). The original
        # list aspirated columns that don't exist on this table.
        allowed_payload_columns=[
            "prospect_id", "first_name", "last_name", "phone", "email",
            "city", "prospect_stage", "plan_name", "age_group", "condition",
            "hba1c_band", "intent_to_pay", "mql_score", "source",
            "source_campaign", "agent_name", "created_on", "first_activity_on",
            "last_activity_on", "rnr_count", "answered_count", "total_dials",
            "connect_rate", "frt_seconds", "lead_age_days",
            "days_since_last_contact",
        ],
        allowed_filter_columns=[
            "prospect_id", "prospect_stage", "plan_name", "city", "source",
            "agent_name", "mql_score", "created_on", "last_activity_on",
            "condition", "hba1c_band",
        ],
        allowed_lookback_columns=["created_on", "last_activity_on"],
    ),
    "clinical.dim_patient": CohortSource(
        source_ref="clinical.dim_patient",
        display_label="Clinical Patients",
        description="Active patient roster (clinical.dim_patient). Outbox-backed in v1.",
        workflow_types=["clinical"],
        app_ids=["inside-sales"],  # mounted under inside-sales until a dedicated care-pathways app pack ships
        schema_qualified_table="clinical.dim_patient",
        id_column="patient_id",
        allowed_payload_columns=[
            "first_name", "last_name", "preferred_language",
            "primary_condition", "active",
            "hba1c_latest", "hba1c_prior", "ldl_latest",
            "weight_kg", "bmi", "sbp_latest", "dbp_latest",
            "last_visit_at",
        ],
        allowed_filter_columns=[
            "primary_condition", "active", "hba1c_latest",
            "ldl_latest", "preferred_language",
        ],
        allowed_lookback_columns=["last_visit_at"],
    ),
}


class SourceCatalogError(KeyError):
    pass


def get_source(source_ref: str) -> CohortSource:
    if source_ref not in _CATALOG:
        raise SourceCatalogError(f"unknown source_ref: {source_ref!r}")
    return _CATALOG[source_ref]


def lookup_source(source_ref: str) -> Optional[CohortSource]:
    return _CATALOG.get(source_ref)


def list_sources(
    *,
    workflow_type: Optional[str] = None,
    app_id: Optional[str] = None,
) -> list[CohortSource]:
    """Filter sources by workflow type and / or app id."""
    out: list[CohortSource] = []
    for s in _CATALOG.values():
        if workflow_type and workflow_type not in s.workflow_types:
            continue
        if app_id and app_id not in s.app_ids:
            continue
        out.append(s)
    return sorted(out, key=lambda s: s.source_ref)


def all_source_refs() -> list[str]:
    return sorted(_CATALOG.keys())


def reverse_lookup_by_table(schema_qualified_table: str) -> Optional[CohortSource]:
    """Find the catalog entry whose ``schema_qualified_table`` matches.

    Used by the normalizer to upgrade legacy definitions that still carry
    ``source_table`` + ``id_column`` to the new ``source_ref`` form.
    """
    for s in _CATALOG.values():
        if s.schema_qualified_table == schema_qualified_table:
            return s
    return None


# ─── Phase 12 — DB-backed dataset sources ─────────────────────────────────
#
# Datasets are tenant-owned, user-uploaded cohort sources persisted in
# ``orchestration.cohort_dataset_versions``. They sit alongside the static
# engineering-owned catalog above: the ``resolve_source`` async helper
# returns a discriminated union covering both kinds so the cohort-query
# compiler can branch on the value type without re-doing the lookup.
#
# Static entries are returned as ``CohortSource`` (pydantic) by both the
# sync ``lookup_source`` helper and the async ``resolve_source``. Dataset
# entries are returned as ``DatasetSource`` (frozen dataclass) — this
# mirrors ``ImportedDataset`` in ``datasets/csv_importer.py`` and signals
# "value object resolved from a single DB row" rather than a
# pydantic-validated request/response model.

_DATASET_PREFIX = "dataset."


@dataclass(frozen=True)
class DatasetSource:
    """One DB-backed dataset version exposed as a cohort source.

    ``schema_descriptor`` is the JSONB blob persisted on
    ``cohort_dataset_versions.schema_descriptor`` (shape:
    ``{"columns": [{name, type, sample_values, distinct_count}], "row_count": int}``).
    The Phase 12 / Task 6 compiler branch reads it for type-aware predicate
    emission against ``orchestration.cohort_dataset_rows.payload``.
    """
    source_ref: str
    dataset_id: uuid.UUID
    dataset_version_id: uuid.UUID
    display_label: str
    workflow_types: list[str]
    app_id: str
    id_strategy: str  # 'column' or 'uuid'
    id_column: Optional[str]
    schema_descriptor: dict


ResolvedSource = Union[CohortSource, DatasetSource]


def _row_to_dataset_source(
    version: CohortDatasetVersion,
    dataset: CohortDataset,
) -> DatasetSource:
    return DatasetSource(
        source_ref=f"{_DATASET_PREFIX}{version.id}",
        dataset_id=dataset.id,
        dataset_version_id=version.id,
        display_label=f"{dataset.name} (v{version.version_number})",
        workflow_types=["*"],
        app_id=dataset.app_id,
        id_strategy=version.id_strategy,
        id_column=version.id_column,
        schema_descriptor=dict(version.schema_descriptor or {}),
    )


async def _load_dataset_source(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    source_ref: str,
) -> DatasetSource:
    suffix = source_ref[len(_DATASET_PREFIX):]
    try:
        version_id = uuid.UUID(suffix)
    except ValueError as exc:
        raise SourceCatalogError(
            f"malformed dataset source_ref: {source_ref!r}"
        ) from exc

    stmt = (
        select(CohortDatasetVersion, CohortDataset)
        .join(CohortDataset, CohortDatasetVersion.dataset_id == CohortDataset.id)
        .where(
            CohortDatasetVersion.id == version_id,
            CohortDatasetVersion.tenant_id == tenant_id,
        )
    )
    result = await db.execute(stmt)
    row = result.first()
    if row is None:
        raise SourceCatalogError(
            f"dataset version not found or not owned by tenant: {source_ref}"
        )
    version, dataset = row
    return _row_to_dataset_source(version, dataset)


async def resolve_source(
    source_ref: str,
    *,
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> ResolvedSource:
    """Resolve a source_ref against the static catalog or DB-backed datasets.

    Static entries hit the in-process ``_CATALOG`` and return a ``CohortSource``
    without a DB read. ``dataset.<uuid>`` entries are looked up against
    ``orchestration.cohort_dataset_versions`` filtered by ``tenant_id``.
    Cross-tenant access raises ``SourceCatalogError`` (the route layer maps
    it to 404 — never leak existence).
    """
    if source_ref in _CATALOG:
        return _CATALOG[source_ref]
    if source_ref.startswith(_DATASET_PREFIX):
        return await _load_dataset_source(db, tenant_id=tenant_id, source_ref=source_ref)
    raise SourceCatalogError(f"unknown source_ref: {source_ref!r}")


async def list_dataset_sources(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: Optional[str] = None,
) -> list[DatasetSource]:
    """Return latest version per dataset for the given tenant (and optional app)."""
    # DISTINCT ON (dataset_id) ordered by version_number DESC keeps only the
    # latest version per dataset in a single round-trip — same idea as
    # MAX(version_number) GROUP BY dataset_id but without the second join.
    stmt = (
        select(CohortDatasetVersion, CohortDataset)
        .join(CohortDataset, CohortDatasetVersion.dataset_id == CohortDataset.id)
        .where(CohortDataset.tenant_id == tenant_id)
        .distinct(CohortDatasetVersion.dataset_id)
        .order_by(
            CohortDatasetVersion.dataset_id,
            CohortDatasetVersion.version_number.desc(),
        )
    )
    if app_id is not None:
        stmt = stmt.where(CohortDataset.app_id == app_id)

    result = await db.execute(stmt)
    sources = [_row_to_dataset_source(version, dataset) for version, dataset in result.all()]
    return sorted(sources, key=lambda s: s.display_label)


__all__ = [
    "CohortSource",
    "DatasetSource",
    "ResolvedSource",
    "SourceCatalogError",
    "get_source",
    "lookup_source",
    "list_sources",
    "list_dataset_sources",
    "resolve_source",
    "all_source_refs",
    "reverse_lookup_by_table",
]
