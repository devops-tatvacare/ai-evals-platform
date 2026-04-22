"""Source-only resolvers that power eval/list reads after PR5.

The legacy `inside_sales_dataset_resolver` fetched records from LSQ
synchronously; PR5 routes every read through the synced source tables instead.
This module owns the selection logic (sampling, skip-evaluated, no-recording
filter) layered on top of the SQL queries already defined in
`inside_sales_queries`.
"""

from __future__ import annotations

import random
import uuid
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import EvalRun, ThreadEvaluation
from app.services.inside_sales_dataset_resolver import (
    CallDatasetScope,
    CallSelectionMode,
    InsideSalesCallFilters,
    InsideSalesLeadFilters,
    ResolvedCallSelection,
    ResolvedDatasetPage,
)
from app.services.inside_sales_queries import (
    list_calls_from_source,
    list_leads_from_source,
)

INSIDE_SALES_APP_ID = "inside-sales"


async def resolve_call_dataset_page_from_source(
    filters: InsideSalesCallFilters,
    *,
    page: int,
    page_size: int,
    scope: CallDatasetScope,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
    app_id: str = INSIDE_SALES_APP_ID,
) -> ResolvedDatasetPage:
    return await list_calls_from_source(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        filters=filters,
        page=page,
        page_size=page_size,
        scope=scope,
    )


async def resolve_lead_dataset_page_from_source(
    filters: InsideSalesLeadFilters,
    *,
    page: int,
    page_size: int,
    tenant_id: uuid.UUID,
    app_id: str = INSIDE_SALES_APP_ID,
    db: AsyncSession,
) -> ResolvedDatasetPage:
    return await list_leads_from_source(
        db,
        tenant_id=tenant_id,
        app_id=app_id,
        filters=filters,
        page=page,
        page_size=page_size,
    )


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
    """Source-backed selection: replaces `resolve_call_selection`'s LSQ fetch.

    Post-SQL steps (selection mode, skip_evaluated, no-recording, sampling)
    stay in Python so they remain deterministic across provider and storage
    backends — identical semantics to the legacy resolver.
    """
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
    filtered: list[dict] = list(dataset.records)

    selected_ids = {cid for cid in selected_call_ids if cid}
    if selection_mode == "specific":
        filtered = [
            record for record in filtered if (record.get("activityId") or "") in selected_ids
        ]

    if min_duration_seconds is not None:
        filtered = [
            record for record in filtered if (record.get("durationSeconds") or 0) >= min_duration_seconds
        ]

    skipped_evaluated = 0
    if skip_evaluated and filtered:
        activity_ids = [r["activityId"] for r in filtered if r.get("activityId")]
        evaluated_ids = set(
            await db.scalars(
                select(ThreadEvaluation.thread_id)
                .join(EvalRun, ThreadEvaluation.run_id == EvalRun.id)
                .where(
                    EvalRun.tenant_id == tenant_id,
                    EvalRun.user_id == user_id,
                    EvalRun.app_id == app_id,
                    EvalRun.status == "completed",
                    ThreadEvaluation.thread_id.in_(activity_ids),
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
