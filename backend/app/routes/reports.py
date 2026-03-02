"""Report generation endpoint."""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from playwright.async_api import async_playwright
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.database import get_db
from app.models.eval_run import EvalRun
from app.models.evaluation_analytics import EvaluationAnalytics
from app.services.reports import ReportService
from app.schemas.base import CamelModel
from app.services.reports.cross_run_aggregator import (
    CrossRunAggregator,
    CrossRunAISummary,
    CrossRunAnalytics,
)
from app.services.reports.cross_run_narrator import CrossRunNarrator
from app.services.reports.pdf_template import render_report_html
from app.services.reports.schemas import ReportPayload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])


# --- Response schemas ---

class CrossRunAnalyticsResponse(CamelModel):
    analytics: CrossRunAnalytics
    computed_at: str
    is_stale: bool
    new_runs_since: int
    source_run_count: int


# --- Cross-run analytics (cached) ---

@router.get("/cross-run-analytics", response_model=CrossRunAnalyticsResponse)
async def get_cross_run_analytics(
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Return cached cross-run analytics from evaluation_analytics table."""
    result = await db.execute(
        select(EvaluationAnalytics)
        .where(
            EvaluationAnalytics.app_id == app_id,
            EvaluationAnalytics.scope == "cross_run",
            EvaluationAnalytics.run_id.is_(None),
        )
    )
    cached = result.scalar_one_or_none()

    if not cached:
        raise HTTPException(
            status_code=404,
            detail="No cached cross-run analytics. Use POST /cross-run-analytics/refresh to compute.",
        )

    # Staleness: count single_run caches computed after this cross_run cache
    stale_stmt = (
        select(func.count())
        .select_from(EvaluationAnalytics)
        .where(
            EvaluationAnalytics.app_id == app_id,
            EvaluationAnalytics.scope == "single_run",
            EvaluationAnalytics.computed_at > cached.computed_at,
        )
    )
    stale_result = await db.execute(stale_stmt)
    new_runs_since = stale_result.scalar() or 0

    analytics = CrossRunAnalytics.model_validate(cached.analytics_data)

    return CrossRunAnalyticsResponse(
        analytics=analytics,
        computed_at=cached.computed_at.isoformat() if cached.computed_at else "",
        is_stale=new_runs_since > 0,
        new_runs_since=new_runs_since,
        source_run_count=cached.source_run_count or 0,
    )


@router.post("/cross-run-analytics/refresh", response_model=CrossRunAnalyticsResponse)
async def refresh_cross_run_analytics(
    app_id: str = Query(...),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Recompute cross-run analytics from single_run caches and persist."""
    # Load single_run analytics rows + their EvalRun metadata
    analytics_stmt = (
        select(EvaluationAnalytics)
        .where(
            EvaluationAnalytics.app_id == app_id,
            EvaluationAnalytics.scope == "single_run",
        )
        .order_by(desc(EvaluationAnalytics.computed_at))
        .limit(limit)
    )
    analytics_result = await db.execute(analytics_stmt)
    analytics_rows = list(analytics_result.scalars().all())

    if not analytics_rows:
        raise HTTPException(
            status_code=404,
            detail="No completed runs with generated reports found.",
        )

    # Load associated EvalRuns for metadata
    run_ids = [row.run_id for row in analytics_rows if row.run_id]
    runs_by_id: dict[str, EvalRun] = {}
    if run_ids:
        runs_result = await db.execute(
            select(EvalRun)
            .where(EvalRun.id.in_(run_ids))
            .options(load_only(
                EvalRun.id, EvalRun.eval_type, EvalRun.created_at,
                EvalRun.batch_metadata,
            ))
        )
        runs_by_id = {str(r.id): r for r in runs_result.scalars().all()}

    # Total runs count for coverage indicator
    count_stmt = (
        select(func.count())
        .select_from(EvalRun)
        .where(EvalRun.app_id == app_id)
    )
    count_result = await db.execute(count_stmt)
    all_runs_count = count_result.scalar() or 0

    # Build runs_data tuples for CrossRunAggregator
    runs_data = []
    for row in analytics_rows:
        run_id_str = str(row.run_id) if row.run_id else ""
        run = runs_by_id.get(run_id_str)
        if not run:
            continue
        runs_data.append((
            {
                "id": run_id_str,
                "eval_type": run.eval_type,
                "created_at": run.created_at.isoformat() if run.created_at else "",
                "batch_metadata": run.batch_metadata,
            },
            row.analytics_data,
        ))

    if not runs_data:
        raise HTTPException(
            status_code=404,
            detail="No completed runs with generated reports found.",
        )

    aggregator = CrossRunAggregator(runs_data, all_runs_count)
    analytics = aggregator.aggregate()

    now = datetime.now(timezone.utc)

    # Upsert cross_run cache
    existing_result = await db.execute(
        select(EvaluationAnalytics)
        .where(
            EvaluationAnalytics.app_id == app_id,
            EvaluationAnalytics.scope == "cross_run",
            EvaluationAnalytics.run_id.is_(None),
        )
    )
    existing = existing_result.scalar_one_or_none()

    analytics_dict = analytics.model_dump()

    if existing:
        existing.analytics_data = analytics_dict
        existing.computed_at = now
        existing.source_run_count = len(runs_data)
    else:
        row = EvaluationAnalytics(
            app_id=app_id,
            scope="cross_run",
            run_id=None,
            analytics_data=analytics_dict,
            computed_at=now,
            source_run_count=len(runs_data),
        )
        db.add(row)

    await db.commit()

    return CrossRunAnalyticsResponse(
        analytics=analytics,
        computed_at=now.isoformat(),
        is_stale=False,
        new_runs_since=0,
        source_run_count=len(runs_data),
    )


@router.get("/{run_id}/export-pdf")
async def export_report_pdf(run_id: str, db: AsyncSession = Depends(get_db)):
    """Export report as PDF via headless browser rendering of self-contained HTML."""
    # Verify run exists
    stmt = select(EvalRun).where(EvalRun.id == UUID(run_id))
    result = await db.execute(stmt)
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Evaluation run not found")

    # Load cached report from evaluation_analytics
    cache_result = await db.execute(
        select(EvaluationAnalytics.analytics_data)
        .where(
            EvaluationAnalytics.scope == "single_run",
            EvaluationAnalytics.run_id == UUID(run_id),
        )
    )
    cached_data = cache_result.scalar_one_or_none()
    if not cached_data:
        raise HTTPException(
            status_code=400,
            detail="Report has not been generated yet. Generate the report first.",
        )

    # Validate into Pydantic model and re-dump with aliases.
    try:
        payload = ReportPayload.model_validate(cached_data)
        camel_data = payload.model_dump(by_alias=True)
    except Exception:
        logger.warning("Report cache invalid for run %s", run_id)
        raise HTTPException(status_code=400, detail="Cached report data is corrupted.")

    html_content = render_report_html(camel_data)

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-gpu"],
            )
            page = await browser.new_page()
            await page.set_content(html_content, wait_until="networkidle")

            pdf_bytes = await page.pdf(
                format="A4",
                print_background=True,
                margin={
                    "top": "12mm",
                    "right": "14mm",
                    "bottom": "12mm",
                    "left": "14mm",
                },
            )
            await browser.close()
    except Exception as e:
        logger.exception("PDF export failed for run %s", run_id)
        raise HTTPException(
            status_code=500,
            detail=f"PDF generation failed: {str(e)}",
        )

    short_id = run_id[:8]
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="eval-report-{short_id}.pdf"',
        },
    )


