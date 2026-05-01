"""Phase 11 (Commit 2) — source catalog API surface.

Surfaces ``backend/app/services/orchestration/source_catalog.py`` to the
frontend so the SourceSelector editor can populate the source dropdown,
the payload-field picker, and the filter-column picker without the
builder having to know table names.
"""
from __future__ import annotations

from typing import Optional

from app.schemas.orchestration import CohortSourceResponse
from app.services.orchestration.source_catalog import list_sources


def list_cohort_sources(
    *,
    workflow_type: Optional[str] = None,
    app_id: Optional[str] = None,
) -> list[CohortSourceResponse]:
    """Return registered cohort sources, filtered by workflow type / app id.

    The schema-qualified table name is intentionally **not** surfaced —
    authors select sources by ``source_ref``; the underlying table is an
    engineering concern and not authoring config.
    """
    return [
        CohortSourceResponse(
            source_ref=s.source_ref,
            display_label=s.display_label,
            description=s.description,
            workflow_types=list(s.workflow_types),
            app_ids=list(s.app_ids),
            id_column=s.id_column,
            allowed_payload_columns=list(s.allowed_payload_columns),
            allowed_filter_columns=list(s.allowed_filter_columns),
            allowed_lookback_columns=list(s.allowed_lookback_columns),
        )
        for s in list_sources(workflow_type=workflow_type, app_id=app_id)
    ]


__all__ = ["list_cohort_sources"]
