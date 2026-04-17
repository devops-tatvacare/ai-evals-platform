"""Postgres-backed query services for Inside Sales collection serving."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.models.inside_sales_mirror import InsideSalesCallMirror, InsideSalesLeadMirror, InsideSalesSyncRun
from app.services.inside_sales_dataset_resolver import (
    CallDatasetScope,
    InsideSalesCallFilters,
    InsideSalesLeadFilters,
    ResolvedDatasetPage,
    normalize_match_value,
)
from app.services.inside_sales_eval_linkage import (
    extract_inside_sales_eval_score,
    fetch_latest_eval_overlays,
)

INSIDE_SALES_STALE_AFTER = timedelta(minutes=30)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_query_datetime(value: str) -> datetime:
    cleaned = value.strip()
    if "T" in cleaned:
        cleaned = cleaned.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(cleaned)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return datetime.strptime(cleaned, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


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
    return func.coalesce(InsideSalesCallMirror.call_started_at, InsideSalesCallMirror.created_on)


def _build_call_filter_clauses(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesCallFilters,
) -> list[Any]:
    date_from = _parse_query_datetime(filters.date_from)
    date_to = _parse_query_datetime(filters.date_to)
    call_time = _call_sort_expression()

    clauses: list[Any] = [
        InsideSalesCallMirror.tenant_id == tenant_id,
        InsideSalesCallMirror.app_id == app_id,
        call_time >= date_from,
        call_time <= date_to,
    ]

    agent_names = tuple(
        normalized
        for normalized in (normalize_match_value(value) for value in filters.agents)
        if normalized
    )
    if agent_names:
        clauses.append(InsideSalesCallMirror.agent_name_normalized.in_(agent_names))

    if filters.prospect_id:
        clauses.append(
            InsideSalesCallMirror.prospect_id.ilike(f"%{filters.prospect_id.strip()}%")
        )

    if filters.direction:
        clauses.append(InsideSalesCallMirror.direction == filters.direction)

    if filters.status:
        clauses.append(
            InsideSalesCallMirror.status_normalized == normalize_match_value(filters.status)
        )

    if filters.duration_min is not None:
        clauses.append(InsideSalesCallMirror.duration_seconds >= filters.duration_min)

    if filters.duration_max is not None:
        clauses.append(InsideSalesCallMirror.duration_seconds <= filters.duration_max)

    if filters.has_recording is True:
        clauses.append(InsideSalesCallMirror.has_recording.is_(True))

    if filters.event_codes:
        clauses.append(InsideSalesCallMirror.event_code.in_(filters.event_codes))

    return clauses


def build_call_filtered_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesCallFilters,
) -> Select:
    return select(InsideSalesCallMirror).where(
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
        InsideSalesCallMirror.activity_id.desc(),
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
        .select_from(InsideSalesCallMirror)
        .where(*_build_call_filter_clauses(tenant_id=tenant_id, app_id=app_id, filters=filters))
    )


def _build_lead_filter_clauses(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesLeadFilters,
) -> list[Any]:
    date_from = _parse_query_datetime(filters.date_from)
    date_to = _parse_query_datetime(filters.date_to)

    clauses: list[Any] = [
        InsideSalesLeadMirror.tenant_id == tenant_id,
        InsideSalesLeadMirror.app_id == app_id,
        InsideSalesLeadMirror.created_on >= date_from,
        InsideSalesLeadMirror.created_on <= date_to,
    ]

    agent_names = tuple(
        normalized
        for normalized in (normalize_match_value(value) for value in filters.agents)
        if normalized
    )
    if agent_names:
        clauses.append(InsideSalesLeadMirror.agent_name_normalized.in_(agent_names))

    stages = tuple(
        normalized
        for normalized in (normalize_match_value(value) for value in filters.stage)
        if normalized
    )
    if stages:
        clauses.append(InsideSalesLeadMirror.prospect_stage_normalized.in_(stages))

    conditions = tuple(
        normalized
        for normalized in (normalize_match_value(value) for value in filters.condition)
        if normalized
    )
    if conditions:
        clauses.append(
            or_(*(InsideSalesLeadMirror.condition_normalized.ilike(f"%{condition}%") for condition in conditions))
        )

    cities = tuple(
        normalized
        for normalized in (normalize_match_value(value) for value in filters.city)
        if normalized
    )
    if cities:
        clauses.append(
            or_(*(InsideSalesLeadMirror.city_normalized.ilike(f"%{city}%") for city in cities))
        )

    if filters.prospect_id:
        clauses.append(InsideSalesLeadMirror.prospect_id == filters.prospect_id.strip())

    if filters.mql_min is not None:
        clauses.append(InsideSalesLeadMirror.mql_score >= filters.mql_min)

    return clauses


def build_lead_filtered_query(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    filters: InsideSalesLeadFilters,
) -> Select:
    return select(InsideSalesLeadMirror).where(
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
        .order_by(InsideSalesLeadMirror.created_on.desc(), InsideSalesLeadMirror.prospect_id.desc())
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
        .select_from(InsideSalesLeadMirror)
        .where(*_build_lead_filter_clauses(tenant_id=tenant_id, app_id=app_id, filters=filters))
    )


def map_call_listing_row(
    call: InsideSalesCallMirror,
    *,
    eval_count: int = 0,
    eval_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "activityId": call.activity_id,
        "prospectId": call.prospect_id,
        "agentName": call.agent_name or "",
        "agentEmail": call.agent_email or "",
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


def map_lead_listing_row(lead: InsideSalesLeadMirror) -> dict[str, Any]:
    return {
        "prospectId": lead.prospect_id,
        "firstName": lead.first_name,
        "lastName": lead.last_name,
        "phone": lead.phone,
        "prospectStage": lead.prospect_stage,
        "city": lead.city,
        "ageGroup": lead.age_group,
        "condition": lead.condition,
        "hba1cBand": lead.hba1c_band,
        "intentToPay": lead.intent_to_pay,
        "agentName": lead.agent_name,
        "rnrCount": lead.rnr_count,
        "answeredCount": lead.answered_count,
        "totalDials": lead.total_dials,
        "connectRate": _to_float(lead.connect_rate),
        "frtSeconds": lead.frt_seconds,
        "leadAgeDays": lead.lead_age_days,
        "daysSinceLastContact": lead.days_since_last_contact,
        "mqlScore": lead.mql_score,
        "mqlSignals": lead.mql_signals,
        "createdOn": _format_response_datetime(lead.created_on),
        "lastActivityOn": _format_optional_response_datetime(lead.last_activity_on),
        "source": lead.source,
        "sourceCampaign": lead.source_campaign,
    }


async def list_call_agent_names_from_mirror(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    date_from: str,
    date_to: str,
) -> list[str]:
    parsed_from = _parse_query_datetime(date_from)
    parsed_to = _parse_query_datetime(date_to)
    call_time = _call_sort_expression()

    result = await db.execute(
        select(InsideSalesCallMirror.agent_name, InsideSalesCallMirror.agent_name_normalized)
        .where(
            InsideSalesCallMirror.tenant_id == tenant_id,
            InsideSalesCallMirror.app_id == app_id,
            call_time >= parsed_from,
            call_time <= parsed_to,
            InsideSalesCallMirror.agent_name.is_not(None),
            InsideSalesCallMirror.agent_name_normalized.is_not(None),
        )
        .distinct(InsideSalesCallMirror.agent_name_normalized)
        .order_by(InsideSalesCallMirror.agent_name_normalized.asc(), InsideSalesCallMirror.agent_name.asc())
    )
    return [name for name, _normalized in result.all() if name]


async def list_calls_from_mirror(
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

    records = [
        map_call_listing_row(
            call,
            eval_count=eval_map.get(call.activity_id).eval_count if eval_map.get(call.activity_id) else 0,
            eval_result=eval_map.get(call.activity_id).latest_result if eval_map.get(call.activity_id) else None,
        )
        for call in calls
    ]
    resolved_page_size = total if scope == "all" and total > 0 else page_size
    return ResolvedDatasetPage(
        records=records,
        total=total,
        page=1 if scope == "all" else page,
        page_size=resolved_page_size,
    )


async def list_leads_from_mirror(
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


async def get_collection_freshness(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    source_family: str,
) -> dict[str, Any]:
    latest_successful = await db.scalar(
        select(InsideSalesSyncRun)
        .where(
            InsideSalesSyncRun.tenant_id == tenant_id,
            InsideSalesSyncRun.app_id == app_id,
            InsideSalesSyncRun.source_family == source_family,
            InsideSalesSyncRun.status == "completed",
        )
        .order_by(InsideSalesSyncRun.completed_at.desc(), InsideSalesSyncRun.created_at.desc())
        .limit(1)
    )
    pending_jobs = await db.execute(
        select(Job.id, Job.params)
        .where(
            Job.tenant_id == tenant_id,
            Job.app_id == app_id,
            Job.job_type == "sync-external-source",
            Job.status.in_(("queued", "running", "retryable_failed")),
        )
        .order_by(Job.created_at.desc())
        .limit(20)
    )
    sync_in_progress = any(
        (params or {}).get("source_family") == source_family
        for _job_id, params in pending_jobs.all()
    )
    last_synced_at = latest_successful.completed_at if latest_successful else None
    stale = last_synced_at is None or (_utc_now() - last_synced_at > INSIDE_SALES_STALE_AFTER)
    return {
        "lastSyncedAt": last_synced_at,
        "syncInProgress": sync_in_progress,
        "stale": stale,
    }
