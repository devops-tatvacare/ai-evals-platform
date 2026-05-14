"""Inside Sales routes.

Live LeadSquared calls are confined to the sync jobs (see
``app.services.inside_sales_sync``). Every route here reads from the
``analytics.crm_lead_record`` / ``analytics.crm_call_record`` mirror and never reaches
out to LSQ at request time. Operators control freshness via the scheduled
``sync-external-source`` job cadence.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.app_scope import require_fixed_app_access
from app.auth.context import AuthContext
from app.auth.permissions import ensure_permissions
from app.database import get_db
from app.models.job import BackgroundJob
from app.schemas.inside_sales import (
    CallListResponse,
    CallRecord,
    CollectionFreshness,
    CollectionRefreshRequest,
    CollectionRefreshResponse,
    CollectionRunEntry,
    CollectionRunsResponse,
    CollectionSyncStatus,
    LeadCallRecord,
    LeadDetailFullResponse,
    LeadDetailResponse,
    LeadEvalHistoryEntry,
    LeadListRecord,
    LeadListResponse,
    LeadPlanPurchase,
)
from app.services.inside_sales_dataset_resolver import (
    CallDatasetScope,
    InsideSalesCallFilters,
    InsideSalesLeadFilters,
)
from typing import cast
from app.services.inside_sales_eval_linkage import (
    fetch_latest_eval_overlays,
    list_eval_history_entries,
)
from app.services.inside_sales_queries import (
    get_collection_freshness,
    get_collection_sync_status,
    get_lead_record,
    list_call_history_for_lead,
    list_calls_from_source,
    list_collection_suggestions,
    list_leads_from_source,
    map_lead_call_history_entry,
)
from app.services.inside_sales_sync import (
    INSIDE_SALES_APP_ID,
    build_bootstrap_backfill_job_params,
    build_date_range_refresh_job_params,
    build_incremental_refresh_job_params,
)
from app.models.source_records import LogCrmSourceSync
from app.services.crm_workspace_pii import mask_crm_pii
from app.services.job_worker import get_job_submission_metadata
from app.services.lsq_client import (
    MAX_LEAD_CALL_HISTORY,
    compute_drilldown_metrics,
    extract_lead_plan_fields,
    normalize_lead,
)

router = APIRouter(prefix="/api/inside-sales", tags=["inside-sales"])


def _parse_csv_query(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())


def _validate_source_family(source_family: str) -> str:
    family = source_family.strip().lower()
    if family not in {"calls", "leads"}:
        raise HTTPException(status_code=404, detail="Collection not found")
    return family


@router.get("/calls", response_model=CallListResponse)
async def list_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    scope: str = Query("page", pattern="^(page|all)$"),
    agents: str | None = Query(None, description="Comma-separated rep names"),
    lead_id: str | None = Query(None, description="Comma-separated lead IDs; each is substring-matched"),
    direction: str | None = Query(None),
    status: str | None = Query(None),
    duration_min: int | None = Query(None, description="Min call duration in seconds (inclusive)"),
    duration_max: int | None = Query(None, description="Max call duration in seconds (inclusive)"),
    has_recording: bool | None = Query(None, description="If true, only calls with a recording URL"),
    event_codes: str | None = Query(None, description="Comma-separated event codes"),
    # Deprecated alias — accepted for the duration of the Phase 1→9 soak so
    # legacy clients keep working. Removed in Phase 9.
    prospect_id: str | None = Query(None, include_in_schema=False),
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Serving endpoint for the calls collection.

    scope=page is the interactive listing contract. scope=all is a temporary
    bridge for canonical selection workflows and should not define the long-term
    serving boundary.
    """
    call_page = await list_calls_from_source(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id="inside-sales",
        filters=InsideSalesCallFilters(
            agents=_parse_csv_query(agents),
            lead_ids=_parse_csv_query(lead_id or prospect_id),
            direction=direction,
            status=status,
            duration_min=duration_min,
            duration_max=duration_max,
            has_recording=has_recording,
            event_codes=tuple(int(code) for code in _parse_csv_query(event_codes)) or None,
        ),
        page=page,
        page_size=page_size,
        scope=cast(CallDatasetScope, scope),
    )
    freshness = await get_collection_freshness(
        db,
        tenant_id=auth.tenant_id,
        app_id="inside-sales",
        source_family="calls",
    )

    masked_calls = await mask_crm_pii(
        call_page.records,
        table_name="fact_lead_activity",
        auth=auth,
        db=db,
        app_id="inside-sales",
    )
    return CallListResponse(
        calls=[CallRecord(**call) for call in masked_calls],
        total=call_page.total,
        page=call_page.page,
        page_size=call_page.page_size,
        freshness=CollectionFreshness.model_validate(freshness),
    )


