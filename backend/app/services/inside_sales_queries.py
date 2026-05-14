"""Postgres-backed query services for Inside Sales collection serving.

Phase 11E: the calls + leads listing surfaces read the **fact tables**
(``analytics.fact_lead_activity`` / ``analytics.dim_lead`` /
``analytics.fact_lead_signal``) — the canonical, CRM-agnostic analytical
surface — not the CRM mirrors. The public function signatures and the DTO
dict shapes are unchanged, so the routes, response schemas, and frontend
pages are untouched; only the data source moved.

What still reads the mirror, by design:
  * ``get_lead_record`` + ``list_call_history_for_lead`` — the single-lead
    drilldown stays on the mirror per plan §1.3 (untouched surface).
  * ``prune_rows_older_than`` — prunes the mirrors, which are still synced.
  * ``get_collection_sync_status`` / ``get_collection_freshness`` — read
    ``log_crm_source_sync``, unrelated to the data tables.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Integer as _SAInteger, Select, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_lead_facts import (
    DimLead,
    FactLeadActivity,
    FactLeadSignal,
)
from app.models.source_records import CrmCallRecord, CrmLeadRecord, LogCrmSourceSync
from app.services.inside_sales_dataset_resolver import (
    CallDatasetScope,
    InsideSalesCallFilters,
    InsideSalesLeadFilters,
    ResolvedDatasetPage,
)
from app.services.inside_sales_eval_linkage import (
    extract_inside_sales_eval_score,
    fetch_latest_eval_overlays,
)

INSIDE_SALES_STALE_AFTER = timedelta(minutes=30)

# The MQL signal_set's per-signal types (seeded `mql` rule definition).
# The leads listing assembles the mqlScore / mqlSignals DTO fields from
# these fact_lead_signal rows.
_MQL_SCORE_SIGNAL = "mql_score"
_MQL_SIGNAL_PREFIX = "mql_"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _format_response_datetime(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _attr(column, key: str):
    """JSONB ``->>`` text accessor on a fact/dim ``attributes`` column."""
    return column.op("->>")(key)


def _attr_int(column, key: str):
    """JSONB key cast to int, NULL-safe (blank string → NULL → 0 at compare)."""
    return func.nullif(column.op("->>")(key), "").cast(_SAInteger)


# ── calls — backed by analytics.fact_lead_activity (activity_type='call') ──


def _call_sort_expression():
    """Mirror-side sort — used by the single-lead drilldown history, which
    stays on the mirror per §1.3."""
    return func.coalesce(CrmCallRecord.call_started_at, CrmCallRecord.created_on)


def _normalize_text_values(values: tuple[str, ...]) -> tuple[str, ...]:
    """Strip + lowercase + collapse whitespace for case-insensitive equality."""
    out: list[str] = []
    for value in values:
        if not value:
            continue
        normalized = " ".join(value.strip().lower().split())
        if normalized:
            out.append(normalized)
    return tuple(out)


def _build_call_filter_clauses(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesCallFilters,
) -> list[Any]:
    attrs = FactLeadActivity.attributes
    clauses: list[Any] = [
        FactLeadActivity.tenant_id == tenant_id,
        FactLeadActivity.app_id == app_id,
        FactLeadActivity.activity_type == "call",
    ]

    rep_names = _normalize_text_values(filters.agents)
    if rep_names:
        clauses.append(func.lower(FactLeadActivity.actor_label).in_(rep_names))

    call_lead_ids = tuple(lid.strip() for lid in filters.lead_ids if lid.strip())
    if call_lead_ids:
        clauses.append(
            or_(*(FactLeadActivity.lead_id.ilike(f"%{lid}%") for lid in call_lead_ids))
        )

    if filters.direction:
        clauses.append(_attr(attrs, "direction") == filters.direction)

    if filters.status:
        clauses.append(
            func.lower(_attr(attrs, "status")) == filters.status.strip().lower()
        )

    if filters.duration_min is not None:
        clauses.append(_attr_int(attrs, "duration_seconds") >= filters.duration_min)

    if filters.duration_max is not None:
        clauses.append(_attr_int(attrs, "duration_seconds") <= filters.duration_max)

    if filters.has_recording is True:
        clauses.append(_attr(attrs, "has_recording") == "true")

    if filters.event_codes:
        clauses.append(FactLeadActivity.source_event_code.in_(filters.event_codes))

    return clauses


def build_call_filtered_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesCallFilters,
) -> Select:
    return select(FactLeadActivity).where(
        *_build_call_filter_clauses(tenant_id=tenant_id, app_id=app_id, filters=filters)
    )


def build_call_listing_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesCallFilters,
    page: int,
    page_size: int,
    scope: CallDatasetScope,
) -> Select:
    stmt = build_call_filtered_query(
        tenant_id=tenant_id, app_id=app_id, filters=filters
    ).order_by(
        FactLeadActivity.occurred_at.desc().nullslast(),
        FactLeadActivity.source_activity_id.desc(),
    )
    if scope == "all":
        return stmt
    offset = max(page - 1, 0) * page_size
    return stmt.offset(offset).limit(page_size)


def build_call_count_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesCallFilters,
) -> Select:
    return (
        select(func.count())
        .select_from(FactLeadActivity)
        .where(*_build_call_filter_clauses(tenant_id=tenant_id, app_id=app_id, filters=filters))
    )


def map_call_listing_row(
    call: FactLeadActivity,
    *,
    eval_count: int = 0,
    eval_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Project a ``fact_lead_activity`` (call) row into the calls DTO.

    Phase 11E: the row carries the manifest ``{structural columns +
    attributes JSONB}`` shape — typed structural columns at the top level,
    the call-specific payload in the ``attributes`` bag (the per-
    ``activity_type`` schema declared in the manifest). The frontend
    renders the bag generically via ``AttributesPanel`` + ``useCrmSchema``;
    nothing is flattened into bespoke named fields here."""
    return {
        "activityId": call.source_activity_id,
        "leadId": call.lead_id,
        "repName": call.actor_label,
        "eventCode": call.source_event_code,
        "activityType": call.activity_type,
        "callStartTime": _format_response_datetime(call.occurred_at),
        "createdOn": _format_response_datetime(call.created_at),
        "attributes": dict(call.attributes or {}),
        "lastEvalScore": extract_inside_sales_eval_score(eval_result),
        "evalCount": int(eval_count or 0),
    }


