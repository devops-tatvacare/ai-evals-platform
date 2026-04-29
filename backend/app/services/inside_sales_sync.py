"""Background sync services for Inside Sales source data."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

_log = logging.getLogger(__name__)

from app.models.source_records import (
    CrmCallRecord,
    CrmLeadRecord,
    LogCrmSourceSync,
)
from app.services.lsq_client import (
    compute_lead_metrics,
    compute_mql_score,
    fetch_call_activities,
    fetch_lead_by_id,
    fetch_leads,
    normalize_activity,
    normalize_lead,
)

SyncMode = Literal["full", "incremental", "date_range", "targeted"]
SourceFamily = Literal["calls", "leads"]

# Single source of truth for the Inside Sales ETL surface. Other modules
# (schedule seed, source resolver, routes) import these instead of
# re-declaring string literals.
INSIDE_SALES_APP_ID = "inside-sales"
LSQ_SOURCE_SYSTEM = "lsq"
# Call activity types we mirror: 21 = inbound telephony, 22 = outbound.
INSIDE_SALES_CALL_EVENT_CODES: tuple[int, ...] = (21, 22)

CALLS_PAGE_SIZE = 100
LEADS_PAGE_SIZE = 100


def _event_codes_csv(codes: tuple[int, ...]) -> str:
    """Comma-separated form used by LSQ job params and the refresh API body."""
    return ",".join(str(code) for code in codes)


def _async_session_factory():
    from app.database import async_session

    return async_session()


@dataclass(frozen=True)
class InsideSalesSyncRequest:
    app_id: str
    source_family: SourceFamily
    sync_mode: SyncMode
    source_system: str
    date_from: str | None = None
    date_to: str | None = None
    targeted_source_id: str | None = None
    event_codes: tuple[int, ...] | None = None
    overlap_minutes: int | None = None


# Safety cap to prevent watermark regressions from accidental operator input.
_OVERLAP_MINUTES_CAP = 360
# Per-family defaults, applied only to incremental syncs when the request
# does not pass an explicit overlap. Calls need 60 min because LSQ's
# activity filter is CreatedOn-only and late mutations (status flip,
# recording URL arrival) of up to ~45 min have been observed in the
# production probe. Leads are authoritative on ModifiedOn, so a small
# overlap only guards against page drift / clock skew.
DEFAULT_CALL_OVERLAP_MINUTES = 60
DEFAULT_LEAD_OVERLAP_MINUTES = 10


@dataclass
class SyncCounters:
    scanned: int = 0
    upserted: int = 0
    failed: int = 0


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_lsq_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value.split(".")[0], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(value).astimezone(timezone.utc)
    except ValueError:
        return None


def _to_watermark(value: str | None) -> str | None:
    parsed = _parse_lsq_datetime(value)
    return parsed.isoformat() if parsed else None


def _format_sync_datetime(value: str | None) -> str | None:
    parsed = _parse_lsq_datetime(value)
    if not parsed:
        return None
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def _stable_payload_hash(raw_payload: dict[str, Any]) -> str:
    encoded = json.dumps(raw_payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _parse_event_codes(value: Any) -> tuple[int, ...] | None:
    if value is None:
        return None
    if isinstance(value, str):
        parsed = tuple(int(part.strip()) for part in value.split(",") if part.strip())
        return parsed or None
    if isinstance(value, (list, tuple)):
        parsed = tuple(int(part) for part in value)
        return parsed or None
    raise ValueError("event_codes must be a comma-separated string or list of integers")


def _parse_overlap_minutes(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("overlap_minutes must be an integer") from exc
    if parsed < 0:
        raise ValueError("overlap_minutes must be non-negative")
    if parsed > _OVERLAP_MINUTES_CAP:
        raise ValueError(
            f"overlap_minutes cannot exceed {_OVERLAP_MINUTES_CAP} (6 hours)"
        )
    return parsed


def parse_inside_sales_sync_request(params: dict[str, Any]) -> InsideSalesSyncRequest:
    app_id = str(params.get("app_id") or "").strip()
    source_family = str(params.get("source_family") or "").strip().lower()
    sync_mode = str(params.get("sync_mode") or "incremental").strip().lower()
    source_system = str(params.get("source_system") or LSQ_SOURCE_SYSTEM).strip().lower()
    targeted_source_id = str(params.get("targeted_source_id") or "").strip() or None

    if app_id != INSIDE_SALES_APP_ID:
        raise ValueError(f"app_id must be {INSIDE_SALES_APP_ID!r}")
    if source_family not in {"calls", "leads"}:
        raise ValueError("source_family must be one of: calls, leads")
    if sync_mode not in {"full", "incremental", "date_range", "targeted"}:
        raise ValueError("sync_mode must be one of: full, incremental, date_range, targeted")
    if source_system != LSQ_SOURCE_SYSTEM:
        raise ValueError(f"source_system must be {LSQ_SOURCE_SYSTEM!r}")

    request = InsideSalesSyncRequest(
        app_id=app_id,
        source_family=source_family,  # type: ignore[arg-type]
        sync_mode=sync_mode,  # type: ignore[arg-type]
        source_system=source_system,
        date_from=str(params.get("date_from") or "").strip() or None,
        date_to=str(params.get("date_to") or "").strip() or None,
        targeted_source_id=targeted_source_id,
        event_codes=_parse_event_codes(params.get("event_codes")),
        overlap_minutes=_parse_overlap_minutes(params.get("overlap_minutes")),
    )

    if request.sync_mode in {"full", "date_range"}:
        if not request.date_from or not request.date_to:
            raise ValueError(f"{request.sync_mode} sync requires both date_from and date_to")
    if request.sync_mode == "targeted" and not request.targeted_source_id:
        raise ValueError("targeted sync requires targeted_source_id")
    if request.sync_mode == "targeted" and request.source_family == "calls":
        if not request.date_from or not request.date_to:
            raise ValueError("targeted call sync requires both date_from and date_to")

    return request


# Phase 1 bootstrap default: the 90-day backfill is the permanent
# starting dataset, not a rolling hot window.
BOOTSTRAP_BACKFILL_DAYS = 90


def _default_event_codes_for(source_family: SourceFamily) -> str | None:
    """Return the default event-codes CSV for a family, or None if the
    family doesn't use them. Leads never carry event codes."""
    if source_family == "calls":
        return _event_codes_csv(INSIDE_SALES_CALL_EVENT_CODES)
    return None


