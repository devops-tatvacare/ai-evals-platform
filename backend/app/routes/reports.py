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

from app.auth.app_scope import ensure_registered_app_access
from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission, require_app_access
from app.database import get_db
from app.models.app import App
from app.models.eval_run import EvalRun
from app.models.evaluation_analytics import EvaluationAnalytics
from app.models.report_config import ReportConfig
from app.models.report_artifact import ReportArtifact
from app.models.report_run import ReportRun
from app.schemas.app_config import AppConfig as AppConfigSchema
from app.schemas.app_analytics_config import AppAnalyticsConfig
from app.schemas.base import CamelModel
from app.schemas.reporting import ReportConfigResponse, ReportRunResponse
from app.services.access_control import readable_scope_clause
from app.services.reports.contracts.run_report import PlatformRunReportPayload
from app.services.reports.canonical_adapters import adapt_cross_run_summary
from app.services.reports.analytics_profiles.base import AnalyticsProfile
from app.services.reports.analytics_profiles.registry import get_analytics_profile
from app.services.reports.cache_validation import (
    load_cached_payload_or_raise,
    partition_valid_single_run_payloads,
)
from app.services.reports.config_models import ExportConfig, PresentationConfig
from app.services.reports.cross_run_aggregator import CrossRunAISummary
from app.services.reports.cross_run_narrator import CrossRunNarrator
from app.services.reports.contracts.cross_run_narrative import PlatformCrossRunNarrative
from app.services.reports.contracts.cross_run_report import PlatformCrossRunPayload
from app.services.reports.document_composer import compose_document
from app.services.reports.html_renderer import render_report_document
from app.services.reports.report_config_resolver import resolve_report_config
from app.services.reports.report_run_store import fetch_single_run_artifact, fetch_report_run_artifact

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])


# --- Response schemas ---

class CrossRunAnalyticsResponse(CamelModel):
    analytics: dict
    computed_at: str
    is_stale: bool
    new_runs_since: int
    source_run_count: int


async def _get_visible_eval_run(
    db: AsyncSession,
    *,
    run_id: UUID,
    auth: AuthContext,
) -> EvalRun:
    run = await db.scalar(
        select(EvalRun).where(
            EvalRun.id == run_id,
            readable_scope_clause(EvalRun, auth),
        )
    )
    if not run:
        raise HTTPException(status_code=404, detail="Evaluation run not found")
    await ensure_registered_app_access(
        db,
        auth,
        run.app_id,
        required=True,
        param_name='app_id',
    )
    return run


async def _get_visible_report_run(
    db: AsyncSession,
    *,
    report_run_id: UUID,
    auth: AuthContext,
) -> ReportRun:
    report_run = await db.scalar(select(ReportRun).where(ReportRun.id == report_run_id))
    if not report_run:
        raise HTTPException(status_code=404, detail="Report run not found")
    if report_run.source_eval_run_id is not None:
        await _get_visible_eval_run(db, run_id=report_run.source_eval_run_id, auth=auth)
    elif not await db.scalar(
        select(ReportRun.id).where(
            ReportRun.id == report_run_id,
            readable_scope_clause(ReportRun, auth),
        )
    ):
        raise HTTPException(status_code=404, detail="Report run not found")
    await ensure_registered_app_access(
        db,
        auth,
        report_run.app_id,
        required=True,
        param_name='app_id',
    )
    return report_run


def _load_report_payload(artifact_data: dict, *, detail: str, log_message: str) -> PlatformRunReportPayload:
    return load_cached_payload_or_raise(
        PlatformRunReportPayload.model_validate,
        artifact_data,
        detail=detail,
        log_message=log_message,
    )


def _load_cross_run_payload(
    profile: AnalyticsProfile,
    cached_data: dict,
    *,
    detail: str,
    log_message: str,
) -> PlatformCrossRunPayload:
    if profile.cross_run_adapter is None:
        raise ValueError('Cross-run adapter is required')

    return load_cached_payload_or_raise(
        profile.cross_run_adapter.load_cached,
        cached_data,
        detail=detail,
        log_message=log_message,
    )