@router.get("/{run_id}", response_model=ReportPayload)
async def get_report(
    run_id: str,
    refresh: bool = Query(False, description="Force regeneration, bypassing cache"),
    cache_only: bool = Query(False, description="Only return cached report; 404 if not cached"),
    provider: str | None = Query(None, description="LLM provider for narrative generation"),
    model: str | None = Query(None, description="LLM model for narrative generation"),
    db: AsyncSession = Depends(get_db),
):
    """Generate an evaluation report for a completed run.

    Returns the full ReportPayload with metrics, distributions,
    rule compliance, exemplars, and AI narrative. Results are cached
    after first generation; use ?refresh=true to force regeneration.
    Use ?cache_only=true to check for cached data without triggering generation.
    """
    if cache_only:
        # Load from evaluation_analytics instead of EvalRun.report_cache
        cache_result = await db.execute(
            select(EvaluationAnalytics.analytics_data)
            .where(
                EvaluationAnalytics.scope == "single_run",
                EvaluationAnalytics.run_id == UUID(run_id),
            )
        )
        cached_data = cache_result.scalar_one_or_none()
        if not cached_data:
            raise HTTPException(status_code=404, detail="No cached report")
        try:
            payload = ReportPayload.model_validate(cached_data)
            return payload
        except Exception:
            raise HTTPException(status_code=404, detail="No cached report")

    service = ReportService(db)
    try:
        return await service.generate(
            run_id,
            force_refresh=refresh,
            llm_provider=provider,
            llm_model=model,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class CrossRunSummaryRequest(CamelModel):
    app_id: str
    stats: dict
    health_trend: list[dict]
    top_issues: list[dict]
    top_recommendations: list[dict]
    provider: str | None = None
    model: str | None = None


@router.post("/cross-run-ai-summary", response_model=CrossRunAISummary)
async def generate_cross_run_ai_summary(
    request: CrossRunSummaryRequest,
    _db: AsyncSession = Depends(get_db),
):
    """Generate AI summary of cross-run analytics."""
    from app.services.evaluators.llm_base import create_llm_provider, LoggingLLMWrapper
    from app.services.evaluators.runner_utils import save_api_log
    from app.services.evaluators.settings_helper import get_llm_settings_from_db

    try:
        settings = await get_llm_settings_from_db(
            auth_intent="managed_job",
            provider_override=request.provider or None,
        )

        effective_provider = request.provider or settings["provider"]
        effective_model = request.model or settings["selected_model"]

        if not effective_model:
            raise HTTPException(
                status_code=400,
                detail="No LLM model specified. Configure LLM settings or pass provider/model.",
            )

        provider = create_llm_provider(
            provider=effective_provider,
            api_key=settings["api_key"],
            model_name=effective_model,
            service_account_path=settings["service_account_path"],
        )

        llm = LoggingLLMWrapper(provider, log_callback=save_api_log)
        llm.set_context(run_id="cross_run_analytics", thread_id="cross_run_summary")

        narrator = CrossRunNarrator(llm)
        result = await narrator.generate(
            stats=request.stats,
            health_trend=request.health_trend,
            top_issues=request.top_issues,
            top_recommendations=request.top_recommendations,
        )

        if not result:
            raise HTTPException(
                status_code=500,
                detail="AI summary generation failed. Check LLM configuration.",
            )

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Cross-run AI summary failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"AI summary generation failed: {str(e)}",
        )