def build_incremental_refresh_job_params(
    *,
    source_family: SourceFamily,
    event_codes: str | None = None,
    overlap_minutes: int | None = None,
) -> dict[str, Any]:
    """Canonical shape for an on-demand incremental delta job."""
    params: dict[str, Any] = {
        "app_id": INSIDE_SALES_APP_ID,
        "source_family": source_family,
        "source_system": LSQ_SOURCE_SYSTEM,
        "sync_mode": "incremental",
    }
    resolved_codes = event_codes if event_codes is not None else _default_event_codes_for(source_family)
    if resolved_codes:
        params["event_codes"] = resolved_codes
    if overlap_minutes is not None:
        params["overlap_minutes"] = overlap_minutes
    return params


def build_date_range_refresh_job_params(
    *,
    source_family: SourceFamily,
    date_from: str,
    date_to: str,
    event_codes: str | None = None,
) -> dict[str, Any]:
    """Canonical shape for an explicit window (bootstrap or ad-hoc range)."""
    if not date_from or not date_to:
        raise ValueError("date_range sync requires both date_from and date_to")
    params: dict[str, Any] = {
        "app_id": INSIDE_SALES_APP_ID,
        "source_family": source_family,
        "source_system": LSQ_SOURCE_SYSTEM,
        "sync_mode": "date_range",
        "date_from": date_from,
        "date_to": date_to,
    }
    resolved_codes = event_codes if event_codes is not None else _default_event_codes_for(source_family)
    if resolved_codes:
        params["event_codes"] = resolved_codes
    return params