@router.get("/leads/{lead_id}", response_model=LeadDetailResponse)
async def get_lead(
    lead_id: str,
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Supplemental lead-card lookup served from the synced mirror.

    Returns the small profile card (name, phone, email) used as a hover/header
    helper on call-detail surfaces. Reads from ``analytics.crm_lead_record`` only;
    freshness is governed by the scheduled ``sync-external-source`` job.
    """
    record = await get_lead_record(
        db,
        tenant_id=auth.tenant_id,
        app_id=INSIDE_SALES_APP_ID,
        lead_id=lead_id,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Lead not found")

    [masked] = await mask_crm_pii(
        [{
            "leadId": record.lead_id,
            "firstName": record.first_name,
            "lastName": record.last_name,
            "phone": record.phone,
            "email": record.email,
        }],
        table_name="dim_lead",
        auth=auth,
        db=db,
        app_id="inside-sales",
    )
    return LeadDetailResponse(
        lead_id=masked["leadId"],
        first_name=masked["firstName"],
        last_name=masked["lastName"],
        phone=masked["phone"],
        email=masked["email"],
    )


@router.get("/leads", response_model=LeadListResponse)
async def list_leads(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    agents: str | None = Query(None, description="Comma-separated rep names"),
    stage: str | None = Query(None, description="Comma-separated stage values"),
    mql_min: int | None = Query(None, ge=0, le=5, description="Minimum MQL score"),
    condition: str | None = Query(None, description="Comma-separated condition values"),
    city: str | None = Query(None, description="Comma-separated cities; each is substring-matched"),
    lead_id: str | None = Query(None, description="Comma-separated lead IDs; each is substring-matched"),
    phone: str | None = Query(None, description="Comma-separated mobiles; digits-only compare per value"),
    plan_name: str | None = Query(None, description="Comma-separated plan names; each is substring-matched"),
    q: str | None = Query(None, description="Substring search across first name, last name, phone"),
    # Deprecated alias kept for the soak window — removed in Phase 9.
    prospect_id: str | None = Query(None, include_in_schema=False),
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Serving endpoint for the leads collection."""
    lead_page = await list_leads_from_source(
        db,
        tenant_id=auth.tenant_id,
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(
            agents=_parse_csv_query(agents),
            stage=_parse_csv_query(stage),
            mql_min=mql_min,
            condition=_parse_csv_query(condition),
            city=_parse_csv_query(city),
            lead_ids=_parse_csv_query(lead_id or prospect_id),
            phones=_parse_csv_query(phone),
            plan_names=_parse_csv_query(plan_name),
            q=q,
        ),
        page=page,
        page_size=page_size,
    )
    freshness = await get_collection_freshness(
        db,
        tenant_id=auth.tenant_id,
        app_id="inside-sales",
        source_family="leads",
    )

    masked_leads = await mask_crm_pii(
        lead_page.records,
        table_name="dim_lead",
        auth=auth,
        db=db,
        app_id="inside-sales",
    )
    return LeadListResponse(
        leads=[LeadListRecord(**lead) for lead in masked_leads],
        total=lead_page.total,
        page=lead_page.page,
        page_size=lead_page.page_size,
        freshness=CollectionFreshness.model_validate(freshness),
    )


@router.post("/collections/{source_family}/refresh", response_model=CollectionRefreshResponse, status_code=202)
async def refresh_collection(
    source_family: str,
    body: CollectionRefreshRequest,
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Explicit refresh trigger for synced source collections.

    Supported ``sync_mode`` values (case-insensitive, default
    ``incremental``):

      * ``incremental`` — one-shot delta on top of the last successful
        watermark. Leads use LSQ ``ModifiedOn``, calls apply the 60-min
        overlap default. This is the normal "run delta now" button.
      * ``date_range`` — explicit ``dateFrom`` / ``dateTo`` bootstrap
        run. Required for the first-ever sync and for ad-hoc window
        backfills.
      * ``bootstrap`` — sugar for the canonical 90-day ``date_range``
        seed (calls + leads) described in the LSQ ETL plan.

    Neither mode prunes older rows; retention is "accumulate
    indefinitely for now" per the plan.
    """
    family = _validate_source_family(source_family)
    sync_mode = (body.sync_mode or "incremental").strip().lower()
    if sync_mode not in {"incremental", "date_range", "bootstrap"}:
        raise HTTPException(
            status_code=400,
            detail=(
                "sync_mode must be one of: incremental, date_range, bootstrap"
            ),
        )
    if sync_mode in {"date_range", "bootstrap"}:
        ensure_permissions(auth, "schedule:manage")

    try:
        if sync_mode == "bootstrap":
            job_params = build_bootstrap_backfill_job_params(
                source_family=family,  # type: ignore[arg-type]
                event_codes=body.event_codes,
            )
        elif sync_mode == "date_range":
            if not body.date_from or not body.date_to:
                raise HTTPException(
                    status_code=400,
                    detail="date_range sync requires dateFrom and dateTo",
                )
            job_params = build_date_range_refresh_job_params(
                source_family=family,  # type: ignore[arg-type]
                date_from=body.date_from,
                date_to=body.date_to,
                event_codes=body.event_codes,
            )
        else:
            job_params = build_incremental_refresh_job_params(
                source_family=family,  # type: ignore[arg-type]
                event_codes=body.event_codes,
                overlap_minutes=body.overlap_minutes,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    metadata = get_job_submission_metadata("sync-external-source", job_params)
    normalized_params = {
        **job_params,
        "tenant_id": str(auth.tenant_id),
        "user_id": str(auth.user_id),
        "app_id": str(metadata["app_id"]),
        # On-demand refresh is never marked as scheduled. Scheduler-fired
        # jobs carry ``is_scheduled_run=True`` as provenance only — the
        # delta path no longer branches on it.
        "is_scheduled_run": False,
    }
    job = BackgroundJob(
        app_id=str(metadata["app_id"]),
        job_type="sync-external-source",
        status="queued",
        priority=int(metadata["priority"]),
        queue_class=str(metadata["queue_class"]),
        max_attempts=int(metadata["max_attempts"]),
        progress={"current": 0, "total": 0, "message": "Refresh queued"},
        params=normalized_params,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return CollectionRefreshResponse(
        job_id=str(job.id),
        source_family=family,
        sync_mode=str(normalized_params["sync_mode"]),
        status=job.status,
    )


@router.get("/collections/{source_family}/suggestions")
async def get_collection_suggestions(
    source_family: str,
    field: str = Query(..., description="Column to pull distinct values from"),
    q: str = Query("", description="Optional substring filter on the values"),
    limit: int = Query(20, ge=1, le=50),
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Type-ahead suggestions for filter inputs.

    Reads distinct values of ``field`` from the synced DB mirror, scoped to
    ``tenant_id`` / ``app_id`` / ``source_family``. Never hits LSQ. The
    ``field`` argument is whitelisted in ``list_collection_suggestions`` —
    it cannot be steered to read arbitrary columns. The same raw column the
    listing query matches against is read here, so dropdown values map
    1:1 to filter behaviour.
    """
    family = _validate_source_family(source_family)
    try:
        values = await list_collection_suggestions(
            db,
            tenant_id=auth.tenant_id,
            app_id="inside-sales",
            source_family=family,
            field=field,
            query=q,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"values": values}


@router.get("/collections/{source_family}/status", response_model=CollectionSyncStatus)
async def get_collection_status(
    source_family: str,
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Durable freshness signal for the collection.

    Read from ``analytics.log_crm_source_sync`` so the UI can render correct state after a
    page reload, independent of whatever ephemeral state the frontend store
    happens to hold. Returns last success, last attempt (any status), and
    whether a sync is currently running.
    """
    family = _validate_source_family(source_family)
    status = await get_collection_sync_status(
        db,
        tenant_id=auth.tenant_id,
        app_id="inside-sales",
        source_family=family,
    )
    return CollectionSyncStatus(**status)


@router.get("/collections/{source_family}/runs", response_model=CollectionRunsResponse)
async def list_collection_runs(
    source_family: str,
    limit: int = Query(10, ge=1, le=50),
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Return the most recent ``analytics.log_crm_source_sync`` rows for ops use.

    Ops reads this to reconcile scheduled-run history, spot repeated
    failures, and trigger re-runs. Scoped to tenant + inside-sales.
    """
    family = _validate_source_family(source_family)
    stmt = (
        select(LogCrmSourceSync)
        .where(
            LogCrmSourceSync.tenant_id == auth.tenant_id,
            LogCrmSourceSync.app_id == INSIDE_SALES_APP_ID,
            LogCrmSourceSync.source_family == family,
        )
        .order_by(LogCrmSourceSync.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return CollectionRunsResponse(
        source_family=family,
        runs=[
            CollectionRunEntry(
                id=str(row.id),
                sync_mode=row.sync_mode,
                status=row.status,
                started_at=row.started_at,
                completed_at=row.completed_at,
                watermark_from=row.watermark_from,
                watermark_to=row.watermark_to,
                records_scanned=row.records_scanned,
                records_upserted=row.records_upserted,
                records_failed=row.records_failed,
                is_scheduled_run=row.is_scheduled_run,
                error_message=row.error_message,
            )
            for row in rows
        ],
    )


@router.get("/leads/{lead_id}/detail", response_model=LeadDetailFullResponse)
async def get_lead_detail(
    lead_id: str,
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Lead drilldown: profile, call history, and eval history.

    Assembled from ``analytics.crm_lead_record`` (profile + stored MQL columns +
    cached LSQ ``raw_payload`` for fields not promoted to columns) and
    ``analytics.crm_call_record`` (per-prospect call history, capped at
    ``MAX_LEAD_CALL_HISTORY``). Eval overlay/history come from local
    ``evaluation_run_thread_results``. No LSQ round trips happen at request time —
    freshness is governed entirely by the scheduled sync job.
    """
    record = await get_lead_record(
        db,
        tenant_id=auth.tenant_id,
        app_id=INSIDE_SALES_APP_ID,
        lead_id=lead_id,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not record.raw_payload:
        # Sync writes ``raw_payload`` for every row; a missing payload means
        # this row predates that contract. Surface it instead of silently
        # returning a half-empty drilldown — operator should re-sync.
        raise HTTPException(
            status_code=503,
            detail="Lead row is missing its source payload. Trigger a sync to populate it.",
        )

    raw = record.raw_payload
    lead = normalize_lead(raw)

    call_rows, history_truncated = await list_call_history_for_lead(
        db,
        tenant_id=auth.tenant_id,
        app_id=INSIDE_SALES_APP_ID,
        lead_id=lead_id,
        limit=MAX_LEAD_CALL_HISTORY,
    )
    call_history_raw = [map_lead_call_history_entry(call) for call in call_rows]

    activity_ids = [c["activityId"] for c in call_history_raw]
    eval_overlay_map = await fetch_latest_eval_overlays(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=INSIDE_SALES_APP_ID,
        thread_ids=activity_ids,
    )
    for c in call_history_raw:
        overlay = eval_overlay_map.get(c["activityId"])
        if overlay is not None:
            c["evalScore"] = overlay.latest_score

    eval_history_list = [
        LeadEvalHistoryEntry(**entry)
        for entry in await list_eval_history_entries(
            db,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            app_id=INSIDE_SALES_APP_ID,
            thread_ids=activity_ids,
        )
    ]

    drilldown_metrics = compute_drilldown_metrics(
        created_on=lead["createdOn"],
        last_activity_on=lead["lastActivityOn"],
        call_history=call_history_raw,
        preferred_call_time_str=lead.get("preferredCallTime"),
    )

    call_history_records = [
        LeadCallRecord(
            activity_id=c["activityId"],
            call_time=c["callTime"],
            rep_name=c["repName"],
            duration_seconds=c["durationSeconds"],
            status=c["status"],
            recording_url=c["recordingUrl"],
            eval_score=c["evalScore"],
            is_counseling=c["isCounseling"],
        )
        for c in call_history_raw
    ]

    return LeadDetailFullResponse(
        lead_id=record.lead_id,
        first_name=record.first_name,
        last_name=record.last_name,
        phone=record.phone,
        email=record.email,
        # Post-Phase-9: typed domain cols are gone from crm_lead_record.
        # Every domain field is now sourced from ``record.bag`` (raw_payload)
        # or computed at response time. PII (first_name, last_name, phone,
        # email, city) and source identity (lead_id, source_system) stay
        # as typed columns.
        prospect_stage=record.bag.get("prospect_stage") or "",
        city=record.city,
        age_group=record.bag.get("age_group"),
        condition=record.bag.get("condition"),
        hba1c_band=record.bag.get("hba1c_band"),
        # Fields below are not promoted to dedicated columns — read them
        # from the cached LSQ payload via ``normalize_lead``.
        blood_sugar_band=lead["bloodSugarBand"],
        diabetes_duration=lead["diabetesDuration"],
        current_management=lead["currentManagement"],
        goal=lead["goal"],
        intent_to_pay=record.bag.get("intent_to_pay"),
        job_title=lead["jobTitle"],
        preferred_call_time=lead["preferredCallTime"],
        rep_name=record.bag.get("rep_name"),
        source=record.bag.get("source"),
        source_campaign=record.bag.get("source_campaign"),
        created_on=lead["createdOn"],
        mql_score=int(record.bag.get("mql_score") or 0),
        mql_signals=record.bag.get("mql_signals") or {},
        frt_seconds=drilldown_metrics["frt_seconds"],
        total_dials=drilldown_metrics["total_dials"],
        connect_rate=drilldown_metrics["connect_rate"],
        counseling_count=drilldown_metrics["counseling_count"],
        counseling_rate=drilldown_metrics["counseling_rate"],
        callback_adherence_seconds=drilldown_metrics["callback_adherence_seconds"],
        lead_age_days=drilldown_metrics["lead_age_days"],
        days_since_last_contact=drilldown_metrics["days_since_last_contact"],
        call_history=call_history_records,
        history_truncated=history_truncated,
        eval_history=eval_history_list,
        plan=LeadPlanPurchase.model_validate(extract_lead_plan_fields(raw)),
    )