def _compose_export_document(
    *,
    payload: PlatformRunReportPayload,
    report_run: ReportRun,
    report_config: ReportConfig,
) -> str:
    presentation_config = PresentationConfig.model_validate(report_config.presentation_config or {})
    export_config = ExportConfig.model_validate(report_config.export_config or {})
    if not export_config.enabled:
        raise HTTPException(status_code=404, detail="PDF export is not enabled for this report")
    export_document = compose_document(
        title=payload.metadata.report_name or payload.metadata.run_name or report_config.name,
        subtitle=f'{report_run.app_id} {report_run.scope.replace("_", "-")} report',
        metadata={
            'Run ID': payload.metadata.run_id,
            'Report': payload.metadata.report_name or report_config.name,
            'Computed': payload.metadata.computed_at,
            'Model': payload.metadata.llm_model,
        },
        sections=payload.sections,
        export_config=export_config,
        theme_tokens=dict(presentation_config.theme_tokens or {}) | dict(payload.presentation.theme_tokens or {}),
    )
    return render_report_document(export_document)


def _extract_cross_run_summary_inputs(
    payload: PlatformCrossRunPayload,
    analytics_config: AppAnalyticsConfig,
) -> tuple[dict, list[dict], list[dict], list[dict]]:
    allowed_section_ids = set(analytics_config.cross_run.ai_summary.section_ids)
    sections = [
        section for section in payload.sections
        if not allowed_section_ids or section.id in allowed_section_ids
    ]
    summary_cards = next((section for section in sections if section.type == 'summary_cards'), None)
    metric_section = next((section for section in sections if section.type == 'metric_breakdown'), None)
    issues_section = next((section for section in sections if section.type == 'issues_recommendations'), None)

    stats = {
        'totalRuns': payload.metadata.source_run_count,
        'allRuns': payload.metadata.total_runs_available,
    }
    if summary_cards:
        for item in summary_cards.data:
            stats[item.key] = item.value

    health_trend = []
    if metric_section:
        health_trend = [
            {
                'runName': item.label,
                'healthScore': item.value,
            }
            for item in metric_section.data
        ]

    top_issues = []
    top_recommendations = []
    if issues_section:
        top_issues = [item.model_dump(by_alias=True) for item in issues_section.data.issues]
        top_recommendations = [
            item.model_dump(by_alias=True)
            for item in issues_section.data.recommendations
        ]

    return stats, health_trend, top_issues, top_recommendations


