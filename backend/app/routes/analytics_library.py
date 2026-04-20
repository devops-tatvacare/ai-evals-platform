"""API routes for the analytics library — saved charts and dashboards."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.database import get_db
from app.models.analytics_chart import AnalyticsChart
from app.models.analytics_dashboard import AnalyticsDashboard
from app.models.mixins.shareable import Visibility
from app.schemas.base import CamelModel
from app.services.access_control import readable_scope_clause
from app.services.analytics.chart_executor import execute_chart

router = APIRouter(prefix="/api/analytics-library", tags=["analytics-library"])


# ── Schemas ──────────────────────────────────────────────────────────

class ChartRendererConfigIn(CamelModel):
    type: str
    x_key: str
    y_key: str | None = None
    series_keys: list[str] = []
    series: list[dict[str, str]] = []
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    legend_position: str | None = None
    color_map: dict[str, str] = {}


class ChartCanonicalConfigIn(CamelModel):
    kind: str
    spec: dict[str, Any]


class ChartConfigIn(CamelModel):
    renderer: ChartRendererConfigIn
    canonical: ChartCanonicalConfigIn | None = None

    @staticmethod
    def _legacy_renderer_keys() -> tuple[str, ...]:
        return (
            'type',
            'x_key',
            'xKey',
            'y_key',
            'yKey',
            'series_keys',
            'seriesKeys',
            'series',
            'title',
            'x_label',
            'xLabel',
            'y_label',
            'yLabel',
            'legend_position',
            'legendPosition',
            'color_map',
            'colorMap',
        )

    @staticmethod
    def _canonical_keys() -> tuple[str, ...]:
        return ('kind', 'spec')

    @model_validator(mode='before')
    @classmethod
    def _coerce_legacy_shape(cls, obj: Any) -> Any:
        if isinstance(obj, dict) and 'renderer' not in obj:
            renderer = {
                key: value
                for key, value in obj.items()
                if key in cls._legacy_renderer_keys()
            }
            canonical = {
                key: value
                for key, value in obj.items()
                if key in cls._canonical_keys() and value is not None
            } or None
            if renderer:
                obj = {
                    'renderer': renderer,
                    'canonical': canonical,
                }
        return obj

class SaveChartRequest(CamelModel):
    app_id: str
    title: str
    description: str = ""
    sql_query: str
    chart_config: ChartConfigIn
    source_question: str | None = None
    source_session_id: str | None = None
    visibility: str = "private"

class UpdateChartRequest(CamelModel):
    title: str | None = None
    description: str | None = None
    chart_config: ChartConfigIn | None = None
    visibility: str | None = None

class SaveDashboardRequest(CamelModel):
    app_id: str
    title: str
    description: str = ""
    chart_ids: list[str]       # ordered list of chart UUIDs
    source_session_id: str | None = None
    visibility: str = "private"

class UpdateDashboardRequest(CamelModel):
    title: str | None = None
    description: str | None = None
    chart_ids: list[str] | None = None
    visibility: str | None = None


# ── Access helpers ───────────────────────────────────────────────────

def _app_access_clause(model, auth: AuthContext):
    from sqlalchemy.sql import true, false
    if auth.is_owner:
        return true()
    if not auth.app_access:
        return false()
    return model.app_id.in_(tuple(sorted(auth.app_access)))


def _coerce_source_session_id(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(400, 'Invalid source_session_id')


# ── Chart routes ─────────────────────────────────────────────────────

@router.get("/charts")
async def list_charts(
    app_id: str = Query(...),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, app_id)
    q = (
        select(AnalyticsChart)
        .where(
            AnalyticsChart.app_id == app_id,
            AnalyticsChart.archived_at.is_(None),
            readable_scope_clause(AnalyticsChart, auth),
        )
        .order_by(AnalyticsChart.created_at.desc())
    )
    result = await db.execute(q)
    charts = result.scalars().all()
    return [_chart_to_dict(c) for c in charts]


@router.post("/charts")
async def save_chart(
    body: SaveChartRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, body.app_id)
    vis = Visibility.normalize(body.visibility) or Visibility.PRIVATE
    chart = AnalyticsChart(
        app_id=body.app_id,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        title=body.title,
        description=body.description,
        sql_query=body.sql_query,
        chart_config=body.chart_config.model_dump(by_alias=True),
        source_question=body.source_question,
        source_session_id=_coerce_source_session_id(body.source_session_id),
        visibility=vis,
        shared_by=auth.user_id if vis == Visibility.SHARED else None,
        shared_at=datetime.now(timezone.utc) if vis == Visibility.SHARED else None,
    )
    db.add(chart)
    await db.flush()
    await db.commit()
    return _chart_to_dict(chart)


@router.get("/charts/{chart_id}")
async def get_chart(
    chart_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    chart = await _get_readable_chart(db, chart_id, auth)
    return _chart_to_dict(chart)


@router.get("/charts/{chart_id}/data")
async def get_chart_data(
    chart_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Re-execute chart SQL and return live data."""
    chart = await _get_readable_chart(db, chart_id, auth)
    rows = await execute_chart(
        chart.sql_query,
        tenant_id=str(auth.tenant_id),
        app_id=chart.app_id,
    )
    return {"data": rows, "row_count": len(rows)}


