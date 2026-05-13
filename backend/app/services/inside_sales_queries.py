"""Postgres-backed query services for Inside Sales collection serving."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import Integer as _SAInteger, Select, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.services.lsq_client import extract_lead_plan_fields

INSIDE_SALES_STALE_AFTER = timedelta(minutes=30)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _format_response_datetime(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _format_optional_response_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _format_response_datetime(value)


def _to_float(value: Decimal | float | int | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _call_sort_expression():
    return func.coalesce(CrmCallRecord.call_started_at, CrmCallRecord.created_on)


def _normalize_text_values(values: tuple[str, ...]) -> tuple[str, ...]:
    """Strip + lowercase + collapse whitespace for case-insensitive equality.

    Mirrors what `func.lower(col)` produces on the Postgres side, so callers
    can do `func.lower(col).in_(_normalize_text_values(values))`.
    """
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
    clauses: list[Any] = [
        CrmCallRecord.tenant_id == tenant_id,
        CrmCallRecord.app_id == app_id,
    ]

    rep_names = _normalize_text_values(filters.agents)
    if rep_names:
        clauses.append(func.lower(CrmCallRecord.rep_name).in_(rep_names))

    call_lead_ids = tuple(lid.strip() for lid in filters.lead_ids if lid.strip())
    if call_lead_ids:
        clauses.append(
            or_(*(CrmCallRecord.lead_id.ilike(f"%{lid}%") for lid in call_lead_ids))
        )

    if filters.direction:
        clauses.append(CrmCallRecord.direction == filters.direction)

    if filters.status:
        clauses.append(func.lower(CrmCallRecord.status) == filters.status.strip().lower())

    if filters.duration_min is not None:
        clauses.append(CrmCallRecord.duration_seconds >= filters.duration_min)

    if filters.duration_max is not None:
        clauses.append(CrmCallRecord.duration_seconds <= filters.duration_max)

    if filters.has_recording is True:
        clauses.append(CrmCallRecord.has_recording.is_(True))

    if filters.event_codes:
        clauses.append(CrmCallRecord.event_code.in_(filters.event_codes))

    return clauses


def build_call_filtered_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesCallFilters,
) -> Select:
    return select(CrmCallRecord).where(
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
    stmt = build_call_filtered_query(tenant_id=tenant_id, app_id=app_id, filters=filters).order_by(
        _call_sort_expression().desc(),
        CrmCallRecord.activity_id.desc(),
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
        .select_from(CrmCallRecord)
        .where(*_build_call_filter_clauses(tenant_id=tenant_id, app_id=app_id, filters=filters))
    )


def _build_lead_filter_clauses(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesLeadFilters,
) -> list[Any]:
    clauses: list[Any] = [
        CrmLeadRecord.tenant_id == tenant_id,
        CrmLeadRecord.app_id == app_id,
    ]

    # Post-Phase-9: domain fields filtered via JSONB key access on
    # raw_payload (typed cols dropped by Alembic 0043). The op("->>")
    # accessor produces a TEXT expression compatible with lower()/ilike.
    rp_text = lambda key: CrmLeadRecord.raw_payload.op("->>")(key)

    rep_names = _normalize_text_values(filters.agents)
    if rep_names:
        clauses.append(func.lower(rp_text("rep_name")).in_(rep_names))

    stages = _normalize_text_values(filters.stage)
    if stages:
        clauses.append(func.lower(rp_text("prospect_stage")).in_(stages))

    conditions = tuple(c.strip() for c in filters.condition if c.strip())
    if conditions:
        clauses.append(
            or_(*(rp_text("condition").ilike(f"%{condition}%") for condition in conditions))
        )

    cities = tuple(c.strip() for c in filters.city if c.strip())
    if cities:
        clauses.append(
            or_(*(CrmLeadRecord.city.ilike(f"%{city}%") for city in cities))
        )

    lead_ids = tuple(lid.strip() for lid in filters.lead_ids if lid.strip())
    if lead_ids:
        clauses.append(
            or_(*(CrmLeadRecord.lead_id.ilike(f"%{lid}%") for lid in lead_ids))
        )

    phones = tuple(p.strip() for p in filters.phones if p.strip())
    if phones:
        # Digits-only compare so UI input like "+91 98-xxx" matches a stored
        # "+919800000000". Keep raw ilike as fallback for non-digit chars.
        phone_clauses = []
        phone_col = func.regexp_replace(
            func.coalesce(CrmLeadRecord.phone, ""), r"\D", "", "g"
        )
        for value in phones:
            digits = "".join(ch for ch in value if ch.isdigit())
            if digits:
                phone_clauses.append(phone_col.ilike(f"%{digits}%"))
            else:
                phone_clauses.append(CrmLeadRecord.phone.ilike(f"%{value}%"))
        if phone_clauses:
            clauses.append(or_(*phone_clauses))

    plan_names = tuple(name.strip() for name in filters.plan_names if name.strip())
    if plan_names:
        clauses.append(
            or_(*(rp_text("plan_name").ilike(f"%{name}%") for name in plan_names))
        )

    if filters.mql_min is not None:
        # mql_score lives inside raw_payload (JSONB) post-Phase-9. Cast
        # to integer for numeric comparison; NULLs short-circuit to 0.
        mql_score_expr = func.coalesce(
            func.nullif(rp_text("mql_score"), "").cast(_SAInteger),
            0,
        )
        clauses.append(mql_score_expr >= filters.mql_min)

    if filters.q:
        needle = filters.q.strip()
        if needle:
            clauses.append(
                func.concat(
                    func.coalesce(CrmLeadRecord.first_name, ""),
                    " ",
                    func.coalesce(CrmLeadRecord.last_name, ""),
                    " ",
                    func.coalesce(CrmLeadRecord.phone, ""),
                ).ilike(f"%{needle}%")
            )

    return clauses


def build_lead_filtered_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesLeadFilters,
) -> Select:
    return select(CrmLeadRecord).where(
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
        .order_by(CrmLeadRecord.created_on.desc(), CrmLeadRecord.lead_id.desc())
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
        .select_from(CrmLeadRecord)
        .where(*_build_lead_filter_clauses(tenant_id=tenant_id, app_id=app_id, filters=filters))
    )


def map_call_listing_row(
    call: CrmCallRecord,
    *,
    eval_count: int = 0,
    eval_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "activityId": call.activity_id,
        "leadId": call.lead_id,
        "repName": call.rep_name or "",
        "repEmail": call.rep_email or "",
        "eventCode": call.event_code,
        "direction": call.direction,
        "status": call.status or "",
        "callStartTime": _format_response_datetime(call.call_started_at or call.created_on),
        "durationSeconds": call.duration_seconds,
        "recordingUrl": call.recording_url or "",
        "phoneNumber": call.phone_number or "",
        "displayNumber": call.display_number or "",
        "callNotes": call.call_notes or "",
        "callSessionId": call.call_session_id or "",
        "createdOn": _format_response_datetime(call.created_on),
        "lastEvalScore": extract_inside_sales_eval_score(eval_result),
        "evalCount": int(eval_count or 0),
    }


def map_lead_call_history_entry(call: CrmCallRecord) -> dict[str, Any]:
    """Project a stored call row into the dict shape consumed by the lead
    drilldown response and ``compute_drilldown_metrics``.

    Returned shape mirrors what ``normalize_activity`` used to emit, so
    downstream consumers do not need to branch on data source.
    """
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


def map_lead_listing_row(lead: CrmLeadRecord) -> dict[str, Any]:
    """Post-Phase-9: typed domain cols are gone from crm_lead_record; every
    domain field is now sourced from raw_payload (lead.bag) or computed
    at query time from fact_lead_activity downstream. PII cols (first_name,
    last_name, phone, email, city) stay as typed columns and are read
    directly. Activity-derived numerics (rnr_count etc.) are placeholder
    None until the Phase 9 follow-up wires fact-side aggregations.
    """
    bag = lead.bag
    # last_activity_on lives in raw_payload as an ISO string after Phase 9.
    raw_last_activity = bag.get("last_activity_on")
    last_activity_on: datetime | None
    if isinstance(raw_last_activity, datetime):
        last_activity_on = raw_last_activity
    elif isinstance(raw_last_activity, str) and raw_last_activity:
        try:
            last_activity_on = datetime.fromisoformat(
                raw_last_activity.replace("Z", "+00:00")
            )
        except ValueError:
            last_activity_on = None
    else:
        last_activity_on = None
    return {
        "leadId": lead.lead_id,
        "firstName": lead.first_name,
        "lastName": lead.last_name,
        "phone": lead.phone,
        "prospectStage": bag.get("prospect_stage"),
        "city": lead.city,
        "ageGroup": bag.get("age_group"),
        "condition": bag.get("condition"),
        "hba1cBand": bag.get("hba1c_band"),
        "intentToPay": bag.get("intent_to_pay"),
        "repName": bag.get("rep_name"),
        "rnrCount": bag.get("rnr_count"),
        "answeredCount": bag.get("answered_count"),
        "totalDials": bag.get("total_dials"),
        "connectRate": _to_float(bag.get("connect_rate")),
        "frtSeconds": bag.get("frt_seconds"),
        "leadAgeDays": bag.get("lead_age_days"),
        "daysSinceLastContact": bag.get("days_since_last_contact"),
        "mqlScore": bag.get("mql_score"),
        "mqlSignals": bag.get("mql_signals") or {},
        "createdOn": _format_response_datetime(lead.created_on),
        "lastActivityOn": (
            _format_optional_response_datetime(last_activity_on)
            if last_activity_on is not None
            else None
        ),
        "source": bag.get("source"),
        "sourceCampaign": bag.get("source_campaign"),
        "planName": bag.get("plan_name"),
        # Full plan-purchase surface. Read from ``raw_payload`` rather than
        # per-field columns — every plan attribute other than ``plan_name``
        # is derived at response time.
        "plan": extract_lead_plan_fields(lead.raw_payload),
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

    activity_ids = [call.activity_id for call in calls if call.activity_id]
    eval_map = await fetch_latest_eval_overlays(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        thread_ids=activity_ids,
    )

    records = []
    for call in calls:
        overlay = eval_map.get(call.activity_id)
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
    return ResolvedDatasetPage(
        records=[map_lead_listing_row(lead) for lead in leads],
        total=total,
        page=page,
        page_size=page_size,
    )


async def get_lead_record(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    lead_id: str,
) -> CrmLeadRecord | None:
    """Fetch one lead row from the synced mirror, or ``None`` if absent."""
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
    """Return up to ``limit`` most-recent calls for the lead.

    The boolean is ``True`` when the lead has more than ``limit`` matching
    rows. Implemented via ``LIMIT limit + 1`` so we avoid an extra
    ``COUNT`` round trip purely to set the flag.
    """
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


async def get_collection_sync_status(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    source_family: str,
) -> dict[str, Any]:
    """Durable freshness signal read straight from ``analytics.log_crm_source_sync``.

    Returns the most recent success, the most recent attempt, and whether a
    sync is in progress right now — three independent signals the UI needs
    to decide between "up-to-date", "refreshing", "last sync failed", and
    "never synced".
    """
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


_SUGGESTION_FIELDS: dict[tuple[str, str], Any] = {
    ("leads", "lead_id"): CrmLeadRecord.lead_id,
    ("leads", "phone"): CrmLeadRecord.phone,
    # Post-Phase-9: rep_name / prospect_stage / plan_name moved into
    # raw_payload (typed cols dropped). Suggestion lookups read them via
    # JSONB key access — same SQL surface, source switched.
    ("leads", "rep_name"): CrmLeadRecord.raw_payload.op("->>")("rep_name"),
    ("leads", "city"): CrmLeadRecord.city,
    ("leads", "stage"): CrmLeadRecord.raw_payload.op("->>")("prospect_stage"),
    ("leads", "plan_name"): CrmLeadRecord.raw_payload.op("->>")("plan_name"),
    ("calls", "lead_id"): CrmCallRecord.lead_id,
    ("calls", "rep_name"): CrmCallRecord.rep_name,
    # Legacy aliases retained as JSONB pointers for inbound API clients.
    ("leads", "prospect_id"): CrmLeadRecord.lead_id,
    ("leads", "agent_name"): CrmLeadRecord.raw_payload.op("->>")("rep_name"),
    ("calls", "prospect_id"): CrmCallRecord.lead_id,
    ("calls", "agent_name"): CrmCallRecord.rep_name,
}


def _suggestion_model_for(source_family: str) -> Any:
    if source_family == "leads":
        return CrmLeadRecord
    if source_family == "calls":
        return CrmCallRecord
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
    ``query``, tenant/app-scoped. Used to feed type-ahead filter dropdowns.

    ``field`` is validated against a fixed whitelist so this can never be
    steered into reading arbitrary columns. The same raw column the listing
    query matches against is read here, so what the user sees in the
    dropdown is exactly what filtering matches.
    """
    column = _SUGGESTION_FIELDS.get((source_family, field))
    if column is None:
        raise ValueError(
            f"unsupported suggestion field: source_family={source_family!r}, field={field!r}"
        )
    model = _suggestion_model_for(source_family)

    stmt = (
        select(column)
        .where(
            model.tenant_id == tenant_id,
            model.app_id == app_id,
            column.is_not(None),
            column != "",
        )
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


async def prune_rows_older_than(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    source_family: str,
    cutoff: datetime,
) -> int:
    """Delete synced source rows with `created_on < cutoff`.

    STRICTLY scoped to (tenant_id, app_id, source_family) — this is a
    tenant-isolation guarantee, not an optimization. Called only by
    scheduled `sync-external-source` runs (§PR4); on-demand syncs never
    prune.

    Returns the number of rows deleted.
    """
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
