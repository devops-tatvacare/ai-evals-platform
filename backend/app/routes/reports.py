"""Report generation endpoint."""

import html
import json
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from playwright.async_api import TimeoutError as PlaywrightTimeoutError, async_playwright
from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.app_scope import ensure_registered_app_access
from app.auth.context import AuthContext
from app.auth.permissions import require_permission, require_app_access
from app.auth.utils import create_access_token
from app.config import settings
from app.database import get_db
from app.models.eval_run import EvaluationRun
from app.models.report_config import ReportConfiguration
from app.models.report_run import ReportGenerationRun
from app.schemas.base import CamelModel
from app.schemas.reporting import ReportConfigResponse, ReportRunResponse
from app.services.access_control import readable_scope_clause
from app.services.reports.contracts.run_report import PlatformRunReportPayload
from app.services.reports.cache_validation import load_cached_payload_or_raise
from app.services.reports.config_models import ExportConfig
from app.services.reports.report_config_resolver import resolve_report_config
from app.services.reports.report_run_store import fetch_single_run_artifact, fetch_report_run_artifact

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])


# --- Response schemas ---

async def _get_visible_eval_run(
    db: AsyncSession,
    *,
    run_id: UUID,
    auth: AuthContext,
) -> EvaluationRun:
    run = await db.scalar(
        select(EvaluationRun).where(
            EvaluationRun.id == run_id,
            readable_scope_clause(EvaluationRun, auth),
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
) -> ReportGenerationRun:
    report_run = await db.scalar(select(ReportGenerationRun).where(ReportGenerationRun.id == report_run_id))
    if not report_run:
        raise HTTPException(status_code=404, detail="Report run not found")
    if report_run.source_eval_run_id is not None:
        await _get_visible_eval_run(db, run_id=report_run.source_eval_run_id, auth=auth)
    elif not await db.scalar(
        select(ReportGenerationRun.id).where(
            ReportGenerationRun.id == report_run_id,
            readable_scope_clause(ReportGenerationRun, auth),
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


def _ensure_pdf_export_enabled(report_config: ReportConfiguration) -> None:
    """Raise 404 if the report config has PDF export disabled."""
    export_config = ExportConfig.model_validate(report_config.export_config or {})
    if not export_config.enabled:
        raise HTTPException(status_code=404, detail="PDF export is not enabled for this report")


def _compose_print_bootstrap_script(print_token: str) -> str:
    return f"window.__REPORT_PRINT_TOKEN__ = {json.dumps(print_token)};"


def _resolve_pdf_render_base_url() -> str:
    return (settings.PDF_RENDER_BASE_URL or settings.APP_BASE_URL).rstrip('/')


def _pdf_export_failure_detail(exc: Exception) -> str:
    if isinstance(exc, PlaywrightTimeoutError):
        return "PDF generation timed out while waiting for the report print page to finish loading."
    return "PDF generation failed while rendering the report print view."


_PDF_HEADER_LABEL = "Evaluation Report"
_PDF_HEADER_TITLE_MAX_LEN = 100
_PDF_FOOTER_SUBTITLE_MAX_LEN = 120


def _truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + '…'


def build_pdf_running_meta(payload: PlatformRunReportPayload) -> dict[str, str]:
    """Distill the running header/footer text from a report payload.

    Header carries the run name (or report name fallback). Footer carries the
    eval type and the computed-at date so a reader who skips to page 6 still
    knows which run + when. Pure metadata read — no payload mutation.
    """
    metadata = payload.metadata
    title = metadata.run_name or metadata.report_name or 'Evaluation Report'

    subtitle_parts: list[str] = []
    if metadata.eval_type:
        subtitle_parts.append(metadata.eval_type)
    computed_at = getattr(metadata, 'computed_at', None)
    if computed_at:
        try:
            iso = computed_at if isinstance(computed_at, str) else computed_at.isoformat()
            dt = datetime.fromisoformat(iso.replace('Z', '+00:00'))
            subtitle_parts.append(dt.strftime('%-d %b %Y'))
        except (AttributeError, TypeError, ValueError):
            pass

    return {
        'title': _truncate(title, _PDF_HEADER_TITLE_MAX_LEN),
        'subtitle': _truncate(' · '.join(subtitle_parts), _PDF_FOOTER_SUBTITLE_MAX_LEN),
    }


def _compose_pdf_header_template(meta: dict[str, str]) -> str:
    """Running header HTML for Playwright's ``page.pdf(header_template=...)``.

    Playwright renders header/footer outside the React tree, so app CSS
    variables aren't available — color literals here are intentional and
    confined to this function.
    """
    title_safe = html.escape(meta.get('title', ''))
    label_safe = html.escape(_PDF_HEADER_LABEL)
    return (
        '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
        'font-size:8.5px;color:#64748b;width:100%;padding:0 14mm;'
        'display:flex;justify-content:space-between;align-items:center;">'
        f'<span style="text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">{label_safe}</span>'
        f'<span style="font-weight:500;color:#0f172a;">{title_safe}</span>'
        '</div>'
    )


def _compose_pdf_footer_template(meta: dict[str, str]) -> str:
    subtitle_safe = html.escape(meta.get('subtitle', ''))
    return (
        '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
        'font-size:8px;color:#94a3b8;width:100%;padding:0 14mm;'
        'display:flex;justify-content:space-between;align-items:center;">'
        f'<span>{subtitle_safe}</span>'
        '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>'
        '</div>'
    )


async def _render_pdf_via_print_route(
    *,
    print_path: str,
    auth: AuthContext,
    log_id: str,
    pdf_meta: dict[str, str] | None = None,
) -> bytes:
    """Render the React print route to PDF via headless Chromium.

    The print route (e.g. ``/print/report-runs/<id>``) is the SAME React
    component tree the user sees in the UI, so the PDF can never drift from
    the live report. Auth is bridged via a 60-second access token injected
    into the page before the app bootstraps.

    When ``pdf_meta`` is provided, a running header (run name) and footer
    (eval type · date · page X of Y) are stamped on every page so an
    out-of-context reader can still place the document.
    """
    base_url = _resolve_pdf_render_base_url()
    print_token = create_access_token(
        user_id=auth.user_id,
        tenant_id=auth.tenant_id,
        email=auth.email,
        role_id=auth.role_id,
        expires_minutes=1,
    )
    url = f"{base_url}{print_path}"

    display_header_footer = pdf_meta is not None
    header_template = _compose_pdf_header_template(pdf_meta) if pdf_meta else ''
    footer_template = _compose_pdf_footer_template(pdf_meta) if pdf_meta else ''

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-gpu"],
            )
            try:
                context = await browser.new_context(
                    viewport={"width": 1240, "height": 1754},
                    device_scale_factor=2,
                )
                await context.add_init_script(_compose_print_bootstrap_script(print_token))
                page = await context.new_page()
                # Belt-and-suspenders: pin the headless browser to light color
                # scheme BEFORE first paint so the inline theme bootstrap in
                # index.html (which reads `prefers-color-scheme` when no
                # localStorage entry exists) cannot accidentally select dark
                # mode on a host where the OS reports dark. Frontend also
                # forces `data-theme=light` on mount; this guards against the
                # window between page load and React hydration.
                await page.emulate_media(media="print", color_scheme="light")
                await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                await page.wait_for_selector(
                    'body[data-report-ready="true"]',
                    timeout=45_000,
                )
                report_error = await page.get_attribute('body', 'data-report-error')
                if report_error:
                    raise HTTPException(
                        status_code=500,
                        detail=f"PDF generation failed: {report_error}",
                    )
                pdf_bytes = await page.pdf(
                    format="A4",
                    print_background=True,
                    display_header_footer=display_header_footer,
                    header_template=header_template,
                    footer_template=footer_template,
                    margin={
                        # Header (~7mm) + breathing room → 18mm top.
                        # Footer (~6mm) + breathing room → 16mm bottom.
                        "top": "18mm" if display_header_footer else "12mm",
                        "right": "14mm",
                        "bottom": "16mm" if display_header_footer else "12mm",
                        "left": "14mm",
                    },
                )
            finally:
                await browser.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("PDF export failed for %s", log_id)
        raise HTTPException(
            status_code=500,
            detail=_pdf_export_failure_detail(e),
        )
    return pdf_bytes


@router.get("/report-configs", response_model=list[ReportConfigResponse])
async def list_report_configs(
    app_id: str = Query(...),
    scope: str = Query(...),
    auth: AuthContext = require_permission('insights:view'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(ReportConfiguration)
        .where(
            ReportConfiguration.app_id == app_id,
            ReportConfiguration.scope == scope,
            ReportConfiguration.status == 'active',
            readable_scope_clause(ReportConfiguration, auth),
        )
        .order_by(desc(ReportConfiguration.is_default), desc(ReportConfiguration.updated_at))
    )
    result = await db.execute(query)
    return result.scalars().all()


class BlueprintSectionInput(CamelModel):
    id: str
    type: str
    title: str
    variant: str | None = None


class BlueprintSaveRequest(CamelModel):
    app_id: str
    name: str
    sections: list[BlueprintSectionInput]
    source_session_id: UUID | None = None


@router.post("/report-configs", response_model=ReportConfigResponse, status_code=201)
async def create_report_config_from_blueprint(
    payload: BlueprintSaveRequest,
    auth: AuthContext = require_permission('report:generate'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Persist a Sherlock-composed blueprint as a reusable single-run ReportConfiguration.

    Bypasses the chat/LLM tool flow so the frontend Save button is deterministic.
    """
    if not payload.sections:
        raise HTTPException(status_code=400, detail="blueprint.sections cannot be empty")
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="blueprint.name cannot be empty")

    import uuid as _uuid

    report_id = f"custom-{_uuid.uuid4().hex[:8]}"
    presentation_config = {
        "rendererId": "platform-default",
        "layoutGroups": [],
        "density": "default",
        "designTokens": {},
        "themeTokens": {},
        "sections": [
            {
                "sectionId": s.id,
                "componentId": s.type,
                "title": s.title or "",
                "description": None,
                "variant": s.variant or "",
                "printable": True,
            }
            for s in payload.sections
        ],
    }
    export_config = {
        "enabled": True,
        "format": "pdf",
        "documentVariant": "platform-default",
        "sectionIds": [s.id for s in payload.sections],
    }
    source_session_id = (
        _uuid.UUID(str(payload.source_session_id))
        if payload.source_session_id is not None
        else None
    )

    config = ReportConfiguration(
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=payload.app_id,
        report_id=report_id,
        scope="single_run",
        name=payload.name,
        description="Custom report created via report builder",
        source_session_id=source_session_id,
        presentation_config=presentation_config,
        narrative_config={"enabled": False},
        export_config=export_config,
    )
    db.add(config)
    await db.flush()
    await db.commit()
    await db.refresh(config)
    return config


class BlueprintUpdateRequest(CamelModel):
    name: str | None = None
    description: str | None = None
    is_default: bool | None = None


async def _load_owned_report_config(
    db: AsyncSession,
    *,
    config_id: UUID,
    auth: AuthContext,
) -> ReportConfiguration:
    """Fetch a ReportConfiguration the caller is allowed to mutate (owner within tenant)."""
    stmt = select(ReportConfiguration).where(
        ReportConfiguration.id == config_id,
        ReportConfiguration.tenant_id == auth.tenant_id,
    )
    result = await db.execute(stmt)
    config = result.scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    if config.user_id != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the blueprint owner can modify it")
    if config.status != 'active':
        raise HTTPException(status_code=404, detail="Blueprint not found")
    return config


@router.patch("/report-configs/{config_id}", response_model=ReportConfigResponse)
async def update_report_config(
    config_id: UUID,
    payload: BlueprintUpdateRequest,
    auth: AuthContext = require_permission('report:generate'),
    db: AsyncSession = Depends(get_db),
):
    """Rename / re-describe / promote a user-owned blueprint.

    Setting is_default=True un-defaults the caller's other blueprints for the
    same (app, scope). Does not touch system-seeded defaults (different user_id).
    """
    config = await _load_owned_report_config(db, config_id=config_id, auth=auth)

    changed = False
    if payload.name is not None:
        trimmed = payload.name.strip()
        if not trimmed:
            raise HTTPException(status_code=400, detail="blueprint.name cannot be empty")
        if trimmed != config.name:
            config.name = trimmed
            changed = True
    if payload.description is not None and payload.description != config.description:
        config.description = payload.description
        changed = True
    if payload.is_default is True and not config.is_default:
        await db.execute(
            update(ReportConfiguration)
            .where(
                ReportConfiguration.tenant_id == auth.tenant_id,
                ReportConfiguration.user_id == auth.user_id,
                ReportConfiguration.app_id == config.app_id,
                ReportConfiguration.scope == config.scope,
                ReportConfiguration.id != config.id,
                ReportConfiguration.is_default.is_(True),
            )
            .values(is_default=False)
        )
        config.is_default = True
        changed = True
    elif payload.is_default is False and config.is_default:
        config.is_default = False
        changed = True

    if changed:
        await db.commit()
        await db.refresh(config)
    return config


@router.delete("/report-configs/{config_id}", status_code=204)
async def archive_report_config(
    config_id: UUID,
    auth: AuthContext = require_permission('report:generate'),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete (archive) a user-owned blueprint so it stops appearing in pickers."""
    config = await _load_owned_report_config(db, config_id=config_id, auth=auth)
    config.status = 'archived'
    config.is_default = False
    await db.commit()


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
        select(ReportGenerationRun)
        .where(
            ReportGenerationRun.app_id == app_id,
            ReportGenerationRun.scope == scope,
            ReportGenerationRun.tenant_id == auth.tenant_id,
        )
        .order_by(desc(ReportGenerationRun.completed_at), desc(ReportGenerationRun.created_at))
        .limit(limit)
    )
    if source_eval_run_id is None:
        query = query.where(readable_scope_clause(ReportGenerationRun, auth))
    if source_eval_run_id is not None:
        query = query.where(ReportGenerationRun.source_eval_run_id == source_eval_run_id)
    if report_id:
        query = query.where(ReportGenerationRun.report_id == report_id)
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
    _ensure_pdf_export_enabled(report_config)

    payload = _load_report_payload(
        artifact.artifact_data,
        detail='Cached report artifact is outdated. Regenerate the report before exporting.',
        log_message=f'Report artifact invalid for report run {report_run_id} during PDF export',
    )

    pdf_bytes = await _render_pdf_via_print_route(
        print_path=f"/print/report-runs/{report_run_id}",
        auth=auth,
        log_id=f"report run {report_run_id}",
        pdf_meta=build_pdf_running_meta(payload),
    )

    short_id = str(report_run_id)[:8]
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="eval-report-{short_id}.pdf"',
        },
    )


@router.get("/{run_id}/export-pdf")
async def export_report_pdf(
    run_id: str,
    report_id: str | None = Query(None),
    auth: AuthContext = require_permission('evaluation:export'),
    db: AsyncSession = Depends(get_db),
):
    """Export the latest single-run report as PDF by rendering the React print route."""
    run = await _get_visible_eval_run(db, run_id=UUID(run_id), auth=auth)

    report_config = await resolve_report_config(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=run.app_id,
        scope='single_run',
        report_id=report_id,
    )
    _ensure_pdf_export_enabled(report_config)

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
            select(ReportGenerationRun).where(
                ReportGenerationRun.app_id == run.app_id,
                ReportGenerationRun.scope == 'single_run',
                ReportGenerationRun.report_id == report_config.report_id,
                ReportGenerationRun.source_eval_run_id == UUID(run_id),
                ReportGenerationRun.status == 'completed',
                ReportGenerationRun.tenant_id == auth.tenant_id,
            )
            .order_by(desc(ReportGenerationRun.completed_at), desc(ReportGenerationRun.created_at))
        )
    if report_run is None:
        raise HTTPException(status_code=404, detail="Report run not found")

    pdf_bytes = await _render_pdf_via_print_route(
        print_path=f"/print/report-runs/{report_run.id}",
        auth=auth,
        log_id=f"run {run_id}",
        pdf_meta=build_pdf_running_meta(payload),
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