def build_bootstrap_backfill_job_params(
    *,
    source_family: SourceFamily,
    now: datetime | None = None,
    days: int = BOOTSTRAP_BACKFILL_DAYS,
    event_codes: str | None = None,
) -> dict[str, Any]:
    """Return the ``date_range`` payload for a one-shot Phase 1 backfill."""
    if days <= 0:
        raise ValueError("days must be positive")
    current = now or _utc_now()
    return build_date_range_refresh_job_params(
        source_family=source_family,
        date_from=(current - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S"),
        date_to=current.strftime("%Y-%m-%d %H:%M:%S"),
        event_codes=event_codes,
    )


# Back-compat shim for existing callers / tests. Prefer the explicit
# builders above for new code.
def build_manual_refresh_job_params(
    *,
    source_family: SourceFamily,
    has_successful_sync: bool,
    date_from: str | None,
    date_to: str | None,
    event_codes: str | None = None,
) -> dict[str, Any]:
    if has_successful_sync:
        return build_incremental_refresh_job_params(
            source_family=source_family,
            event_codes=event_codes,
        )
    if not date_from or not date_to:
        raise ValueError("date_from and date_to are required before first successful sync")
    return build_date_range_refresh_job_params(
        source_family=source_family,
        date_from=date_from,
        date_to=date_to,
        event_codes=event_codes,
    )


async def get_latest_successful_sync_run(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    source_family: SourceFamily,
) -> LogCrmSourceSync | None:
    return await db.scalar(
        select(LogCrmSourceSync)
        .where(
            LogCrmSourceSync.tenant_id == tenant_id,
            LogCrmSourceSync.app_id == app_id,
            LogCrmSourceSync.source_family == source_family,
            LogCrmSourceSync.status == "completed",
        )
        .order_by(
            LogCrmSourceSync.completed_at.desc(),
            LogCrmSourceSync.created_at.desc(),
        )
        .limit(1)
    )


def _resolve_incremental_window(
    request: InsideSalesSyncRequest,
    latest_successful: LogCrmSourceSync | None,
    *,
    overlap_minutes: int = 0,
) -> tuple[str, str]:
    latest_watermark = latest_successful.watermark_to if latest_successful else None
    date_from = _format_sync_datetime(request.date_from) or _format_sync_datetime(latest_watermark)
    if not date_from:
        raise ValueError("incremental sync requires date_from or an existing successful watermark")

    if overlap_minutes:
        parsed_from = _parse_lsq_datetime(date_from)
        if parsed_from is not None:
            date_from = (parsed_from - timedelta(minutes=overlap_minutes)).strftime(
                "%Y-%m-%d %H:%M:%S"
            )

    date_to = _format_sync_datetime(request.date_to) or _utc_now().strftime("%Y-%m-%d %H:%M:%S")
    return date_from, date_to


def build_call_source_row(
    raw_activity: dict[str, Any],
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    source_system: str,
    synced_at: datetime,
) -> dict[str, Any]:
    record = normalize_activity(raw_activity)

    return {
        "tenant_id": tenant_id,
        "app_id": app_id,
        "source_system": source_system,
        "activity_id": record.get("activityId", ""),
        "prospect_id": record.get("prospectId", ""),
        "agent_id": record.get("agentId") or None,
        "agent_name": record.get("agentName") or None,
        "agent_email": record.get("agentEmail") or None,
        "event_code": int(record.get("eventCode") or 0),
        "direction": record.get("direction") or "",
        "status": record.get("status") or None,
        "call_started_at": _parse_lsq_datetime(record.get("callStartTime")),
        "duration_seconds": int(record.get("durationSeconds") or 0),
        "has_recording": bool(record.get("recordingUrl")),
        "recording_url": record.get("recordingUrl") or None,
        "phone_number": record.get("phoneNumber") or None,
        "display_number": record.get("displayNumber") or None,
        "call_notes": record.get("callNotes") or None,
        "call_session_id": record.get("callSessionId") or None,
        # Prefer the call-start timestamp (mx_Custom_2); fall back to record
        # creation time so `created_on` is never null for date-range filters.
        "created_on": (
            _parse_lsq_datetime(record.get("callStartTime"))
            or _parse_lsq_datetime(record.get("createdOn"))
        ),
        "source_record_hash": _stable_payload_hash(raw_activity),
        "first_synced_at": synced_at,
        "last_synced_at": synced_at,
        "last_seen_in_source_at": synced_at,
        "last_synced_by_user_id": user_id,
        "raw_payload": raw_activity,
    }


def build_lead_source_row(
    raw_lead: dict[str, Any],
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    source_system: str,
    synced_at: datetime,
) -> dict[str, Any] | None:
    record = normalize_lead(raw_lead)
    # Prefer CreatedOn; fall back to ModifiedOn so `created_on` is populated
    # for date-range filters. If both are missing, skip the row (the caller
    # counts the skip) and emit a structured warning so ops can spot leads
    # whose LSQ payload lacks both timestamps.
    created_on_value = (
        _parse_lsq_datetime(record["createdOn"])
        or _parse_lsq_datetime(raw_lead.get("ModifiedOn"))
    )
    if created_on_value is None:
        _log.warning(
            "inside_sales.sync.lead_skipped_missing_timestamp",
            extra={
                "tenantId": str(tenant_id),
                "appId": app_id,
                "prospectId": record.get("prospectId"),
            },
        )
        return None

    mql_score, mql_signals = compute_mql_score(raw_lead)
    metrics = compute_lead_metrics(
        created_on=record["createdOn"],
        last_activity_on=record["lastActivityOn"],
        rnr_count=record["rnrCount"],
        answered_count=record["answeredCount"],
        first_activity_on=record["firstActivityOn"],
    )
    frt_seconds = metrics["frt_seconds"]
    if frt_seconds is not None and frt_seconds < 60:
        frt_seconds = None

    return {
        "tenant_id": tenant_id,
        "app_id": app_id,
        "source_system": source_system,
        "prospect_id": record["prospectId"],
        "first_name": record["firstName"] or None,
        "last_name": record["lastName"] or None,
        "phone": record["phone"] or None,
        "email": record["email"] or None,
        "prospect_stage": record["prospectStage"],
        "plan_name": (record.get("planName") or "").strip() or None,
        "city": record["city"] or None,
        "age_group": record["ageGroup"] or None,
        "condition": record["condition"] or None,
        "hba1c_band": record["hba1cBand"] or None,
        "intent_to_pay": record["intentToPay"] or None,
        "agent_name": record["agentName"] or None,
        "source": record["source"] or None,
        "source_campaign": record["sourceCampaign"] or None,
        "created_on": created_on_value,
        "first_activity_on": _parse_lsq_datetime(record["firstActivityOn"]),
        "last_activity_on": _parse_lsq_datetime(record["lastActivityOn"]),
        "rnr_count": record["rnrCount"],
        "answered_count": record["answeredCount"],
        "total_dials": metrics["total_dials"],
        "connect_rate": metrics["connect_rate"],
        "frt_seconds": frt_seconds,
        "lead_age_days": metrics["lead_age_days"],
        "days_since_last_contact": metrics["days_since_last_contact"],
        "mql_score": mql_score,
        "mql_signals": mql_signals,
        "source_record_hash": _stable_payload_hash(raw_lead),
        "first_synced_at": synced_at,
        "last_synced_at": synced_at,
        "last_seen_in_source_at": synced_at,
        "last_synced_by_user_id": user_id,
        "raw_payload": raw_lead,
    }


async def upsert_call_source_rows(db: AsyncSession, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0

    stmt = pg_insert(CrmCallRecord).values(rows)
    update_columns = {
        "prospect_id": stmt.excluded.prospect_id,
        "agent_id": stmt.excluded.agent_id,
        "agent_name": stmt.excluded.agent_name,
        "agent_email": stmt.excluded.agent_email,
        "event_code": stmt.excluded.event_code,
        "direction": stmt.excluded.direction,
        "status": stmt.excluded.status,
        "call_started_at": stmt.excluded.call_started_at,
        "duration_seconds": stmt.excluded.duration_seconds,
        "has_recording": stmt.excluded.has_recording,
        "recording_url": stmt.excluded.recording_url,
        "phone_number": stmt.excluded.phone_number,
        "display_number": stmt.excluded.display_number,
        "call_notes": stmt.excluded.call_notes,
        "call_session_id": stmt.excluded.call_session_id,
        "created_on": stmt.excluded.created_on,
        "source_record_hash": stmt.excluded.source_record_hash,
        "last_synced_at": stmt.excluded.last_synced_at,
        "last_seen_in_source_at": stmt.excluded.last_seen_in_source_at,
        "last_synced_by_user_id": stmt.excluded.last_synced_by_user_id,
        "raw_payload": stmt.excluded.raw_payload,
        "updated_at": func.now(),
    }
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[
                CrmCallRecord.tenant_id,
                CrmCallRecord.app_id,
                CrmCallRecord.activity_id,
            ],
            set_=update_columns,
            where=CrmCallRecord.source_record_hash.is_distinct_from(
                stmt.excluded.source_record_hash
            ),
        )
    )
    return len(rows)