@router.get("/report-configs", response_model=list[ReportConfigResponse])
async def list_report_configs(
    app_id: str = Query(...),
    scope: str = Query(...),
    auth: AuthContext = require_permission('insights:view'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(ReportConfig)
        .where(
            ReportConfig.app_id == app_id,
            ReportConfig.scope == scope,
            ReportConfig.status == 'active',
            readable_scope_clause(ReportConfig, auth),
        )
        .order_by(desc(ReportConfig.is_default), desc(ReportConfig.updated_at))
    )
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/report-runs", response_model=list[ReportRunResponse])
async def list_report_runs(
    app_id: str = Query(...),
    scope: str = Query(...),
    source_eval_run_id: UUID | None = Query(None),
    report_id: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    auth: AuthContext = require_permission('insights:view'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    if source_eval_run_id is not None:
        run = await _get_visible_eval_run(db, run_id=source_eval_run_id, auth=auth)
        if run.app_id != app_id:
            raise HTTPException(status_code=404, detail="Evaluation run not found")

    query = (
        select(ReportRun)
        .where(
            ReportRun.app_id == app_id,
            ReportRun.scope == scope,
            ReportRun.tenant_id == auth.tenant_id,
        )
        .order_by(desc(ReportRun.completed_at), desc(ReportRun.created_at))
        .limit(limit)
    )
    if source_eval_run_id is None:
        query = query.where(readable_scope_clause(ReportRun, auth))
    if source_eval_run_id is not None:
        query = query.where(ReportRun.source_eval_run_id == source_eval_run_id)
    if report_id:
        query = query.where(ReportRun.report_id == report_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/report-runs/{report_run_id}/artifact", response_model=PlatformRunReportPayload)
async def get_report_run_artifact(
    report_run_id: UUID,
    auth: AuthContext = require_permission('insights:view'),
    db: AsyncSession = Depends(get_db),
):
    report_run, artifact = (await fetch_report_run_artifact(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_access=auth.app_access,
        report_run_id=report_run_id,
    )) or (None, None)
    if report_run is None or artifact is None:
        raise HTTPException(status_code=404, detail="Report artifact not found")
    await ensure_registered_app_access(
        db,
        auth,
        report_run.app_id,
        required=True,
        param_name='app_id',
    )
    if report_run.status != 'completed':
        raise HTTPException(status_code=409, detail="Report run is not completed yet")
    return _load_report_payload(
        artifact.artifact_data,
        detail='Cached report artifact is outdated. Regenerate the report.',
        log_message=f'Report artifact invalid for report run {report_run_id} during fetch',
    )


@router.get("/report-runs/{report_run_id}/export-pdf")
async def export_report_run_pdf(
    report_run_id: UUID,
    auth: AuthContext = require_permission('evaluation:export'),
    db: AsyncSession = Depends(get_db),
):
    report_run, artifact = (await fetch_report_run_artifact(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_access=auth.app_access,
        report_run_id=report_run_id,
    )) or (None, None)
    if report_run is None or artifact is None:
        raise HTTPException(status_code=404, detail="Report artifact not found")
    await ensure_registered_app_access(
        db,
        auth,
        report_run.app_id,
        required=True,
        param_name='app_id',
    )
    if report_run.status != 'completed':
        raise HTTPException(status_code=409, detail="Report run is not completed yet")
    report_config = await resolve_report_config(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=report_run.app_id,
        scope=report_run.scope,
        report_id=report_run.report_id,
    )
    payload = _load_report_payload(
        artifact.artifact_data,
        detail='Cached report artifact is outdated. Regenerate the report before exporting.',
        log_message=f'Report artifact invalid for report run {report_run_id} during PDF export',
    )
    html_content = _compose_export_document(
        payload=payload,
        report_run=report_run,
        report_config=report_config,
    )

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
        logger.exception("PDF export failed for report run %s", report_run_id)
        raise HTTPException(
            status_code=500,
            detail=f"PDF generation failed: {str(e)}",
        )

    short_id = str(report_run_id)[:8]
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="eval-report-{short_id}.pdf"',
        },
    )


async def _load_app_analytics_config(
    db: AsyncSession,
    app_id: str,
) -> AppAnalyticsConfig:
    app_row = await db.scalar(
        select(App).where(
            App.slug == app_id,
            App.is_active == True,
        )
    )
    if not app_row:
        raise HTTPException(status_code=404, detail=f"App not found: {app_id}")
    app_config = AppConfigSchema.model_validate(app_row.config or {})
    return app_config.analytics


async def _load_analytics_profile(
    db: AsyncSession,
    app_id: str,
) -> tuple[AppAnalyticsConfig, AnalyticsProfile]:
    analytics_config = await _load_app_analytics_config(db, app_id)
    profile = get_analytics_profile(analytics_config.profile)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Reporting profile is not enabled for app: {app_id}")
    return analytics_config, profile


# --- Cross-run analytics (cached) ---

@router.get("/cross-run-analytics", response_model=CrossRunAnalyticsResponse)
async def get_cross_run_analytics(
    app_id: str = Query(...),
    auth: AuthContext = require_permission('insights:view'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Return cached cross-run analytics scoped to tenant + app_id."""
    analytics_config, profile = await _load_analytics_profile(db, app_id)
    if not analytics_config.capabilities.cross_run_analytics or not profile.cross_run_adapter:
        raise HTTPException(status_code=404, detail=f"Cross-run analytics is not enabled for app: {app_id}")

    result = await db.execute(
        select(EvaluationAnalytics)
        .where(
            EvaluationAnalytics.tenant_id == auth.tenant_id,
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
            EvaluationAnalytics.tenant_id == auth.tenant_id,
            EvaluationAnalytics.app_id == app_id,
            EvaluationAnalytics.scope == "single_run",
            EvaluationAnalytics.computed_at > cached.computed_at,
        )
    )
    stale_result = await db.execute(stale_stmt)
    new_runs_since = stale_result.scalar() or 0

    analytics = _load_cross_run_payload(
        profile,
        cached.analytics_data,
        detail='Cached cross-run analytics are outdated. Refresh analytics.',
        log_message=f'Cross-run analytics cache invalid for app {app_id}',
    )

    return CrossRunAnalyticsResponse(
        analytics=analytics.model_dump(by_alias=True),
        computed_at=cached.computed_at.isoformat() if cached.computed_at else "",
        is_stale=new_runs_since > 0,
        new_runs_since=new_runs_since,
        source_run_count=cached.source_run_count or 0,
    )


@router.post("/cross-run-analytics/refresh", response_model=CrossRunAnalyticsResponse)
async def refresh_cross_run_analytics(
    app_id: str = Query(...),
    limit: int = Query(50, ge=1, le=100),
    auth: AuthContext = require_permission('report:generate'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Recompute cross-run analytics from single_run caches for user's runs within tenant."""
    analytics_config, profile = await _load_analytics_profile(db, app_id)
    if not analytics_config.capabilities.cross_run_analytics or not profile.cross_run_adapter or not profile.report_payload_model:
        raise HTTPException(status_code=404, detail=f"Cross-run analytics is not enabled for app: {app_id}")

    report_config = await resolve_report_config(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=app_id,
        scope='single_run',
        report_id=None,
    )
    artifact_rows_result = await db.execute(
        select(ReportRun, ReportArtifact)
        .join(ReportArtifact, ReportArtifact.report_run_id == ReportRun.id)
        .join(EvalRun, EvalRun.id == ReportRun.source_eval_run_id)
        .where(
            readable_scope_clause(EvalRun, auth),
            ReportRun.app_id == app_id,
            ReportRun.scope == 'single_run',
            ReportRun.report_id == report_config.report_id,
            ReportRun.status == 'completed',
            ReportRun.source_eval_run_id.is_not(None),
        )
        .order_by(desc(ReportRun.completed_at), desc(ReportArtifact.computed_at))
    )
    artifact_rows = list(artifact_rows_result.all())

    latest_by_source: list[tuple[ReportRun, ReportArtifact]] = []
    seen_run_ids: set[UUID] = set()
    for report_run, artifact in artifact_rows:
        if report_run.source_eval_run_id in seen_run_ids:
            continue
        seen_run_ids.add(report_run.source_eval_run_id)
        latest_by_source.append((report_run, artifact))
        if len(latest_by_source) >= limit:
            break

    if not latest_by_source:
        raise HTTPException(
            status_code=404,
            detail="No completed runs with generated reports found.",
        )

    run_ids = [row.source_eval_run_id for row, _artifact in latest_by_source if row.source_eval_run_id]
    runs_by_id: dict[str, EvalRun] = {}
    if run_ids:
        runs_result = await db.execute(
            select(EvalRun)
            .where(
                EvalRun.id.in_(run_ids),
                readable_scope_clause(EvalRun, auth),
            )
            .options(load_only(
                EvalRun.id, EvalRun.eval_type, EvalRun.created_at,
                EvalRun.batch_metadata,
            ))
        )
        runs_by_id = {str(r.id): r for r in runs_result.scalars().all()}

    # Total runs count for coverage indicator (scoped to user within tenant)
    count_stmt = (
        select(func.count())
        .select_from(EvalRun)
        .where(
            readable_scope_clause(EvalRun, auth),
            EvalRun.app_id == app_id,
        )
    )
    count_result = await db.execute(count_stmt)
    all_runs_count = count_result.scalar() or 0

    # Build runs_data tuples for CrossRunAggregator
    runs_data = []
    for row, artifact in latest_by_source:
        run_id_str = str(row.source_eval_run_id) if row.source_eval_run_id else ""
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
            artifact.artifact_data,
        ))

    if not runs_data:
        raise HTTPException(
            status_code=404,
            detail="No completed runs with generated reports found.",
        )

    runs_data, invalid_cached_reports = partition_valid_single_run_payloads(
        runs_data,
        profile.report_payload_model,
    )

    if not runs_data:
        if invalid_cached_reports:
            raise HTTPException(
                status_code=409,
                detail='Cached reports are outdated. Regenerate single-run reports before refreshing cross-run analytics.',
            )
        raise HTTPException(
            status_code=404,
            detail="No completed runs with generated reports found.",
        )

    analytics = profile.cross_run_adapter.aggregate(
        runs_data,
        all_runs_count,
        analytics_config=analytics_config,
        app_id=app_id,
    )

    now = datetime.now(timezone.utc)

    # Upsert cross_run cache scoped to tenant
    existing_result = await db.execute(
        select(EvaluationAnalytics)
        .where(
            EvaluationAnalytics.tenant_id == auth.tenant_id,
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
            tenant_id=auth.tenant_id,
        )
        db.add(row)

    await db.commit()

    return CrossRunAnalyticsResponse(
        analytics=analytics.model_dump(by_alias=True),
        computed_at=now.isoformat(),
        is_stale=False,
        new_runs_since=0,
        source_run_count=len(runs_data),
    )


@router.get("/{run_id}/export-pdf")
async def export_report_pdf(
    run_id: str,
    report_id: str | None = Query(None),
    auth: AuthContext = require_permission('evaluation:export'),
    db: AsyncSession = Depends(get_db),
):
    """Export report as PDF via headless browser rendering of self-contained HTML."""
    run = await _get_visible_eval_run(db, run_id=UUID(run_id), auth=auth)

    report_config = await resolve_report_config(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=run.app_id,
        scope='single_run',
        report_id=report_id,
    )
    artifact_data = await fetch_single_run_artifact(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_access=auth.app_access,
        run_id=UUID(run_id),
        app_id=run.app_id,
        report_id=report_config.report_id,
    )
    if not artifact_data:
        raise HTTPException(
            status_code=400,
            detail="Report has not been generated yet. Generate the report first.",
        )
    payload = _load_report_payload(
        artifact_data,
        detail='Cached report artifact is outdated. Regenerate the report before exporting.',
        log_message=f'Report artifact invalid for run {run_id} during PDF export',
    )
    report_run_id = payload.metadata.report_run_id
    report_run = None
    if report_run_id:
        try:
            report_run = await _get_visible_report_run(db, report_run_id=UUID(report_run_id), auth=auth)
        except ValueError:
            report_run = None
    if report_run is None:
        report_run = await db.scalar(
            select(ReportRun).where(
                ReportRun.app_id == run.app_id,
                ReportRun.scope == 'single_run',
                ReportRun.report_id == report_config.report_id,
                ReportRun.source_eval_run_id == UUID(run_id),
                ReportRun.status == 'completed',
                ReportRun.tenant_id == auth.tenant_id,
            )
            .order_by(desc(ReportRun.completed_at), desc(ReportRun.created_at))
        )
    if report_run is None:
        raise HTTPException(status_code=404, detail="Report run not found")
    html_content = _compose_export_document(
        payload=payload,
        report_run=report_run,
        report_config=report_config,
    )

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


@router.get("/{run_id}")
async def get_report(
    run_id: str,
    report_id: str | None = Query(None, description="Report config identifier"),
    refresh: bool = Query(False, description="Force regeneration, bypassing cache"),
    cache_only: bool = Query(False, description="Only return cached report; 404 if not cached"),
    provider: str | None = Query(None, description="LLM provider for narrative generation"),
    model: str | None = Query(None, description="LLM model for narrative generation"),
    auth: AuthContext = require_permission('insights:view'),
    db: AsyncSession = Depends(get_db),
):
    """Return the latest generated report artifact for a completed run."""
    del refresh, provider, model
    run = await _get_visible_eval_run(db, run_id=UUID(run_id), auth=auth)

    try:
        config = await resolve_report_config(
            db,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            app_id=run.app_id,
            scope='single_run',
            report_id=report_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    artifact_data = await fetch_single_run_artifact(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_access=auth.app_access,
        run_id=UUID(run_id),
        app_id=run.app_id,
        report_id=config.report_id,
    )
    if not artifact_data:
        detail = "No cached report" if cache_only else "Report has not been generated yet. Submit a generate-report job first."
        raise HTTPException(status_code=404, detail=detail)

    return _load_report_payload(
        artifact_data,
        detail='Cached report artifact is outdated. Regenerate the report.',
        log_message=f'Report artifact invalid for run {run_id} during fetch',
    )


class CrossRunSummaryRequest(CamelModel):
    app_id: str
    provider: str | None = None
    model: str | None = None


@router.post("/cross-run-ai-summary", response_model=PlatformCrossRunNarrative)
async def generate_cross_run_ai_summary(
    request: CrossRunSummaryRequest,
    auth: AuthContext = require_permission('report:generate'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Generate AI summary of cross-run analytics."""
    analytics_config, profile = await _load_analytics_profile(db, request.app_id)
    if not analytics_config.capabilities.cross_run_ai_summary:
        raise HTTPException(status_code=404, detail=f"Cross-run AI summary is not enabled for app: {request.app_id}")

    from app.services.evaluators.llm_base import create_llm_provider, LoggingLLMWrapper
    from app.services.evaluators.runner_utils import save_api_log
    from app.services.evaluators.settings_helper import get_llm_settings_from_db

    cached_result = await db.execute(
        select(EvaluationAnalytics.analytics_data).where(
            EvaluationAnalytics.tenant_id == auth.tenant_id,
            EvaluationAnalytics.app_id == request.app_id,
            EvaluationAnalytics.scope == 'cross_run',
            EvaluationAnalytics.run_id.is_(None),
        )
    )
    cached_data = cached_result.scalar_one_or_none()
    if not cached_data:
        raise HTTPException(status_code=404, detail='No cached cross-run analytics. Refresh analytics first.')

    payload = _load_cross_run_payload(
        profile,
        cached_data,
        detail='Cached cross-run analytics are outdated. Refresh analytics first.',
        log_message=f'Cross-run analytics cache invalid for app {request.app_id} during AI summary generation',
    )
    stats, health_trend, top_issues, top_recommendations = _extract_cross_run_summary_inputs(payload, analytics_config)

    try:
        settings = await get_llm_settings_from_db(
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
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

        narrator_cls = profile.cross_run_summary_narrator_cls or CrossRunNarrator
        narrator = narrator_cls(llm)
        result = await narrator.generate(
            stats=stats,
            health_trend=health_trend,
            top_issues=top_issues,
            top_recommendations=top_recommendations,
        )

        if not result:
            raise HTTPException(
                status_code=500,
                detail="AI summary generation failed. Check LLM configuration.",
            )

        return adapt_cross_run_summary(result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Cross-run AI summary failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"AI summary generation failed: {str(e)}",
        )
