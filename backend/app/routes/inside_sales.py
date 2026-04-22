"""Inside Sales routes.

Collection-serving semantics are formalized in
``app.services.inside_sales_serving_contract`` so the serving source can change
without silently changing route responsibilities.
"""

import math
import uuid as _uuid
from datetime import datetime as _dt, timezone as _tz

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.auth.app_scope import require_fixed_app_access
from app.auth.context import AuthContext
from app.database import get_db
from app.models.job import Job
from app.schemas.inside_sales import (
    AgentListResponse,
    CallListResponse,
    CallRecord,
    CollectionRefreshRequest,
    CollectionRefreshResponse,
    LeadCallRecord,
    LeadDetailFullResponse,
    LeadDetailResponse,
    LeadEvalHistoryEntry,
    LeadListRecord,
    LeadListResponse,
)
from app.services.inside_sales_boundary import (
    find_or_enqueue_ondemand_sync,
    is_inside_hot_window,
    validate_ondemand_window,
)
from app.services.inside_sales_dataset_resolver import (
    InsideSalesCallFilters,
    InsideSalesLeadFilters,
)
from app.services.inside_sales_eval_linkage import (
    fetch_latest_eval_overlays,
    list_eval_history_entries,
)
from app.services.inside_sales_queries import (
    get_collection_freshness,
    list_call_agent_names_from_source,
    list_calls_from_source,
    list_leads_from_source,
)
from app.services.inside_sales_sync import build_manual_refresh_job_params, get_latest_successful_sync_run
from app.services.job_worker import get_job_submission_metadata
from app.services.lsq_client import (
    LsqRateLimitError,
    LsqRequestError,
    normalize_activity,
    fetch_lead_by_id,
    fetch_lead_activities_for_prospect,
    normalize_lead,
    compute_mql_score,
    compute_drilldown_metrics,
)

router = APIRouter(prefix="/api/inside-sales", tags=["inside-sales"])


def _parse_csv_query(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())


def _translate_lsq_error(exc: LsqRequestError) -> HTTPException:
    if isinstance(exc, LsqRateLimitError):
        headers = None
        if exc.retry_after_seconds is not None:
            headers = {"Retry-After": str(max(1, math.ceil(exc.retry_after_seconds)))}
        return HTTPException(
            status_code=503,
            detail="LeadSquared rate limit reached. Please retry shortly.",
            headers=headers,
        )

    return HTTPException(
        status_code=502,
        detail="LeadSquared request failed.",
    )


def _validate_source_family(source_family: str) -> str:
    family = source_family.strip().lower()
    if family not in {"calls", "leads"}:
        raise HTTPException(status_code=404, detail="Collection not found")
    return family