async def upsert_lead_source_rows(db: AsyncSession, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0

    stmt = pg_insert(CrmLeadRecord).values(rows)
    update_columns = {
        "first_name": stmt.excluded.first_name,
        "last_name": stmt.excluded.last_name,
        "phone": stmt.excluded.phone,
        "email": stmt.excluded.email,
        "prospect_stage": stmt.excluded.prospect_stage,
        "plan_name": stmt.excluded.plan_name,
        "city": stmt.excluded.city,
        "age_group": stmt.excluded.age_group,
        "condition": stmt.excluded.condition,
        "hba1c_band": stmt.excluded.hba1c_band,
        "intent_to_pay": stmt.excluded.intent_to_pay,
        "agent_name": stmt.excluded.agent_name,
        "source": stmt.excluded.source,
        "source_campaign": stmt.excluded.source_campaign,
        "created_on": stmt.excluded.created_on,
        "first_activity_on": stmt.excluded.first_activity_on,
        "last_activity_on": stmt.excluded.last_activity_on,
        "rnr_count": stmt.excluded.rnr_count,
        "answered_count": stmt.excluded.answered_count,
        "total_dials": stmt.excluded.total_dials,
        "connect_rate": stmt.excluded.connect_rate,
        "frt_seconds": stmt.excluded.frt_seconds,
        "lead_age_days": stmt.excluded.lead_age_days,
        "days_since_last_contact": stmt.excluded.days_since_last_contact,
        "mql_score": stmt.excluded.mql_score,
        "mql_signals": stmt.excluded.mql_signals,
        "source_record_hash": stmt.excluded.source_record_hash,
        "last_synced_at": stmt.excluded.last_synced_at,
        "last_seen_in_source_at": stmt.excluded.last_seen_in_source_at,
        "last_synced_by_user_id": stmt.excluded.last_synced_by_user_id,
        "raw_payload": stmt.excluded.raw_payload,
        "updated_at": func.now(),
    }
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[
                CrmLeadRecord.tenant_id,
                CrmLeadRecord.app_id,
                CrmLeadRecord.prospect_id,
            ],
            set_=update_columns,
            where=CrmLeadRecord.source_record_hash.is_distinct_from(
                stmt.excluded.source_record_hash
            ),
        )
    )
    return len(rows)


