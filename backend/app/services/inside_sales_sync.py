"""Background sync services for Inside Sales source data."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

_log = logging.getLogger(__name__)

from app.models.analytics_lead_facts import (
    DimLead,
    FactLeadActivity,
    FactLeadStageTransition,
)
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
from app.services.analytics.mirror_to_fact_mapper import MirrorToFactMapper
from app.services.analytics import mirror_to_fact_sync

SyncMode = Literal["full", "incremental", "date_range", "targeted"]
SourceFamily = Literal["calls", "leads", "activities"]

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
    if source_family not in {"calls", "leads", "activities"}:
        raise ValueError("source_family must be one of: calls, leads, activities")
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
    if request.sync_mode == "targeted" and request.source_family == "activities":
        # Activities path has no point-fetch helper today; we still need
        # a window to page LSQ ProspectActivities, then filter to the
        # requested ProspectActivityId server-side-by-ID isn't available.
        if not request.date_from or not request.date_to:
            raise ValueError("targeted activities sync requires both date_from and date_to")

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
        # ``normalize_activity`` still emits LSQ-native key names (LSQ's
        # payload uses ``Prospect_id`` / ``AgentId`` / etc); the column
        # names here are post-Phase-1 canonical (``lead_id`` / ``rep_*``).
        "lead_id": record.get("prospectId", ""),
        "rep_id": record.get("agentId") or None,
        "rep_name": record.get("agentName") or None,
        "rep_email": record.get("agentEmail") or None,
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
                "leadId": record.get("prospectId"),
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
        "lead_id": record["prospectId"],
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
        "rep_name": record["agentName"] or None,
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
        "lead_id": stmt.excluded.lead_id,
        "rep_id": stmt.excluded.rep_id,
        "rep_name": stmt.excluded.rep_name,
        "rep_email": stmt.excluded.rep_email,
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
        "rep_name": stmt.excluded.rep_name,
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
                CrmLeadRecord.lead_id,
            ],
            set_=update_columns,
            where=CrmLeadRecord.source_record_hash.is_distinct_from(
                stmt.excluded.source_record_hash
            ),
        )
    )
    return len(rows)


# ── Analytics side-effects (Roadmap 01 §8) ────────────────────────────
#
# These helpers run **inside the same transaction** as the Layer 1
# (``analytics.crm_*_record``) upserts so a partial failure rolls back
# both the source mirror and the analytics fact / dim writes. None of
# them open a new session or commit on their own — they take the
# already-bound ``AsyncSession`` from ``run_inside_sales_source_sync``.


_LSQ_INBOUND_CALL_EVENT_CODE = 21
_LSQ_OUTBOUND_CALL_EVENT_CODE = 22


def _activity_subtype_for_event_code(event_code: int | None) -> str | None:
    """Map LSQ ``ActivityEvent`` numeric codes to canonical subtypes.

    Used by both the calls path (where the code is implied by the
    inbound/outbound endpoint) and the activities path (where it comes
    from the raw payload).
    """
    if event_code == _LSQ_INBOUND_CALL_EVENT_CODE:
        return "inbound_call"
    if event_code == _LSQ_OUTBOUND_CALL_EVENT_CODE:
        return "outbound_call"
    return None


async def _upsert_dim_lead_rows(
    db: AsyncSession,
    *,
    rows: list[dict[str, Any]],
    cycle_start: datetime,
) -> None:
    """SCD-1 upsert into ``analytics.dim_lead`` from leads-sync rows.

    ``ON CONFLICT (tenant_id, app_id, lead_id)`` refreshes
    ``latest_stage_observed`` / ``_at`` and ``updated_at`` only.
    ``first_seen_at`` and ``attributes_at_first_seen`` are insert-only.
    """
    if not rows:
        return
    payload = []
    for row in rows:
        lead_id = row.get("lead_id") or ""
        if not lead_id:
            continue
        payload.append(
            {
                "id": uuid.uuid4(),
                "tenant_id": row["tenant_id"],
                "app_id": row["app_id"],
                "lead_id": lead_id,
                "source": row.get("source_system") or LSQ_SOURCE_SYSTEM,
                "source_ref": lead_id,
                "lsq_created_on": row.get("created_on"),
                "first_seen_at": cycle_start,
                "latest_stage_observed": (row.get("prospect_stage") or None),
                "latest_stage_observed_at": cycle_start,
                "assigned_rep_label": row.get("rep_name") or None,
                "attributes_at_first_seen": {},
            }
        )
    if not payload:
        return
    stmt = pg_insert(DimLead).values(payload)
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[DimLead.tenant_id, DimLead.app_id, DimLead.lead_id],
            set_={
                "latest_stage_observed": stmt.excluded.latest_stage_observed,
                "latest_stage_observed_at": stmt.excluded.latest_stage_observed_at,
                "assigned_rep_label": stmt.excluded.assigned_rep_label,
                "updated_at": func.now(),
            },
        )
    )


async def _append_lead_stage_transitions(
    db: AsyncSession,
    *,
    rows: list[dict[str, Any]],
    cycle_start: datetime,
    sync_run_id: uuid.UUID | None,
) -> int:
    """Append fact_lead_stage_transition rows for leads whose stage changed.

    Reads the latest existing ``to_stage`` for each (tenant, app, lead)
    via a single window-function CTE to avoid N+1, then inserts only
    rows whose current stage differs (or, for first observation, where
    no row exists and the current stage is non-null).

    Returns the number of inserted rows.
    """
    if not rows:
        return 0

    # Build a one-shot keyed map of (tenant_id, app_id, lead_id) ->
    # latest known to_stage. Use Python instead of a correlated subquery
    # so the writeback insert can be a single bulk statement.
    keys: list[tuple[Any, str, str]] = []
    for row in rows:
        lead_id = row.get("lead_id") or ""
        if not lead_id:
            continue
        keys.append((row["tenant_id"], row["app_id"], lead_id))
    if not keys:
        return 0

    from sqlalchemy import tuple_

    latest_stmt = (
        select(
            FactLeadStageTransition.tenant_id,
            FactLeadStageTransition.app_id,
            FactLeadStageTransition.lead_id,
            FactLeadStageTransition.to_stage,
            FactLeadStageTransition.detected_at,
        )
        .where(
            tuple_(
                FactLeadStageTransition.tenant_id,
                FactLeadStageTransition.app_id,
                FactLeadStageTransition.lead_id,
            ).in_(keys)
        )
        .order_by(
            FactLeadStageTransition.tenant_id,
            FactLeadStageTransition.app_id,
            FactLeadStageTransition.lead_id,
            FactLeadStageTransition.detected_at.desc(),
        )
    )
    seen: dict[tuple[Any, str, str], str | None] = {}
    for r in (await db.execute(latest_stmt)).all():
        key = (r.tenant_id, r.app_id, r.lead_id)
        # Keep only the first (latest) row per key thanks to the ORDER BY.
        if key not in seen:
            seen[key] = r.to_stage

    payload: list[dict[str, Any]] = []
    for row in rows:
        lead_id = row.get("lead_id") or ""
        current_stage = (row.get("prospect_stage") or "").strip() or None
        if not lead_id:
            continue
        key = (row["tenant_id"], row["app_id"], lead_id)
        prior = seen.get(key)
        if prior is None:
            # First observation only emits a row when the current stage
            # is meaningful — avoids polluting the fact with empty rows
            # for leads that have never had a stage set.
            if current_stage is None:
                continue
            from_stage: str | None = None
        else:
            if current_stage == prior or current_stage is None:
                continue
            from_stage = prior
        payload.append(
            {
                "id": uuid.uuid4(),
                "tenant_id": row["tenant_id"],
                "app_id": row["app_id"],
                "lead_id": lead_id,
                "from_stage": from_stage,
                "to_stage": current_stage,
                "detected_at": cycle_start,
                "transition_at": None,
                "sync_run_id": sync_run_id,
                "attributes": {},
            }
        )
    if not payload:
        return 0
    # ON CONFLICT DO NOTHING against the partial unique index added in
    # Alembic 0041 (Phase 6). The read-before-write loop above is the
    # primary idempotency mechanism; this clause is defense in depth for
    # the narrow race where two cycles for the same (tenant, app) start
    # with sub-microsecond-identical ``cycle_start`` values, or where a
    # worker retries after a partial-fail commit. Without it, the second
    # writer would raise ``IntegrityError`` on the unique key; with it,
    # the duplicate is silently skipped and the steady-state sync stays
    # green. ``index_where`` matches the partial predicate so Postgres
    # picks the right index.
    stmt = pg_insert(FactLeadStageTransition).values(payload)
    stmt = stmt.on_conflict_do_nothing(
        index_elements=[
            FactLeadStageTransition.tenant_id,
            FactLeadStageTransition.app_id,
            FactLeadStageTransition.lead_id,
            FactLeadStageTransition.detected_at,
        ],
        index_where=text("sync_run_id IS NOT NULL"),
    )
    await db.execute(stmt)
    return len(payload)


async def _upsert_lead_activity_rows(
    db: AsyncSession,
    *,
    rows: list[dict[str, Any]],
) -> int:
    """Bulk upsert into ``analytics.fact_lead_activity``.

    Idempotent on ``(tenant_id, app_id, source_activity_id)`` via
    ``ON CONFLICT DO NOTHING``. Returns the number of payload rows
    submitted (not the post-conflict insert count, which is opaque
    under DO NOTHING).
    """
    if not rows:
        return 0
    stmt = pg_insert(FactLeadActivity).values(rows)
    # Phase 1 widened the conflict key to include ``activity_type`` so
    # multiple CRM activity types can reuse the same fact table without
    # colliding on ``source_activity_id`` namespaces.
    await db.execute(
        stmt.on_conflict_do_nothing(
            index_elements=[
                FactLeadActivity.tenant_id,
                FactLeadActivity.app_id,
                FactLeadActivity.source_activity_id,
                FactLeadActivity.activity_type,
            ]
        )
    )
    return len(rows)


def build_call_activity_fact_row(
    raw_activity: dict[str, Any],
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    sync_run_id: uuid.UUID | None,
) -> dict[str, Any] | None:
    """Build one ``analytics.fact_lead_activity`` row from a raw call activity.

    Returns ``None`` when the activity has no usable
    ``ProspectActivityId`` or no ``RelatedProspectId`` (cannot satisfy
    the unique constraint or the lead-scoped indexes).
    """
    record = normalize_activity(raw_activity)
    activity_id = record.get("activityId") or ""
    lead_id = record.get("prospectId") or ""
    if not activity_id or not lead_id:
        return None
    event_code_raw = record.get("eventCode")
    event_code = int(event_code_raw) if event_code_raw not in (None, "") else None
    occurred_at = (
        _parse_lsq_datetime(record.get("callStartTime"))
        or _parse_lsq_datetime(record.get("createdOn"))
    )
    if occurred_at is None:
        return None
    actor_id = record.get("agentId") or None
    actor_label = record.get("agentName") or None
    return {
        "id": uuid.uuid4(),
        "tenant_id": tenant_id,
        "app_id": app_id,
        "lead_id": lead_id,
        "source_activity_id": activity_id,
        "activity_type": "call",
        "activity_subtype": _activity_subtype_for_event_code(event_code),
        "source_event_code": event_code,
        "occurred_at": occurred_at,
        # ``actor_type='rep'`` per plan §1.1.13 — ``rep`` for human reps,
        # ``agent`` is reserved for AI agents elsewhere in the platform.
        "actor_type": "rep" if (actor_id or actor_label) else None,
        "actor_id": actor_id,
        "actor_label": actor_label,
        "attributes": {
            "direction": record.get("direction") or None,
            "status": record.get("status") or None,
            "duration_seconds": int(record.get("durationSeconds") or 0),
            "phone_number": record.get("phoneNumber") or None,
            # Per the Phase 7 manifest contract: ``rep_email`` lives in
            # attributes (not universal across activity types). The
            # human-readable name is captured structurally on
            # ``actor_label`` above and not duplicated here.
            "rep_email": record.get("agentEmail") or None,
            "recording_url": record.get("recordingUrl") or None,
        },
        "sync_run_id": sync_run_id,
    }


def build_generic_activity_fact_row(
    raw_activity: dict[str, Any],
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    sync_run_id: uuid.UUID | None,
) -> dict[str, Any] | None:
    """Build one ``analytics.fact_lead_activity`` row from a non-call LSQ ProspectActivity.

    Used by the ``source_family='activities'`` path. ``activity_type``
    defaults to ``'custom'`` for any non-call event code; the original
    LSQ event code lives in ``source_event_code`` so downstream queries
    can recover the LSQ event semantics. Returns ``None`` when the
    payload lacks the IDs needed to satisfy the unique key.
    """
    activity_id = (
        raw_activity.get("ProspectActivityId")
        or raw_activity.get("Id")
        or ""
    )
    lead_id = raw_activity.get("RelatedProspectId") or ""
    if not activity_id or not lead_id:
        return None
    event_code_raw = raw_activity.get("ActivityEvent")
    event_code = int(event_code_raw) if event_code_raw not in (None, "") else None
    occurred_at = _parse_lsq_datetime(raw_activity.get("CreatedOn"))
    if occurred_at is None:
        return None
    actor_id = raw_activity.get("CreatedBy") or None
    activity_event_name = (
        raw_activity.get("ActivityEvent_Name")
        or raw_activity.get("ActivityEventName")
        or None
    )
    return {
        "id": uuid.uuid4(),
        "tenant_id": tenant_id,
        "app_id": app_id,
        "lead_id": lead_id,
        "source_activity_id": activity_id,
        "activity_type": "custom",
        "activity_subtype": activity_event_name,
        "source_event_code": event_code,
        "occurred_at": occurred_at,
        # Generic non-call activities still flag the actor as a human rep;
        # AI-agent activities never come through this path.
        "actor_type": "rep" if actor_id else None,
        "actor_id": actor_id,
        "actor_label": None,
        "attributes": {
            "activity_event_name": activity_event_name,
            "raw_status": raw_activity.get("Status") or None,
        },
        "sync_run_id": sync_run_id,
    }


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

        # Track the raw activities that make it past targeted filtering
        # so the analytics side-effect mirrors EXACTLY the same set as
        # the Layer 1 upsert. Building the fact-row loop from the full
        # ``activities`` page would leak rows for non-targeted calls
        # into ``analytics.fact_lead_activity``.
        accepted_activities: list[dict[str, Any]] = []
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
            accepted_activities.append(raw_activity)

        # Plan §1.1.5/§5.1: lock-order discipline. Sort by (app_id, activity_id)
        # before mirror/fact upserts so concurrent retries acquire row locks in
        # the same order and don't deadlock.
        rows.sort(key=lambda r: (r["app_id"], r["activity_id"]))
        accepted_activities.sort(
            key=lambda a: (
                request.app_id,
                (normalize_activity(a).get("activityId") or ""),
            )
        )

        counters.upserted += await upsert_call_source_rows(db, rows)

        # Project the SAME accepted call activities into
        # ``analytics.fact_lead_activity`` (``activity_type='call'``)
        # inside the same DB transaction via the declarative
        # ``MirrorToFactMapper`` (`crm_call_record__call.yaml`). If the
        # operator has disabled the mapping in ``analytics.mapping_state``
        # we proceed mirror-only and log a structured breadcrumb. On
        # projection/upsert failure the whole sync transaction rolls back
        # and the failure counter advances (threshold-3 writes
        # ``log_fact_population_run.status='blocking_sync'``).
        mapping = MirrorToFactMapper.default().for_table(
            INSIDE_SALES_APP_ID,
            "analytics.crm_call_record",
            "call",
        )
        if not await mapping.enabled(db):
            await mirror_to_fact_sync.record_mirror_only_mode(
                mapping, tenant_id=tenant_id
            )
        else:
            try:
                await mirror_to_fact_sync.project_and_upsert_facts(
                    db,
                    mapping=mapping,
                    mirror_rows=rows,
                    sync_run_id=sync_run.id,
                )
            except Exception as exc:
                # The log write happens in a separate session and could
                # itself fail (DB connection blip). Surface the original
                # projection error regardless — `raise exc` (not bare
                # `raise`) re-throws the root cause even if the inner
                # except triggered.
                try:
                    await mirror_to_fact_sync.record_mapping_failure(
                        mapping, error=exc, tenant_id=tenant_id
                    )
                except Exception:
                    _log.exception(
                        "failed to write mapping failure log; "
                        "surfacing original projection error instead"
                    )
                raise exc
            await mirror_to_fact_sync.record_mapping_success(mapping)

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

        # Side-effect (Roadmap 01 §8.1): refresh the SCD-1 dim_lead row
        # and append a stage-transition fact when the stage changed.
        # Same transaction; partial failure rolls all three writes back.
        cycle_start = _utc_now()
        await _upsert_dim_lead_rows(db, rows=[row], cycle_start=cycle_start)
        await _append_lead_stage_transitions(
            db, rows=[row], cycle_start=cycle_start, sync_run_id=sync_run.id
        )

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

        # Side-effect (Roadmap 01 §8.1): refresh dim_lead pointers and
        # append stage transitions in the same transaction.
        cycle_start = synced_at
        await _upsert_dim_lead_rows(db, rows=rows, cycle_start=cycle_start)
        await _append_lead_stage_transitions(
            db, rows=rows, cycle_start=cycle_start, sync_run_id=sync_run.id
        )

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


async def _sync_activities_family(
    db: AsyncSession,
    *,
    job_id,
    sync_run: LogCrmSourceSync,
    request: InsideSalesSyncRequest,
    tenant_id: uuid.UUID,
    watermark_from: str | None,
    watermark_to: str | None,
) -> dict[str, Any]:
    """Pull non-call LSQ ProspectActivities and write fact_lead_activity rows.

    Roadmap 01 §8.3. Allowlist comes from ``request.event_codes``;
    operators MUST set this consciously via the scheduler workload
    ``params`` — the call codes 21 / 22 are forbidden because they are
    already captured by the calls path. No Layer 1 mirror write — this
    path lives only in ``analytics.fact_lead_activity``.
    """
    from app.services.job_worker import JobCancelledError, is_job_cancelled, update_job_progress

    if not request.event_codes:
        raise ValueError(
            "activities sync requires an explicit event_codes allowlist "
            "(workload params); call codes 21/22 belong to the calls path"
        )
    forbidden = {
        _LSQ_INBOUND_CALL_EVENT_CODE,
        _LSQ_OUTBOUND_CALL_EVENT_CODE,
    } & set(request.event_codes)
    if forbidden:
        raise ValueError(
            "activities sync event_codes must not include call codes "
            f"{sorted(forbidden)} — those belong to source_family='calls'"
        )

    if request.sync_mode in {"full", "date_range"}:
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

        # ``fetch_call_activities`` is a generic ProspectActivity fetch
        # despite the legacy name — it accepts any ``event_codes`` list.
        response = await fetch_call_activities(
            date_from=date_from,
            date_to=date_to,
            event_codes=list(request.event_codes),
            page=page,
            page_size=CALLS_PAGE_SIZE,
        )
        activities = response.get("activities", [])
        if not activities:
            break

        pages_processed += 1
        counters.scanned += len(activities)
        rows: list[dict[str, Any]] = []
        for raw_activity in activities:
            # Targeted activities sync narrows the page to one
            # ProspectActivityId. LSQ has no point-fetch for activities,
            # so we still page the window but only persist the match.
            if request.sync_mode == "targeted":
                activity_id = (
                    raw_activity.get("ProspectActivityId")
                    or raw_activity.get("Id")
                    or ""
                )
                if activity_id != request.targeted_source_id:
                    continue
                found_target = True
            try:
                built = build_generic_activity_fact_row(
                    raw_activity,
                    tenant_id=tenant_id,
                    app_id=request.app_id,
                    sync_run_id=sync_run.id,
                )
            except Exception:
                counters.failed += 1
                continue
            if built is None:
                counters.failed += 1
                continue
            rows.append(built)

        counters.upserted += await _upsert_lead_activity_rows(db, rows=rows)
        sync_run.details = dict(sync_run.details or {}, pagesProcessed=pages_processed)
        await _save_sync_run_progress(sync_run=sync_run, counters=counters, page_count=pages_processed)
        await update_job_progress(
            job_id,
            pages_processed,
            max(pages_processed, 1),
            f"Synced {counters.upserted} activity rows across {pages_processed} page(s)",
            sync_run_id=str(sync_run.id),
            source_family=request.source_family,
        )

        total_available = int(response.get("total") or 0)
        capacity = CALLS_PAGE_SIZE * len(request.event_codes)
        if total_available <= page * capacity:
            break
        if request.sync_mode == "targeted" and found_target:
            break
        page += 1

    if request.sync_mode == "targeted" and not found_target:
        raise ValueError(
            f"Activity not found for targeted_source_id={request.targeted_source_id}"
        )

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
                elif request.source_family in {"calls", "activities"}:
                    # Activities reuse the calls-path overlap default —
                    # both share LSQ's ProspectActivity surface, so the
                    # same late-mutation guard applies.
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
                elif request.source_family == "activities":
                    result = await _sync_activities_family(
                        db,
                        job_id=job_id,
                        sync_run=sync_run,
                        request=request,
                        tenant_id=tenant_id,
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