async def list_calls_from_source(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesCallFilters,
    page: int,
    page_size: int,
    scope: CallDatasetScope,
) -> ResolvedDatasetPage:
    total = int(
        (await db.execute(build_call_count_query(tenant_id=tenant_id, app_id=app_id, filters=filters)))
        .scalar_one()
        or 0
    )
    result = await db.execute(
        build_call_listing_query(
            tenant_id=tenant_id,
            app_id=app_id,
            filters=filters,
            page=page,
            page_size=page_size,
            scope=scope,
        )
    )
    calls = list(result.scalars().all())

    activity_ids = [c.source_activity_id for c in calls if c.source_activity_id]
    eval_map = await fetch_latest_eval_overlays(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        thread_ids=activity_ids,
    )

    records = []
    for call in calls:
        overlay = eval_map.get(call.source_activity_id)
        records.append(
            map_call_listing_row(
                call,
                eval_count=overlay.eval_count if overlay else 0,
                eval_result=overlay.latest_result if overlay else None,
            )
        )
    resolved_page_size = total if scope == "all" and total > 0 else page_size
    return ResolvedDatasetPage(
        records=records,
        total=total,
        page=1 if scope == "all" else page,
        page_size=resolved_page_size,
    )


# ── leads — backed by analytics.dim_lead (+ fact_lead_signal for MQL) ──────