def _build_sync_run(
    *,
    request: InsideSalesSyncRequest,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    watermark_from: str | None,
    watermark_to: str | None,
    job_id: uuid.UUID | None,
    is_scheduled_run: bool,
) -> LogCrmSourceSync:
    return LogCrmSourceSync(
        tenant_id=tenant_id,
        app_id=request.app_id,
        source_system=request.source_system,
        source_family=request.source_family,
        sync_mode=request.sync_mode,
        status="running",
        requested_by_user_id=user_id,
        targeted_source_id=request.targeted_source_id,
        watermark_from=watermark_from,
        watermark_to=watermark_to,
        started_at=_utc_now(),
        details={
            "jobType": "sync-external-source",
            "sourceFamily": request.source_family,
            "syncMode": request.sync_mode,
        },
        job_id=job_id,
        is_scheduled_run=is_scheduled_run,
    )


async def _save_sync_run_progress(
    *,
    sync_run: LogCrmSourceSync,
    counters: SyncCounters,
    page_count: int,
    extra_details: dict[str, Any] | None = None,
) -> None:
    """Mutate attached ``sync_run`` in-place. Flush happens on tx commit."""
    sync_run.records_scanned = counters.scanned
    sync_run.records_upserted = counters.upserted
    sync_run.records_failed = counters.failed
    details = dict(sync_run.details or {})
    details.update({"pagesProcessed": page_count})
    if extra_details:
        details.update(extra_details)
    sync_run.details = details


async def _complete_sync_run(
    db: AsyncSession,
    *,
    sync_run: LogCrmSourceSync,
    counters: SyncCounters,
    extra_details: dict[str, Any] | None = None,
) -> None:
    _ = db
    sync_run.status = "completed"
    sync_run.completed_at = _utc_now()
    await _save_sync_run_progress(
        sync_run=sync_run,
        counters=counters,
        page_count=int((sync_run.details or {}).get("pagesProcessed", 0)),
        extra_details=extra_details,
    )


