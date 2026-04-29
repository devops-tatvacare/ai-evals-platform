"""Source-only resolvers that power eval reads.

Owns the selection logic (sampling, skip-evaluated, no-recording filter)
layered on top of the SQL queries defined in `inside_sales_queries`.
"""

from __future__ import annotations

import random
import uuid
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult
from app.models.source_records import CrmCallRecord
from app.services.inside_sales_dataset_resolver import (
    CallSelectionMode,
    InsideSalesCallFilters,
    ResolvedCallSelection,
)
from app.services.inside_sales_queries import (
    list_calls_from_source,
    map_call_listing_row,
)
from app.services.inside_sales_sync import INSIDE_SALES_APP_ID


class SpecificCallSelectionMissingError(ValueError):
    """Raised when ``selection_mode="specific"`` resolves fewer records
    than the user explicitly selected. Carries the missing IDs so the
    eval runner can surface a precise, actionable error."""

    def __init__(self, missing_ids: Sequence[str]) -> None:
        self.missing_ids = tuple(missing_ids)
        super().__init__(
            f"Specific selection missing {len(self.missing_ids)} call(s) "
            f"from source mirror: {sorted(self.missing_ids)}"
        )


async def _fetch_calls_by_activity_ids(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    activity_ids: Sequence[str],
) -> list[dict]:
    """Fetch specific calls from the source mirror by ID, bypassing
    agent / status filters. Scoped strictly to tenant + app.

    User-selected specific calls must not be silently dropped by UI
    filter defaults. The eval runner consumes the selection and does
    its own ``skip_evaluated`` query downstream, so we skip the per-row
    eval overlay here."""
    ids = [aid for aid in activity_ids if aid]
    if not ids:
        return []
    stmt = select(CrmCallRecord).where(
        CrmCallRecord.tenant_id == tenant_id,
        CrmCallRecord.app_id == app_id,
        CrmCallRecord.activity_id.in_(ids),
    )
    result = await db.execute(stmt)
    return [map_call_listing_row(call) for call in result.scalars().all()]


async def resolve_call_selection_from_source(
    filters: InsideSalesCallFilters,
    *,
    selection_mode: CallSelectionMode,
    selected_call_ids: Sequence[str],
    sample_size: int,
    skip_evaluated: bool,
    min_duration_seconds: int | None,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
    app_id: str = INSIDE_SALES_APP_ID,
) -> ResolvedCallSelection:
    """Source-backed selection for the eval runner.

    Post-SQL steps (selection mode, skip_evaluated, no-recording, sampling)
    stay in Python so they remain deterministic across provider and storage
    backends.

    Contract: when ``selection_mode == "specific"``, agent / status
    filters are bypassed and calls are fetched directly by
    ``activity_id`` scoped to tenant + app. If any requested ID does
    not resolve to a row in the source mirror, the function raises
    ``SpecificCallSelectionMissingError`` rather than silently returning
    a shorter list.
    """
    selected_ids = [cid for cid in selected_call_ids if cid]

    if selection_mode == "specific":
        filtered = await _fetch_calls_by_activity_ids(
            db,
            tenant_id=tenant_id,
            app_id=app_id,
            activity_ids=selected_ids,
        )
        found_ids = {r.get("activityId") for r in filtered if r.get("activityId")}
        missing = [cid for cid in selected_ids if cid not in found_ids]
        if missing:
            raise SpecificCallSelectionMissingError(missing)
    else:
        dataset = await list_calls_from_source(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            filters=filters,
            page=1,
            page_size=1000,  # ignored when scope='all'
            scope="all",
        )
        filtered = list(dataset.records)

    if min_duration_seconds is not None:
        filtered = [
            record for record in filtered if (record.get("durationSeconds") or 0) >= min_duration_seconds
        ]

    skipped_evaluated = 0
    if skip_evaluated and filtered:
        activity_ids = [r["activityId"] for r in filtered if r.get("activityId")]
        evaluated_ids = set(
            await db.scalars(
                select(EvaluationRunThreadResult.thread_id)
                .join(EvaluationRun, EvaluationRunThreadResult.run_id == EvaluationRun.id)
                .where(
                    EvaluationRun.tenant_id == tenant_id,
                    EvaluationRun.user_id == user_id,
                    EvaluationRun.app_id == app_id,
                    EvaluationRun.status == "completed",
                    EvaluationRunThreadResult.thread_id.in_(activity_ids),
                )
            )
        )
        skipped_evaluated = len(
            [r for r in filtered if r.get("activityId") in evaluated_ids]
        )
        filtered = [r for r in filtered if r.get("activityId") not in evaluated_ids]

    skipped_no_recording = len([r for r in filtered if not r.get("recordingUrl")])
    filtered = [r for r in filtered if r.get("recordingUrl")]

    if selection_mode == "sample" and len(filtered) > sample_size:
        filtered = random.sample(filtered, sample_size)

    return ResolvedCallSelection(
        records=filtered,
        skipped_evaluated=skipped_evaluated,
        skipped_no_recording=skipped_no_recording,
    )