def _build_lead_filter_clauses(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesLeadFilters,
) -> list[Any]:
    afs = DimLead.attributes_at_first_seen
    attrs = DimLead.attributes
    clauses: list[Any] = [
        DimLead.tenant_id == tenant_id,
        DimLead.app_id == app_id,
    ]

    rep_names = _normalize_text_values(filters.agents)
    if rep_names:
        clauses.append(func.lower(DimLead.assigned_rep_label).in_(rep_names))

    stages = _normalize_text_values(filters.stage)
    if stages:
        clauses.append(func.lower(DimLead.latest_stage_observed).in_(stages))

    conditions = tuple(c.strip() for c in filters.condition if c.strip())
    if conditions:
        clauses.append(
            or_(*(_attr(afs, "condition").ilike(f"%{c}%") for c in conditions))
        )

    cities = tuple(c.strip() for c in filters.city if c.strip())
    if cities:
        clauses.append(or_(*(DimLead.city.ilike(f"%{city}%") for city in cities)))

    lead_ids = tuple(lid.strip() for lid in filters.lead_ids if lid.strip())
    if lead_ids:
        clauses.append(or_(*(DimLead.lead_id.ilike(f"%{lid}%") for lid in lead_ids)))

    phones = tuple(p.strip() for p in filters.phones if p.strip())
    if phones:
        phone_clauses = []
        phone_col = func.regexp_replace(
            func.coalesce(DimLead.phone, ""), r"\D", "", "g"
        )
        for value in phones:
            digits = "".join(ch for ch in value if ch.isdigit())
            if digits:
                phone_clauses.append(phone_col.ilike(f"%{digits}%"))
            else:
                phone_clauses.append(DimLead.phone.ilike(f"%{value}%"))
        if phone_clauses:
            clauses.append(or_(*phone_clauses))

    plan_names = tuple(name.strip() for name in filters.plan_names if name.strip())
    if plan_names:
        clauses.append(
            or_(*(_attr(attrs, "plan_name").ilike(f"%{name}%") for name in plan_names))
        )

    if filters.mql_min is not None:
        # MQL score now lives in fact_lead_signal (signal_type='mql_score').
        # Filter leads whose latest mql_score signal is >= the threshold.
        mql_subq = (
            select(FactLeadSignal.lead_id)
            .where(
                FactLeadSignal.tenant_id == tenant_id,
                FactLeadSignal.app_id == app_id,
                FactLeadSignal.signal_type == _MQL_SCORE_SIGNAL,
                FactLeadSignal.signal_value_numeric >= filters.mql_min,
            )
        )
        clauses.append(DimLead.lead_id.in_(mql_subq))

    if filters.q:
        needle = filters.q.strip()
        if needle:
            clauses.append(
                func.concat(
                    func.coalesce(DimLead.first_name, ""),
                    " ",
                    func.coalesce(DimLead.last_name, ""),
                    " ",
                    func.coalesce(DimLead.phone, ""),
                ).ilike(f"%{needle}%")
            )

    return clauses


def build_lead_filtered_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesLeadFilters,
) -> Select:
    return select(DimLead).where(
        *_build_lead_filter_clauses(tenant_id=tenant_id, app_id=app_id, filters=filters)
    )


def build_lead_listing_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesLeadFilters,
    page: int,
    page_size: int,
) -> Select:
    offset = max(page - 1, 0) * page_size
    return (
        build_lead_filtered_query(tenant_id=tenant_id, app_id=app_id, filters=filters)
        .order_by(
            DimLead.lsq_created_on.desc().nullslast(),
            DimLead.lead_id.desc(),
        )
        .offset(offset)
        .limit(page_size)
    )


def build_lead_count_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesLeadFilters,
) -> Select:
    return (
        select(func.count())
        .select_from(DimLead)
        .where(*_build_lead_filter_clauses(tenant_id=tenant_id, app_id=app_id, filters=filters))
    )