async def _fail_sync_run(
    db: AsyncSession,
    *,
    sync_run: LogCrmSourceSync,
    counters: SyncCounters,
    error_message: str,
    extra_details: dict[str, Any] | None = None,
) -> None:
    _ = db
    sync_run.status = "failed"
    sync_run.error_message = error_message
    sync_run.completed_at = _utc_now()
    await _save_sync_run_progress(
        sync_run=sync_run,
        counters=counters,
        page_count=int((sync_run.details or {}).get("pagesProcessed", 0)),
        extra_details=extra_details,
    )


async def _sync_calls_family(
    db: AsyncSession,
    *,
    job_id,
    sync_run: LogCrmSourceSync,
    request: InsideSalesSyncRequest,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    watermark_from: str | None,
    watermark_to: str | None,
) -> dict[str, Any]:
    from app.services.job_worker import JobCancelledError, is_job_cancelled, update_job_progress

    if request.sync_mode == "targeted":
        date_from = request.date_from
        date_to = request.date_to
    elif request.sync_mode in {"full", "date_range"}:
        date_from = request.date_from
        date_to = request.date_to
    else:
        date_from = watermark_from
        date_to = watermark_to

    assert date_from is not None and date_to is not None

    counters = SyncCounters()
    page = 1
    pages_processed = 0
    found_target = False

    while True:
        if await is_job_cancelled(job_id, tenant_id=tenant_id):
            raise JobCancelledError("Sync job cancelled")

        response = await fetch_call_activities(
            date_from=date_from,
            date_to=date_to,
            event_codes=list(request.event_codes) if request.event_codes else None,
            page=page,
            page_size=CALLS_PAGE_SIZE,
        )
        activities = response.get("activities", [])
        if not activities:
            break

        pages_processed += 1
        counters.scanned += len(activities)
        synced_at = _utc_now()
        rows: list[dict[str, Any]] = []

        for raw_activity in activities:
            try:
                row = build_call_source_row(
                    raw_activity,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    app_id=request.app_id,
                    source_system=request.source_system,
                    synced_at=synced_at,
                )
            except Exception:
                counters.failed += 1
                continue

            if request.sync_mode == "targeted":
                if row["activity_id"] != request.targeted_source_id:
                    continue
                found_target = True
            rows.append(row)

        counters.upserted += await upsert_call_source_rows(db, rows)
        sync_run.details = dict(sync_run.details or {}, pagesProcessed=pages_processed)
        await _save_sync_run_progress(sync_run=sync_run, counters=counters, page_count=pages_processed)
        await update_job_progress(
            job_id,
            pages_processed,
            max(pages_processed, 1),
            f"Synced {counters.upserted} call rows across {pages_processed} page(s)",
            sync_run_id=str(sync_run.id),
            source_family=request.source_family,
        )

        total_available = int(response.get("total") or 0)
        capacity = CALLS_PAGE_SIZE * len(request.event_codes or (21, 22))
        if total_available <= page * capacity:
            break
        if request.sync_mode == "targeted" and found_target:
            break
        page += 1

    if request.sync_mode == "targeted" and not found_target:
        raise ValueError(f"Call activity not found for targeted_source_id={request.targeted_source_id}")

    return {
        "records_scanned": counters.scanned,
        "records_upserted": counters.upserted,
        "records_failed": counters.failed,
        "pages_processed": pages_processed,
    }