@router.get("/agents", response_model=AgentListResponse)
async def list_agents(
    date_from: str = Query(..., description="Start date YYYY-MM-DD HH:MM:SS"),
    date_to: str = Query(..., description="End date YYYY-MM-DD HH:MM:SS"),
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Serving helper endpoint for date-scoped call filter options."""
    return AgentListResponse(
        agents=await list_call_agent_names_from_source(
            db,
            tenant_id=auth.tenant_id,
            app_id="inside-sales",
            date_from=date_from,
            date_to=date_to,
        ),
    )


@router.get("/calls", response_model=CallListResponse)
async def list_calls(
    date_from: str = Query(..., description="Start date YYYY-MM-DD HH:MM:SS"),
    date_to: str = Query(..., description="End date YYYY-MM-DD HH:MM:SS"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    scope: str = Query("page", pattern="^(page|all)$"),
    agents: str | None = Query(None, description="Comma-separated agent names"),
    prospect_id: str | None = Query(None, description="Prospect ID substring"),
    direction: str | None = Query(None),
    status: str | None = Query(None),
    duration_min: int | None = Query(None, description="Min call duration in seconds (inclusive)"),
    duration_max: int | None = Query(None, description="Max call duration in seconds (inclusive)"),
    has_recording: bool | None = Query(None, description="If true, only calls with a recording URL"),
    event_codes: str | None = Query(None, description="Comma-separated event codes"),
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
            date_from=date_from,
            date_to=date_to,
            agents=_parse_csv_query(agents),
            prospect_id=prospect_id,
            direction=direction,
            status=status,
            duration_min=duration_min,
            duration_max=duration_max,
            has_recording=has_recording,
            event_codes=tuple(int(code) for code in _parse_csv_query(event_codes)) or None,
        ),
        page=page,
        page_size=page_size,
        scope=scope,
    )
    freshness = await get_collection_freshness(
        db,
        tenant_id=auth.tenant_id,
        app_id="inside-sales",
        source_family="calls",
    )

    return CallListResponse(
        calls=[CallRecord(**call) for call in call_page.records],
        total=call_page.total,
        page=call_page.page,
        page_size=call_page.page_size,
        freshness=freshness,
    )


@router.get("/leads/{prospect_id}", response_model=LeadDetailResponse)
async def get_lead(
    prospect_id: str,
    refresh: bool = Query(False, description="Force re-fetch from LSQ"),
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Fetch a supplemental lead lookup by prospect ID. Cached in DB after first fetch.

    Pass ?refresh=true to force re-fetch from LSQ (resync button).
    """
    from app.models.lsq_call_cache import LsqLeadCache

    # Check DB cache first (unless refresh requested)
    if not refresh:
        result = await db.execute(
            select(LsqLeadCache).where(
                LsqLeadCache.tenant_id == auth.tenant_id,
                LsqLeadCache.prospect_id == prospect_id,
            )
        )
        cached = result.scalar_one_or_none()
        if cached:
            return LeadDetailResponse(
                prospect_id=prospect_id,
                first_name=cached.first_name,
                last_name=cached.last_name,
                phone=cached.phone,
                email=cached.email,
                cached=True,
            )

    # Fetch from LSQ
    try:
        lead = await fetch_lead_by_id(prospect_id)
    except LsqRequestError as exc:
        raise _translate_lsq_error(exc) from exc

    # Cache the result (upsert)
    try:
        stmt = pg_insert(LsqLeadCache).values(
            id=_uuid.uuid4(),
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            prospect_id=prospect_id,
            first_name=lead.get("FirstName", ""),
            last_name=lead.get("LastName", ""),
            phone=lead.get("Phone", ""),
            email=lead.get("EmailAddress", ""),
        ).on_conflict_do_update(
            constraint="uq_lsq_lead_cache_tenant_prospect",
            set_={
                "first_name": lead.get("FirstName", ""),
                "last_name": lead.get("LastName", ""),
                "phone": lead.get("Phone", ""),
                "email": lead.get("EmailAddress", ""),
            },
        )
        await db.execute(stmt)
        await db.commit()
    except Exception:
        await db.rollback()

    return LeadDetailResponse(
        prospect_id=prospect_id,
        first_name=lead.get("FirstName", ""),
        last_name=lead.get("LastName", ""),
        phone=lead.get("Phone", ""),
        email=lead.get("EmailAddress", ""),
        cached=False,
    )


@router.get("/leads", response_model=LeadListResponse)
async def list_leads(
    date_from: str = Query(..., description="Start date YYYY-MM-DD HH:MM:SS"),
    date_to: str = Query(..., description="End date YYYY-MM-DD HH:MM:SS"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    agents: str | None = Query(None, description="Comma-separated agent names"),
    stage: str | None = Query(None, description="Comma-separated stage values"),
    mql_min: int | None = Query(None, ge=0, le=5, description="Minimum MQL score"),
    condition: str | None = Query(None, description="Comma-separated condition values"),
    city: str | None = Query(None, description="City substring filter"),
    prospect_id: str | None = Query(None, description="Filter by exact prospect ID"),
    q: str | None = Query(None, description="Substring search across first name, last name, phone"),
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Serving endpoint for the leads collection."""
    lead_page = await list_leads_from_source(
        db,
        tenant_id=auth.tenant_id,
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(
            date_from=date_from,
            date_to=date_to,
            agents=_parse_csv_query(agents),
            stage=_parse_csv_query(stage),
            mql_min=mql_min,
            condition=_parse_csv_query(condition),
            city=_parse_csv_query(city),
            prospect_id=prospect_id,
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

    return LeadListResponse(
        leads=[LeadListRecord(**lead) for lead in lead_page.records],
        total=lead_page.total,
        page=lead_page.page,
        page_size=lead_page.page_size,
        freshness=freshness,
    )


@router.post("/collections/{source_family}/refresh", response_model=CollectionRefreshResponse, status_code=202)
async def refresh_collection(
    source_family: str,
    body: CollectionRefreshRequest,
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Explicit refresh trigger for synced source collections. Enqueues sync work only."""
    family = _validate_source_family(source_family)
    if body.date_from and body.date_to:
        now = _dt.now(_tz.utc)
        if not is_inside_hot_window(body.date_from, body.date_to, now):
            validate_ondemand_window(body.date_from, body.date_to, now)
            job = await find_or_enqueue_ondemand_sync(
                db,
                tenant_id=auth.tenant_id,
                app_id="inside-sales",
                source_family=family,
                date_from=body.date_from,
                date_to=body.date_to,
                user_id=auth.user_id,
                event_codes=body.event_codes,
            )
            await db.commit()
            await db.refresh(job)
            return CollectionRefreshResponse(
                job_id=str(job.id),
                source_family=family,
                sync_mode=str((job.params or {}).get("sync_mode") or "date_range"),
                status=job.status,
            )

    latest_successful = await get_latest_successful_sync_run(
        db,
        tenant_id=auth.tenant_id,
        app_id="inside-sales",
        source_family=family,  # type: ignore[arg-type]
    )
    try:
        job_params = build_manual_refresh_job_params(
            source_family=family,  # type: ignore[arg-type]
            has_successful_sync=latest_successful is not None,
            date_from=body.date_from,
            date_to=body.date_to,
            event_codes=body.event_codes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    metadata = get_job_submission_metadata("sync-external-source", job_params)
    normalized_params = {
        **job_params,
        "tenant_id": str(auth.tenant_id),
        "user_id": str(auth.user_id),
        "app_id": str(metadata["app_id"]),
        # On-demand refresh — never prune. Scheduled syncs set this to True
        # via the scheduler engine (§PR4).
        "is_scheduled_run": False,
    }
    job = Job(
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


@router.get("/coverage")
async def get_collection_coverage(
    source_family: str,
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Expose `[hot_from, hot_to]` + last scheduled sync timestamp per family.

    `hot_from` / `hot_to` are computed at request time (now-7d, now) — they
    are NOT read from DB. `lastScheduledSync*` is read from
    `source_sync_runs.is_scheduled_run = true` (persistent, not inferred from
    `jobs.params`).
    """
    from datetime import datetime as _dt, timezone as _tz

    from app.models.source_records import SourceSyncRun
    from app.services.inside_sales_boundary import hot_boundary

    family = _validate_source_family(source_family)
    now = _dt.now(_tz.utc)
    hot_from = hot_boundary(now)
    hot_to = now

    stmt = (
        select(SourceSyncRun)
        .where(
            SourceSyncRun.tenant_id == auth.tenant_id,
            SourceSyncRun.app_id == "inside-sales",
            SourceSyncRun.source_family == family,
            SourceSyncRun.is_scheduled_run.is_(True),
            SourceSyncRun.status == "completed",
        )
        .order_by(SourceSyncRun.completed_at.desc())
        .limit(1)
    )
    last = (await db.execute(stmt)).scalars().first()
    return {
        "hotFrom": hot_from.strftime("%Y-%m-%d %H:%M:%S"),
        "hotTo": hot_to.strftime("%Y-%m-%d %H:%M:%S"),
        "lastScheduledSyncAt": last.completed_at.isoformat() if last and last.completed_at else None,
        "lastScheduledSyncStatus": last.status if last else None,
    }


@router.get("/leads/{prospect_id}/detail", response_model=LeadDetailFullResponse)
async def get_lead_detail(
    prospect_id: str,
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Lead drilldown endpoint: profile, call history, and eval history."""
    # 1. Fetch full lead record
    try:
        raw = await fetch_lead_by_id(prospect_id)
    except LsqRequestError as exc:
        raise _translate_lsq_error(exc) from exc
    if not raw:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = normalize_lead(raw)
    mql_score, mql_signals = compute_mql_score(raw)

    # 2. Fetch call history for this prospect
    created_on = lead["createdOn"] or "2020-01-01 00:00:00"
    date_to_now = _dt.now(_tz.utc).strftime("%Y-%m-%d %H:%M:%S")
    try:
        raw_activities, history_truncated = await fetch_lead_activities_for_prospect(
            prospect_id=prospect_id,
            date_from=created_on,
            date_to=date_to_now,
        )
    except LsqRequestError as exc:
        raise _translate_lsq_error(exc) from exc

    # Normalize activities into LeadCallRecord format
    call_history_raw: list[dict] = []
    for a in raw_activities:
        norm = normalize_activity(a)
        call_history_raw.append({
            "activityId": norm["activityId"],
            "callTime": norm["callStartTime"],
            "agentName": norm["agentName"] or None,
            "durationSeconds": norm["durationSeconds"],
            "status": norm["status"],
            "recordingUrl": norm["recordingUrl"] or None,
            "evalScore": None,   # filled in step 3
            "isCounseling": norm["durationSeconds"] >= 600,
        })

    activity_ids = [c["activityId"] for c in call_history_raw]
    eval_overlay_map = await fetch_latest_eval_overlays(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id="inside-sales",
        thread_ids=activity_ids,
    )
    if activity_ids:
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
            app_id="inside-sales",
            thread_ids=activity_ids,
        )
    ]

    # 5. Compute drilldown metrics
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
            agent_name=c["agentName"],
            duration_seconds=c["durationSeconds"],
            status=c["status"],
            recording_url=c["recordingUrl"],
            eval_score=c["evalScore"],
            is_counseling=c["isCounseling"],
        )
        for c in call_history_raw
    ]

    return LeadDetailFullResponse(
        prospect_id=lead["prospectId"],
        first_name=lead["firstName"],
        last_name=lead["lastName"],
        phone=lead["phone"],
        email=lead.get("email"),
        prospect_stage=lead["prospectStage"],
        city=lead["city"],
        age_group=lead["ageGroup"],
        condition=lead["condition"],
        hba1c_band=lead["hba1cBand"],
        blood_sugar_band=lead["bloodSugarBand"],
        diabetes_duration=lead["diabetesDuration"],
        current_management=lead["currentManagement"],
        goal=lead["goal"],
        intent_to_pay=lead["intentToPay"],
        job_title=lead["jobTitle"],
        preferred_call_time=lead["preferredCallTime"],
        agent_name=lead["agentName"],
        source=lead["source"],
        source_campaign=lead["sourceCampaign"],
        created_on=lead["createdOn"],
        mql_score=mql_score,
        mql_signals=mql_signals,
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
    )