async def _load_mql_for_leads(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    lead_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """Assemble ``{lead_id: {"score": int|None, "signals": {name: bool}}}``
    from ``fact_lead_signal`` for a page of leads. Empty when the
    ``derive-signals`` Transform hasn't run yet."""
    if not lead_ids:
        return {}
    rows = (
        await db.execute(
            select(
                FactLeadSignal.lead_id,
                FactLeadSignal.signal_type,
                FactLeadSignal.signal_value,
                FactLeadSignal.signal_value_numeric,
            ).where(
                FactLeadSignal.tenant_id == tenant_id,
                FactLeadSignal.app_id == app_id,
                FactLeadSignal.lead_id.in_(lead_ids),
                FactLeadSignal.signal_type.like(f"{_MQL_SIGNAL_PREFIX}%"),
            )
        )
    ).all()
    out: dict[str, dict[str, Any]] = {}
    for lead_id, signal_type, signal_value, signal_value_numeric in rows:
        entry = out.setdefault(lead_id, {"score": None, "signals": {}})
        if signal_type == _MQL_SCORE_SIGNAL:
            entry["score"] = (
                int(signal_value_numeric) if signal_value_numeric is not None else None
            )
        else:
            # mql_age / mql_city / ... → {"age": True, "city": False, ...}
            name = signal_type[len(_MQL_SIGNAL_PREFIX):]
            entry["signals"][name] = signal_value == "true"
    return out


def map_lead_listing_row(
    lead: DimLead,
    *,
    mql: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Project a ``dim_lead`` row into the leads-listing DTO.

    Phase 11E: the row carries the manifest ``{structural columns +
    attributes JSONB}`` shape. Identity + current-state are typed
    structural columns; the frozen lead-profile snapshot is the
    ``attributesAtFirstSeen`` bag; the mutable current-state bag is
    ``attributes``; MQL is assembled from ``fact_lead_signal`` (``mql``
    arg). The frontend renders the bags generically via ``AttributesPanel``
    + ``useCrmSchema``. Activity-rollup metrics (dials / connect rate /
    FRT) are not part of the ``dim_lead`` serving surface — they are a
    named follow-up that computes them from ``fact_lead_activity``."""
    mql = mql or {}
    return {
        "leadId": lead.lead_id,
        "firstName": lead.first_name,
        "lastName": lead.last_name,
        "phone": lead.phone,
        "email": lead.email,
        "city": lead.city,
        "prospectStage": lead.latest_stage_observed,
        "repName": lead.assigned_rep_label,
        "source": lead.source,
        "createdOn": _format_response_datetime(lead.lsq_created_on),
        "mqlScore": mql.get("score"),
        "mqlSignals": mql.get("signals") or {},
        "attributesAtFirstSeen": dict(lead.attributes_at_first_seen or {}),
        "attributes": dict(lead.attributes or {}),
    }


async def list_leads_from_source(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesLeadFilters,
    page: int,
    page_size: int,
) -> ResolvedDatasetPage:
    total = int(
        (await db.execute(build_lead_count_query(tenant_id=tenant_id, app_id=app_id, filters=filters)))
        .scalar_one()
        or 0
    )
    result = await db.execute(
        build_lead_listing_query(
            tenant_id=tenant_id,
            app_id=app_id,
            filters=filters,
            page=page,
            page_size=page_size,
        )
    )
    leads = list(result.scalars().all())
    mql_map = await _load_mql_for_leads(
        db,
        tenant_id=tenant_id,
        app_id=app_id,
        lead_ids=[lead.lead_id for lead in leads],
    )
    return ResolvedDatasetPage(
        records=[
            map_lead_listing_row(lead, mql=mql_map.get(lead.lead_id))
            for lead in leads
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


# ── single-lead drilldown — stays on the mirror per plan §1.3 ──────────────


def map_lead_call_history_entry(call: CrmCallRecord) -> dict[str, Any]:
    """Project a stored mirror call row into the drilldown history shape."""
    return {
        "activityId": call.activity_id,
        "callTime": _format_response_datetime(call.call_started_at or call.created_on),
        "repName": call.rep_name or None,
        "durationSeconds": call.duration_seconds,
        "status": call.status or "",
        "recordingUrl": call.recording_url or None,
        "evalScore": None,
        "isCounseling": call.duration_seconds >= 600,
    }


async def get_lead_record(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    lead_id: str,
) -> CrmLeadRecord | None:
    """Fetch one lead row from the synced mirror, or ``None`` if absent.

    The single-lead drilldown stays on the mirror (plan §1.3) — it carries
    the full source-faithful payload the drilldown card renders."""
    stmt = select(CrmLeadRecord).where(
        CrmLeadRecord.tenant_id == tenant_id,
        CrmLeadRecord.app_id == app_id,
        CrmLeadRecord.lead_id == lead_id,
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def list_call_history_for_lead(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    lead_id: str,
    limit: int,
) -> tuple[list[CrmCallRecord], bool]:
    """Return up to ``limit`` most-recent calls for the lead, from the
    mirror (the drilldown stays mirror-backed per §1.3).

    The boolean is ``True`` when the lead has more than ``limit`` matching
    rows (implemented via ``LIMIT limit + 1``)."""
    stmt = (
        select(CrmCallRecord)
        .where(
            CrmCallRecord.tenant_id == tenant_id,
            CrmCallRecord.app_id == app_id,
            CrmCallRecord.lead_id == lead_id,
        )
        .order_by(_call_sort_expression())
        .limit(limit + 1)
    )
    rows = list((await db.execute(stmt)).scalars().all())
    if len(rows) > limit:
        return rows[:limit], True
    return rows, False


# ── sync freshness — reads log_crm_source_sync, unchanged ─────────────────


async def get_collection_sync_status(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    source_family: str,
) -> dict[str, Any]:
    """Durable freshness signal read straight from ``analytics.log_crm_source_sync``."""
    latest_successful = await db.scalar(
        select(LogCrmSourceSync)
        .where(
            LogCrmSourceSync.tenant_id == tenant_id,
            LogCrmSourceSync.app_id == app_id,
            LogCrmSourceSync.source_family == source_family,
            LogCrmSourceSync.status == "completed",
        )
        .order_by(LogCrmSourceSync.completed_at.desc(), LogCrmSourceSync.created_at.desc())
        .limit(1)
    )
    latest_attempt = await db.scalar(
        select(LogCrmSourceSync)
        .where(
            LogCrmSourceSync.tenant_id == tenant_id,
            LogCrmSourceSync.app_id == app_id,
            LogCrmSourceSync.source_family == source_family,
        )
        .order_by(LogCrmSourceSync.started_at.desc().nullslast(), LogCrmSourceSync.created_at.desc())
        .limit(1)
    )
    in_progress = await db.scalar(
        select(LogCrmSourceSync.id)
        .where(
            LogCrmSourceSync.tenant_id == tenant_id,
            LogCrmSourceSync.app_id == app_id,
            LogCrmSourceSync.source_family == source_family,
            LogCrmSourceSync.status == "running",
        )
        .limit(1)
    )
    return {
        "lastSuccessAt": latest_successful.completed_at if latest_successful else None,
        "lastAttemptAt": (
            (latest_attempt.started_at or latest_attempt.created_at)
            if latest_attempt
            else None
        ),
        "lastStatus": latest_attempt.status if latest_attempt else None,
        "lastError": latest_attempt.error_message if latest_attempt else None,
        "syncInProgress": in_progress is not None,
    }


async def get_collection_freshness(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    source_family: str,
) -> dict[str, Any]:
    latest_successful = await db.scalar(
        select(LogCrmSourceSync)
        .where(
            LogCrmSourceSync.tenant_id == tenant_id,
            LogCrmSourceSync.app_id == app_id,
            LogCrmSourceSync.source_family == source_family,
            LogCrmSourceSync.status == "completed",
        )
        .order_by(LogCrmSourceSync.completed_at.desc(), LogCrmSourceSync.created_at.desc())
        .limit(1)
    )
    sync_in_progress = await db.scalar(
        select(LogCrmSourceSync.id)
        .where(
            LogCrmSourceSync.tenant_id == tenant_id,
            LogCrmSourceSync.app_id == app_id,
            LogCrmSourceSync.source_family == source_family,
            LogCrmSourceSync.status == "running",
        )
        .limit(1)
    )
    last_synced_at = latest_successful.completed_at if latest_successful else None
    stale = last_synced_at is None or (_utc_now() - last_synced_at > INSIDE_SALES_STALE_AFTER)
    return {
        "lastSyncedAt": last_synced_at,
        "syncInProgress": sync_in_progress is not None,
        "stale": stale,
    }


# ── filter type-ahead suggestions — fact/dim-backed ───────────────────────

# (source_family, field) → the fact/dim column the listing filters on, so
# the dropdown values match exactly what filtering matches.
_SUGGESTION_FIELDS: dict[tuple[str, str], Any] = {
    ("leads", "lead_id"): DimLead.lead_id,
    ("leads", "phone"): DimLead.phone,
    ("leads", "rep_name"): DimLead.assigned_rep_label,
    ("leads", "city"): DimLead.city,
    ("leads", "stage"): DimLead.latest_stage_observed,
    ("leads", "plan_name"): DimLead.attributes.op("->>")("plan_name"),
    ("calls", "lead_id"): FactLeadActivity.lead_id,
    ("calls", "rep_name"): FactLeadActivity.actor_label,
    # Legacy aliases retained for inbound API clients.
    ("leads", "prospect_id"): DimLead.lead_id,
    ("leads", "agent_name"): DimLead.assigned_rep_label,
    ("calls", "prospect_id"): FactLeadActivity.lead_id,
    ("calls", "agent_name"): FactLeadActivity.actor_label,
}


def _suggestion_model_for(source_family: str) -> Any:
    if source_family == "leads":
        return DimLead
    if source_family == "calls":
        return FactLeadActivity
    raise ValueError(f"unsupported source_family for suggestions: {source_family!r}")


async def list_collection_suggestions(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    source_family: str,
    field: str,
    query: str,
    limit: int,
) -> list[str]:
    """Distinct values of ``field`` for the collection, prefix-filtered by
    ``query``, tenant/app-scoped. Feeds type-ahead filter dropdowns.

    ``field`` is validated against a fixed whitelist so this can never be
    steered into reading arbitrary columns."""
    column = _SUGGESTION_FIELDS.get((source_family, field))
    if column is None:
        raise ValueError(
            f"unsupported suggestion field: source_family={source_family!r}, field={field!r}"
        )
    model = _suggestion_model_for(source_family)

    where = [
        model.tenant_id == tenant_id,
        model.app_id == app_id,
        column.is_not(None),
        column != "",
    ]
    if model is FactLeadActivity:
        where.append(FactLeadActivity.activity_type == "call")

    stmt = (
        select(column)
        .where(*where)
        .distinct()
        .order_by(column)
        .limit(limit)
    )

    needle = (query or "").strip()
    if needle:
        if field == "phone":
            digits = "".join(ch for ch in needle if ch.isdigit())
            if digits:
                stmt = stmt.where(
                    func.regexp_replace(column, r"\D", "", "g").ilike(f"%{digits}%")
                )
            else:
                stmt = stmt.where(column.ilike(f"%{needle}%"))
        else:
            stmt = stmt.where(column.ilike(f"%{needle}%"))

    result = await db.execute(stmt)
    return [value for value in result.scalars().all() if value]


# ── mirror pruning — still prunes the synced mirrors ──────────────────────


async def prune_rows_older_than(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    source_family: str,
    cutoff: datetime,
) -> int:
    """Delete synced source-mirror rows with ``created_on < cutoff``.

    STRICTLY scoped to (tenant_id, app_id, source_family). Called only by
    scheduled ``sync-external-source`` runs. Still targets the mirrors —
    they remain the source-faithful landing tables that get synced and
    pruned; the serving layer just no longer reads them for listings.

    Returns the number of rows deleted."""
    if source_family == "calls":
        model = CrmCallRecord
    elif source_family == "leads":
        model = CrmLeadRecord
    else:
        raise ValueError(f"unsupported source_family for prune: {source_family!r}")

    stmt = delete(model).where(
        model.tenant_id == tenant_id,
        model.app_id == app_id,
        model.created_on.is_not(None),
        model.created_on < cutoff,
    )
    result = await db.execute(stmt)
    return int(result.rowcount or 0)