async def _sync_leads_family(
    db: AsyncSession,
    *,
    job_id,
    sync_run: LogCrmSourceSync,
    request: InsideSalesSyncRequest,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    watermark_from: str | None,
    watermark_to: str | None,
) -> dict[str, Any]:
    from app.services.job_worker import JobCancelledError, is_job_cancelled, update_job_progress

    counters = SyncCounters()
    pages_processed = 0

    if request.sync_mode == "targeted":
        if await is_job_cancelled(job_id, tenant_id=tenant_id):
            raise JobCancelledError("Sync job cancelled")

        raw_lead = await fetch_lead_by_id(request.targeted_source_id or "")
        if not raw_lead:
            raise ValueError(f"Lead not found for targeted_source_id={request.targeted_source_id}")

        counters.scanned = 1
        row = build_lead_source_row(
            raw_lead,
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=request.app_id,
            source_system=request.source_system,
            synced_at=_utc_now(),
        )
        if row is None:
            raise ValueError(
                f"Targeted lead {request.targeted_source_id} has no CreatedOn or ModifiedOn timestamp"
            )
        counters.upserted = await upsert_lead_source_rows(db, [row])
        pages_processed = 1
        sync_run.details = dict(sync_run.details or {}, pagesProcessed=pages_processed)
        await _save_sync_run_progress(sync_run=sync_run, counters=counters, page_count=pages_processed)
        await update_job_progress(
            job_id,
            1,
            1,
            "Synced targeted lead row",
            sync_run_id=str(sync_run.id),
            source_family=request.source_family,
        )
        return {
            "records_scanned": counters.scanned,
            "records_upserted": counters.upserted,
            "records_failed": counters.failed,
            "pages_processed": pages_processed,
        }

    if request.sync_mode in {"full", "date_range"}:
        date_from = request.date_from
        date_to = request.date_to
    else:
        date_from = watermark_from
        date_to = watermark_to

    assert date_from is not None and date_to is not None

    # Incremental lead syncs follow LSQ's authoritative ``ModifiedOn``
    # delta so leads created before the window but updated inside it are
    # refreshed. Backfill / date_range seed passes stay on ``CreatedOn``.
    lead_filter_field: Literal["CreatedOn", "ModifiedOn"] = (
        "ModifiedOn" if request.sync_mode == "incremental" else "CreatedOn"
    )

    page = 1
    while True:
        if await is_job_cancelled(job_id, tenant_id=tenant_id):
            raise JobCancelledError("Sync job cancelled")

        response = await fetch_leads(
            date_from=date_from,
            date_to=date_to,
            filter_field=lead_filter_field,
            page=page,
            page_size=LEADS_PAGE_SIZE,
        )
        raw_leads = response.get("leads", [])
        if not raw_leads:
            break

        pages_processed += 1
        counters.scanned += len(raw_leads)
        synced_at = _utc_now()
        rows: list[dict[str, Any]] = []
        for raw_lead in raw_leads:
            try:
                row = build_lead_source_row(
                    raw_lead,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    app_id=request.app_id,
                    source_system=request.source_system,
                    synced_at=synced_at,
                )
            except Exception:
                counters.failed += 1
                continue
            if row is None:
                counters.failed += 1
                continue
            rows.append(row)

        counters.upserted += await upsert_lead_source_rows(db, rows)
        sync_run.details = dict(sync_run.details or {}, pagesProcessed=pages_processed)
        await _save_sync_run_progress(sync_run=sync_run, counters=counters, page_count=pages_processed)
        await update_job_progress(
            job_id,
            pages_processed,
            max(pages_processed, 1),
            f"Synced {counters.upserted} lead rows across {pages_processed} page(s)",
            sync_run_id=str(sync_run.id),
            source_family=request.source_family,
        )

        if not response.get("has_more"):
            break
        page += 1

    return {
        "records_scanned": counters.scanned,
        "records_upserted": counters.upserted,
        "records_failed": counters.failed,
        "pages_processed": pages_processed,
    }


