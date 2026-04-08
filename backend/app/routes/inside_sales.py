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
from app.schemas.inside_sales import (
    CallRecord, CallListResponse, LeadDetailResponse, AgentListResponse,
    LeadListRecord, LeadListResponse, LeadCallRecord, LeadDetailFullResponse, LeadEvalHistoryEntry,
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
    list_call_agent_names_from_mirror,
    list_calls_from_mirror,
    list_leads_from_mirror,
)
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


@router.get("/agents", response_model=AgentListResponse)
async def list_agents(
    date_from: str = Query(..., description="Start date YYYY-MM-DD HH:MM:SS"),
    date_to: str = Query(..., description="End date YYYY-MM-DD HH:MM:SS"),
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Serving helper endpoint for date-scoped call filter options."""
    return AgentListResponse(
        agents=await list_call_agent_names_from_mirror(
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
    call_page = await list_calls_from_mirror(
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

    return CallListResponse(
        calls=[CallRecord(**call) for call in call_page.records],
        total=call_page.total,
        page=call_page.page,
        page_size=call_page.page_size,
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
    auth: AuthContext = require_fixed_app_access('inside-sales'),
    db: AsyncSession = Depends(get_db),
):
    """Serving endpoint for the leads collection."""
    lead_page = await list_leads_from_mirror(
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
        ),
        page=page,
        page_size=page_size,
    )

    return LeadListResponse(
        leads=[LeadListRecord(**lead) for lead in lead_page.records],
        total=lead_page.total,
        page=lead_page.page,
        page_size=lead_page.page_size,
    )


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
