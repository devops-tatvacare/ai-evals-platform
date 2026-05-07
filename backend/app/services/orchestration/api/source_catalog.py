"""Phase 11 (Commit 2) — source catalog API surface.

Surfaces ``backend/app/services/orchestration/source_catalog.py`` to the
frontend so the SourceSelector editor can populate the source dropdown,
the payload-field picker, and the filter-column picker without the
builder having to know table names.

Phase 12: extended to merge tenant-owned dataset versions alongside the
engineering-owned static catalog. The response carries a ``kind``
discriminator so the frontend picker can group the two visually. Dataset
entries derive their allowed-column lists from the persisted
``schema_descriptor`` (lookback columns = datetime-typed columns).
"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.orchestration import CohortSourceResponse
from app.services.orchestration.source_catalog import (
    DatasetSource,
    list_dataset_sources,
    list_sources,
)


# Where dataset rows physically live — surfaced for callers that may want
# to display it. The compiler's JSONB branch (Phase 12 / Task 6) is the
# only consumer that actually executes against this table.
_DATASET_ROWS_TABLE = "orchestration.cohort_dataset_rows"


def _dataset_to_response(ds: DatasetSource) -> CohortSourceResponse:
    columns = ds.schema_descriptor.get("columns") or []
    column_names = [c["name"] for c in columns if isinstance(c, dict) and c.get("name")]
    lookback_names = [
        c["name"]
        for c in columns
        if isinstance(c, dict) and c.get("type") == "datetime" and c.get("name")
    ]
    # ``recipient_id`` is the column the runtime materialises the
    # auto-generated UUID into when ``id_strategy == 'uuid'``; for column
    # strategy we surface the user's chosen id_column.
    id_column = ds.id_column if ds.id_strategy == "column" and ds.id_column else "recipient_id"
    return CohortSourceResponse(
        source_ref=ds.source_ref,
        display_label=ds.display_label,
        description=f"Uploaded dataset version ({len(column_names)} columns).",
        kind="dataset",
        workflow_types=list(ds.workflow_types),
        app_ids=[ds.app_id],
        id_column=id_column,
        allowed_payload_columns=list(column_names),
        allowed_filter_columns=list(column_names),
        allowed_lookback_columns=list(lookback_names),
        schema_descriptor=ds.schema_descriptor,
        row_count=ds.row_count,
        imported_at=ds.imported_at,
    )


async def list_cohort_sources(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: Optional[uuid.UUID] = None,
    workflow_type: Optional[str] = None,
    app_id: Optional[str] = None,
    app_ids: Optional[list[str]] = None,
) -> list[CohortSourceResponse]:
    """Return registered cohort sources, filtered by workflow type / app id.

    Static engineering-owned entries always carry ``kind='static'``; dataset
    entries scoped to ``tenant_id`` carry ``kind='dataset'``. Datasets are
    workflow-type-agnostic — they're returned regardless of the
    ``workflow_type`` filter, since an uploaded list of recipients can drive
    either CRM or clinical pathways.

    The schema-qualified table name is intentionally **not** surfaced —
    authors select sources by ``source_ref``; the underlying table is an
    engineering concern and not authoring config.
    """
    static_app_ids = [app_id] if app_id is not None else (app_ids or None)
    static_entries = [
        CohortSourceResponse(
            source_ref=s.source_ref,
            display_label=s.display_label,
            description=s.description,
            kind="static",
            workflow_types=list(s.workflow_types),
            app_ids=list(s.app_ids),
            id_column=s.id_column,
            allowed_payload_columns=list(s.allowed_payload_columns),
            allowed_filter_columns=list(s.allowed_filter_columns),
            allowed_lookback_columns=list(s.allowed_lookback_columns),
        )
        for s in list_sources(workflow_type=workflow_type, app_id=app_id)
        if static_app_ids is None or any(a in static_app_ids for a in s.app_ids)
    ]
    dataset_entries = [
        _dataset_to_response(ds)
        for ds in await list_dataset_sources(
            db, tenant_id=tenant_id, user_id=user_id, app_id=app_id, app_ids=app_ids,
        )
    ]
    return static_entries + dataset_entries


__all__ = ["list_cohort_sources"]