async def run_inside_sales_source_sync(
    job_id,
    params: dict,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict:
    """Sync LeadSquared source records into Inside Sales source tables.

    Lifecycle is split into three isolated transactions on separate sessions:

      1. ``init``  — create the ``analytics.log_crm_source_sync`` row (status=running).
      2. ``work``  — fetch + upsert in one transaction, then mark completed.
      3. ``fail``  — on any exception, reopen a fresh session to mark failed.

    This avoids the SQLAlchemy 2.x "A transaction is already begun on this
    Session" error that can arise when autobegun SELECTs, explicit commits,
    and ``async with session.begin()`` are interleaved on the same session.

    ``params.is_scheduled_run`` is recorded as provenance on the
    ``analytics.log_crm_source_sync`` row but does not change retention behavior: the
    delta path never prunes and never forces a rolling hot window. The
    mirror accumulates indefinitely; archival is a separate policy.
    """
    request = parse_inside_sales_sync_request(params)
    is_scheduled_run = bool(params.get("is_scheduled_run"))
    job_uuid: uuid.UUID | None
    try:
        job_uuid = uuid.UUID(str(job_id)) if job_id is not None else None
    except (TypeError, ValueError):
        job_uuid = None

    async with _async_session_factory() as db:
        # Phase 1 — resolve window + persist the ``analytics.log_crm_source_sync`` row
        # inside an explicit transaction. Running the SELECT before
        # ``session.begin()`` would autobegin and then collide with the
        # explicit begin — exactly the bug the fake session in the unit
        # tests replicates.
        async with db.begin():
            latest_successful = await get_latest_successful_sync_run(
                db,
                tenant_id=tenant_id,
                app_id=request.app_id,
                source_family=request.source_family,
            )

            watermark_from: str | None = None
            watermark_to: str | None = None
            sync_date_from = _format_sync_datetime(request.date_from)
            sync_date_to = _format_sync_datetime(request.date_to)
            if request.sync_mode in {"full", "date_range", "targeted"}:
                watermark_from = _to_watermark(sync_date_from)
                watermark_to = _to_watermark(sync_date_to)
            elif request.sync_mode == "incremental":
                # Per-family overlap defaults protect against late-arriving
                # mutations (calls) and page-boundary drift (leads). An
                # explicit ``overlap_minutes`` in the request always wins.
                if request.overlap_minutes is not None:
                    overlap = request.overlap_minutes
                elif request.source_family == "calls":
                    overlap = DEFAULT_CALL_OVERLAP_MINUTES
                else:
                    overlap = DEFAULT_LEAD_OVERLAP_MINUTES
                resolved_date_from, resolved_date_to = _resolve_incremental_window(
                    request, latest_successful, overlap_minutes=overlap
                )
                watermark_from = _to_watermark(resolved_date_from)
                watermark_to = _to_watermark(resolved_date_to)
                sync_date_from = resolved_date_from
                sync_date_to = resolved_date_to

            sync_run = _build_sync_run(
                request=request,
                user_id=user_id,
                tenant_id=tenant_id,
                watermark_from=watermark_from,
                watermark_to=watermark_to,
                job_id=job_uuid,
                is_scheduled_run=is_scheduled_run,
            )
            db.add(sync_run)
            await db.flush()

        # Phase 2 — do the work inside a fresh ``begin()`` block. On success
        # the context manager commits; on exception it rolls back and we
        # drop into Phase 3 to mark the row as failed in yet another
        # fresh ``begin()`` block.
        result: dict[str, Any]
        try:
            async with db.begin():
                if request.source_family == "calls":
                    result = await _sync_calls_family(
                        db,
                        job_id=job_id,
                        sync_run=sync_run,
                        request=request,
                        tenant_id=tenant_id,
                        user_id=user_id,
                        watermark_from=sync_date_from,
                        watermark_to=sync_date_to,
                    )
                else:
                    result = await _sync_leads_family(
                        db,
                        job_id=job_id,
                        sync_run=sync_run,
                        request=request,
                        tenant_id=tenant_id,
                        user_id=user_id,
                        watermark_from=sync_date_from,
                        watermark_to=sync_date_to,
                    )

                counters = SyncCounters(
                    scanned=int(result["records_scanned"]),
                    upserted=int(result["records_upserted"]),
                    failed=int(result["records_failed"]),
                )

                extra_details: dict[str, Any] = {"pagesProcessed": result["pages_processed"]}

                await _complete_sync_run(
                    db,
                    sync_run=sync_run,
                    counters=counters,
                    extra_details=extra_details,
                )
        except Exception as exc:
            # Phase 3 — mark failed on the same session, fresh begin().
            try:
                async with db.begin():
                    counters = SyncCounters(
                        scanned=sync_run.records_scanned,
                        upserted=sync_run.records_upserted,
                        failed=sync_run.records_failed,
                    )
                    await _fail_sync_run(
                        db,
                        sync_run=sync_run,
                        counters=counters,
                        error_message=str(exc) or f"{type(exc).__name__}: sync failed",
                    )
            except Exception as fail_exc:
                _log.error(
                    "inside_sales.sync.fail_marker_failed",
                    extra={
                        "syncRunId": str(sync_run.id) if sync_run is not None else None,
                        "jobId": str(job_id) if job_id is not None else None,
                        "primaryError": str(exc),
                        "markerError": str(fail_exc),
                    },
                )
            raise

    return {
        "sync_run_id": str(sync_run.id),
        "app_id": request.app_id,
        "source_system": request.source_system,
        "source_family": request.source_family,
        "sync_mode": request.sync_mode,
        "watermark_from": sync_run.watermark_from,
        "watermark_to": sync_run.watermark_to,
        "is_scheduled_run": is_scheduled_run,
        **result,
    }
