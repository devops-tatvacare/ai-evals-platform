"""Routes for Inside Sales call data."""

import uuid as _uuid
from datetime import datetime as _dt, timezone as _tz

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.auth.app_scope import require_fixed_app_access
from app.auth.context import AuthContext
from app.models.eval_run import ThreadEvaluation, EvalRun
from app.database import get_db
from app.schemas.inside_sales import (
    CallRecord, CallListResponse, LeadDetailResponse, AgentListResponse,
    LeadListRecord, LeadListResponse, LeadCallRecord, LeadDetailFullResponse, LeadEvalHistoryEntry,
)
from app.services.inside_sales_dataset_resolver import (
    InsideSalesCallFilters,
    InsideSalesLeadFilters,
    list_call_agent_names,
    resolve_call_dataset_page,
    resolve_lead_dataset_page,
)
from app.services.lsq_client import (
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


@router.get("/agents", response_model=AgentListResponse)
async def list_agents(
    date_from: str = Query(..., description="Start date YYYY-MM-DD HH:MM:SS"),
    date_to: str = Query(..., description="End date YYYY-MM-DD HH:MM:SS"),
    auth: AuthContext = require_fixed_app_access('inside-sales'),
):
    """Return sorted unique agent names for the given date range."""
    return AgentListResponse(
        agents=await list_call_agent_names(date_from=date_from, date_to=date_to),
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
    """Fetch call activities from LSQ through the canonical dataset resolver."""
    call_page = await resolve_call_dataset_page(
        InsideSalesCallFilters(
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

    # Batch-fetch latest eval score per activity
    eval_map: dict[str, dict] = {}
    activity_ids = [call["activityId"] for call in call_page.records]
    if activity_ids:
        subq = (
            select(
                ThreadEvaluation.thread_id,
                func.max(ThreadEvaluation.id).label("latest_id"),
                func.count(ThreadEvaluation.id).label("eval_count"),
            )
            .join(EvalRun, ThreadEvaluation.run_id == EvalRun.id)
            .where(
                ThreadEvaluation.thread_id.in_(activity_ids),
                EvalRun.tenant_id == auth.tenant_id,
                EvalRun.user_id == auth.user_id,
                EvalRun.app_id == "inside-sales",
                EvalRun.status == "completed",
            )
            .group_by(ThreadEvaluation.thread_id)
            .subquery()
        )

        db_result = await db.execute(
            select(ThreadEvaluation, subq.c.eval_count)
            .join(subq, ThreadEvaluation.id == subq.c.latest_id)
        )
        rows = db_result.all()

        for te, count in rows:
            raw = te.result or {}
            evals = raw.get("evaluations") or []
            score = None
            if evals:
                out = evals[0].get("output") or {}
                score = out.get("overall_score")
                if score is None:
                    score = raw.get("output", {}).get("overall_score")
            eval_map[te.thread_id] = {"score": score, "count": count}

    for call in call_page.records:
        info = eval_map.get(call["activityId"], {})
        call["lastEvalScore"] = info.get("score")
        call["evalCount"] = info.get("count", 0)

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
    """Fetch lead details by prospect ID. Cached in DB after first fetch.

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
    lead = await fetch_lead_by_id(prospect_id)

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
):
    """Fetch leads from LSQ through the canonical dataset resolver."""
    lead_page = await resolve_lead_dataset_page(
        InsideSalesLeadFilters(
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
    """Full lead drilldown: profile + call history + eval history."""
    # 1. Fetch full lead record
    raw = await fetch_lead_by_id(prospect_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = normalize_lead(raw)
    mql_score, mql_signals = compute_mql_score(raw)

    # 2. Fetch call history for this prospect
    created_on = lead["createdOn"] or "2020-01-01 00:00:00"
    date_to_now = _dt.now(_tz.utc).strftime("%Y-%m-%d %H:%M:%S")
    raw_activities, history_truncated = await fetch_lead_activities_for_prospect(
        prospect_id=prospect_id,
        date_from=created_on,
        date_to=date_to_now,
    )

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

    # 3. Fetch eval scores for calls in history
    activity_ids = [c["activityId"] for c in call_history_raw]
    if activity_ids:
        # Latest ThreadEvaluation per thread_id
        subq = (
            select(
                ThreadEvaluation.thread_id,
                func.max(ThreadEvaluation.id).label("latest_id"),
            )
            .join(EvalRun, ThreadEvaluation.run_id == EvalRun.id)
            .where(
                ThreadEvaluation.thread_id.in_(activity_ids),
                EvalRun.app_id == "inside-sales",
                EvalRun.tenant_id == auth.tenant_id,
                EvalRun.user_id == auth.user_id,
                EvalRun.status == "completed",
            )
            .group_by(ThreadEvaluation.thread_id)
            .subquery()
        )
        eval_result = await db.execute(
            select(ThreadEvaluation).join(subq, ThreadEvaluation.id == subq.c.latest_id)
        )
        te_rows = eval_result.scalars().all()

        # Build score map
        score_map: dict[str, float | None] = {}
        for te in te_rows:
            raw_result = te.result or {}
            evals = raw_result.get("evaluations") or []
            score: float | None = None
            if evals:
                out = evals[0].get("output") or {}
                score = out.get("overall_score")
                if score is None:
                    score = raw_result.get("output", {}).get("overall_score")
            score_map[te.thread_id] = score

        for c in call_history_raw:
            if c["activityId"] in score_map:
                c["evalScore"] = score_map[c["activityId"]]

    # 4. Build eval_history (all ThreadEvaluation for this prospect's calls, ordered by id desc)
    eval_history_list: list[LeadEvalHistoryEntry] = []
    if activity_ids:
        eval_rows_result = await db.execute(
            select(ThreadEvaluation)
            .join(EvalRun, ThreadEvaluation.run_id == EvalRun.id)
            .where(
                ThreadEvaluation.thread_id.in_(activity_ids),
                EvalRun.app_id == "inside-sales",
                EvalRun.tenant_id == auth.tenant_id,
                EvalRun.user_id == auth.user_id,
            )
            .order_by(ThreadEvaluation.id.desc())
        )
        for te in eval_rows_result.scalars().all():
            eval_history_list.append(LeadEvalHistoryEntry(
                id=str(te.id),
                thread_id=te.thread_id,
                run_id=str(te.run_id),
                result=te.result or {},
                created_at=str(te.created_at),
            ))

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