@router.patch("/charts/{chart_id}")
async def update_chart(
    chart_id: str,
    body: UpdateChartRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    chart = await _get_owned_chart(db, chart_id, auth)
    if body.title is not None:
        chart.title = body.title
    if body.description is not None:
        chart.description = body.description
    if body.chart_config is not None:
        chart.chart_config = body.chart_config.model_dump(by_alias=True)
    if body.visibility is not None:
        vis = Visibility.normalize(body.visibility)
        if vis:
            chart.visibility = vis
            if vis == Visibility.SHARED:
                chart.shared_by = auth.user_id
                chart.shared_at = datetime.now(timezone.utc)
    await db.commit()
    return _chart_to_dict(chart)


@router.delete("/charts/{chart_id}")
async def archive_chart(
    chart_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    chart = await _get_owned_chart(db, chart_id, auth)
    chart.archived_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "archived"}


# ── Dashboard routes ─────────────────────────────────────────────────

@router.get("/dashboards")
async def list_dashboards(
    app_id: str = Query(...),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, app_id)
    q = (
        select(AnalyticsDashboard)
        .where(
            AnalyticsDashboard.app_id == app_id,
            AnalyticsDashboard.archived_at.is_(None),
            readable_scope_clause(AnalyticsDashboard, auth),
        )
        .order_by(AnalyticsDashboard.created_at.desc())
    )
    result = await db.execute(q)
    dashboards = result.scalars().all()
    return [_dashboard_to_dict(d) for d in dashboards]


@router.post("/dashboards")
async def save_dashboard(
    body: SaveDashboardRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, body.app_id)
    for chart_id in body.chart_ids:
        await _get_readable_chart(db, chart_id, auth)
    vis = Visibility.normalize(body.visibility) or Visibility.PRIVATE
    entries = [{"chart_id": cid, "width": "full", "order": i} for i, cid in enumerate(body.chart_ids)]
    dashboard = AnalyticsDashboard(
        app_id=body.app_id,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        title=body.title,
        description=body.description,
        chart_entries=entries,
        source_session_id=_coerce_source_session_id(body.source_session_id),
        visibility=vis,
        shared_by=auth.user_id if vis == Visibility.SHARED else None,
        shared_at=datetime.now(timezone.utc) if vis == Visibility.SHARED else None,
    )
    db.add(dashboard)
    await db.flush()
    await db.commit()
    return _dashboard_to_dict(dashboard)


@router.get("/dashboards/{dashboard_id}")
async def get_dashboard(
    dashboard_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    dashboard = await _get_readable_dashboard(db, dashboard_id, auth)
    return _dashboard_to_dict(dashboard)


@router.get("/dashboards/{dashboard_id}/data")
async def get_dashboard_data(
    dashboard_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Load dashboard and execute all chart queries. Returns chart configs + live data."""
    dashboard = await _get_readable_dashboard(db, dashboard_id, auth)

    results = []
    for entry in dashboard.chart_entries:
        chart_id = entry.get("chart_id")
        try:
            chart = await _get_readable_chart(db, chart_id, auth)
            rows = await execute_chart(
                chart.sql_query,
                tenant_id=str(auth.tenant_id),
                app_id=chart.app_id,
            )
            results.append({
                "chartId": str(chart.id),
                "title": chart.title,
                "chartConfig": _normalize_chart_config(chart.chart_config),
                "data": rows,
                "rowCount": len(rows),
                "width": entry.get("width", "full"),
                "order": entry.get("order", 0),
            })
        except Exception as e:
            results.append({
                "chartId": chart_id,
                "error": str(e),
                "width": entry.get("width", "full"),
                "order": entry.get("order", 0),
            })

    return {"dashboard": _dashboard_to_dict(dashboard), "charts": results}


@router.patch("/dashboards/{dashboard_id}")
async def update_dashboard(
    dashboard_id: str,
    body: UpdateDashboardRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    dashboard = await _get_owned_dashboard(db, dashboard_id, auth)
    if body.title is not None:
        dashboard.title = body.title
    if body.description is not None:
        dashboard.description = body.description
    if body.chart_ids is not None:
        for chart_id in body.chart_ids:
            await _get_readable_chart(db, chart_id, auth)
        dashboard.chart_entries = [
            {"chart_id": cid, "width": "full", "order": i}
            for i, cid in enumerate(body.chart_ids)
        ]
    if body.visibility is not None:
        vis = Visibility.normalize(body.visibility)
        if vis:
            dashboard.visibility = vis
            if vis == Visibility.SHARED:
                dashboard.shared_by = auth.user_id
                dashboard.shared_at = datetime.now(timezone.utc)
    await db.commit()
    return _dashboard_to_dict(dashboard)


@router.delete("/dashboards/{dashboard_id}")
async def archive_dashboard(
    dashboard_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    dashboard = await _get_owned_dashboard(db, dashboard_id, auth)
    dashboard.archived_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "archived"}


# ── Helpers ──────────────────────────────────────────────────────────

async def _get_readable_chart(db: AsyncSession, chart_id: str, auth: AuthContext) -> AnalyticsChart:
    chart = await db.scalar(
        select(AnalyticsChart).where(
            AnalyticsChart.id == chart_id,
            AnalyticsChart.archived_at.is_(None),
            readable_scope_clause(AnalyticsChart, auth),
            _app_access_clause(AnalyticsChart, auth),
        )
    )
    if not chart:
        raise HTTPException(404, "Chart not found")
    return chart


async def _get_owned_chart(db: AsyncSession, chart_id: str, auth: AuthContext) -> AnalyticsChart:
    chart = await db.scalar(
        select(AnalyticsChart).where(
            AnalyticsChart.id == chart_id,
            AnalyticsChart.tenant_id == auth.tenant_id,
            AnalyticsChart.user_id == auth.user_id,
            AnalyticsChart.archived_at.is_(None),
        )
    )
    if not chart:
        raise HTTPException(404, "Chart not found or not owned by you")
    return chart


async def _get_readable_dashboard(db: AsyncSession, dashboard_id: str, auth: AuthContext) -> AnalyticsDashboard:
    dashboard = await db.scalar(
        select(AnalyticsDashboard).where(
            AnalyticsDashboard.id == dashboard_id,
            AnalyticsDashboard.archived_at.is_(None),
            readable_scope_clause(AnalyticsDashboard, auth),
            _app_access_clause(AnalyticsDashboard, auth),
        )
    )
    if not dashboard:
        raise HTTPException(404, "Dashboard not found")
    return dashboard


async def _get_owned_dashboard(db: AsyncSession, dashboard_id: str, auth: AuthContext) -> AnalyticsDashboard:
    dashboard = await db.scalar(
        select(AnalyticsDashboard).where(
            AnalyticsDashboard.id == dashboard_id,
            AnalyticsDashboard.tenant_id == auth.tenant_id,
            AnalyticsDashboard.user_id == auth.user_id,
            AnalyticsDashboard.archived_at.is_(None),
        )
    )
    if not dashboard:
        raise HTTPException(404, "Dashboard not found or not owned by you")
    return dashboard


def _normalize_chart_config(raw: dict | None) -> dict:
    """Normalize stored chart config to camelCase for the frontend.

    Old charts were saved with snake_case keys (x_key, y_key). New charts
    use camelCase. Parsing through ChartConfigIn normalizes both formats
    because CamelModel accepts either via populate_by_name.
    """
    if not isinstance(raw, dict) or not raw:
        return raw or {}
    try:
        return ChartConfigIn(**raw).model_dump(by_alias=True)
    except Exception:
        return raw


def _chart_to_dict(chart: AnalyticsChart) -> dict:
    return {
        "id": str(chart.id),
        "appId": chart.app_id,
        "title": chart.title,
        "description": chart.description,
        "sqlQuery": chart.sql_query,
        "chartConfig": _normalize_chart_config(chart.chart_config),
        "sourceQuestion": chart.source_question,
        "sourceSessionId": str(chart.source_session_id) if chart.source_session_id else None,
        "visibility": chart.visibility.value if chart.visibility else "private",
        "createdAt": chart.created_at.isoformat() if chart.created_at else None,
        "updatedAt": chart.updated_at.isoformat() if chart.updated_at else None,
    }


def _dashboard_to_dict(dashboard: AnalyticsDashboard) -> dict:
    return {
        "id": str(dashboard.id),
        "appId": dashboard.app_id,
        "title": dashboard.title,
        "description": dashboard.description,
        "chartEntries": dashboard.chart_entries,
        "sourceSessionId": str(dashboard.source_session_id) if dashboard.source_session_id else None,
        "visibility": dashboard.visibility.value if dashboard.visibility else "private",
        "createdAt": dashboard.created_at.isoformat() if dashboard.created_at else None,
        "updatedAt": dashboard.updated_at.isoformat() if dashboard.updated_at else None,
    }
