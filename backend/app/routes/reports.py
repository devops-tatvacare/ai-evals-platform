"""Report generation endpoint."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from playwright.async_api import async_playwright
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.eval_run import EvalRun
from app.services.reports import ReportService
from app.services.reports.pdf_template import render_report_html
from app.services.reports.schemas import ReportPayload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/{run_id}/export-pdf")
async def export_report_pdf(run_id: str, db: AsyncSession = Depends(get_db)):
    """Export report as PDF via headless browser rendering of self-contained HTML."""
    # Verify run exists and has a cached report
    stmt = select(EvalRun).where(EvalRun.id == UUID(run_id))
    result = await db.execute(stmt)
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Evaluation run not found")
    if not run.report_cache:
        raise HTTPException(
            status_code=400,
            detail="Report has not been generated yet. Generate the report first.",
        )

    # Cache stores snake_case keys; template expects camelCase.
    # Validate into Pydantic model and re-dump with aliases.
    try:
        payload = ReportPayload.model_validate(run.report_cache)
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
        stmt = select(EvalRun).where(EvalRun.id == UUID(run_id))
        result = await db.execute(stmt)
        run = result.scalar_one_or_none()
        if not run:
            raise HTTPException(status_code=404, detail="Evaluation run not found")
        if not run.report_cache:
            raise HTTPException(status_code=404, detail="No cached report")
        try:
            payload = ReportPayload.model_validate(run.report_cache)
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
