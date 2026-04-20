"""Cost & usage API.

Two grantable permissions gate this surface:

    cost:view   — read cost/usage data (dashboard, chips, pricing rows,
                  refresh-history drill-downs).
    cost:edit   — mutate global pricing rows, trigger models.dev refresh,
                  run the rollup backfill.

Reads are tenant-scoped for every caller (no cross-tenant peeking via a
super-admin gate). Mutations touch the global pricing catalog and are
audit-logged; the rate limit on ``POST /api/cost/pricing/refresh`` remains
1/hour/user.

Endpoint bundle shapes mirror §9.3 of the hardened spec:

    GET   /api/cost/overview                        — KPI row + spend-by-app
    GET   /api/cost/spend                           — grouped spend bundle
    GET   /api/cost/entities                        — paginated expensive entities
    GET   /api/cost/entity/{owner_type}/{owner_id}  — single entity drill-down
    POST  /api/cost/entity/batch                    — CostChip batch lookup
    GET   /api/cost/calls                           — paginated raw calls
    GET   /api/cost/calls/{id}                      — single call drawer
    GET   /api/cost/efficiency                      — cache / error / unpriced bundle
    GET   /api/cost/pricing/bundle                  — pricing rows + refresh history
    POST  /api/cost/pricing                         — new pricing row (cost:edit)
    PATCH /api/cost/pricing/{id}                    — close current + insert new (cost:edit)
    POST  /api/cost/pricing/refresh                 — models.dev refresh (cost:edit + 1/hour)
    GET   /api/cost/pricing/refresh/{snapshot_id}   — snapshot drill
    POST  /api/admin/cost-rollup/backfill           — ops (cost:edit)
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import Field
from slowapi import Limiter
from sqlalchemy import and_, case, desc, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext
from app.auth.rate_limits import actor_or_ip_rate_limit_key
from app.config import settings
from app.auth.permissions import require_permission
from app.database import get_db
from app.models.cost import (
    LlmUsage,
    LlmUsageDailyRollup,
    ModelPricing,
    ModelsDevCatalog,
    ModelsDevSnapshot,
)
from app.models.user import User
from app.schemas.base import CamelModel
from app.services.audit import write_audit_log
from app.services.cost_tracking.pricing_cache import pricing_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/cost', tags=['cost'])
admin_router = APIRouter(prefix='/api/admin', tags=['admin'])

# Authenticated cost mutations should rate-limit by actor when possible so a
# shared ingress IP does not block unrelated users in production.
limiter = Limiter(key_func=actor_or_ip_rate_limit_key)

_DEFAULT_RANGE_DAYS = 7
_MAX_BATCH_ITEMS = 100
_CALLS_PAGE_MAX = 200
_ENTITIES_PAGE_MAX = 100


# ── Shared helpers ──────────────────────────────────────────────────


def _parse_range(range_param: str | None) -> tuple[datetime, datetime]:
    """Parse a ``range`` query param into a ``(start, end)`` UTC window.

    Accepts ``24h`` / ``7d`` / ``30d`` / ``mtd`` / ``YYYY-MM-DD:YYYY-MM-DD``.
    Default is 7 days.
    """
    now = datetime.now(timezone.utc)
    if not range_param:
        return (now - timedelta(days=_DEFAULT_RANGE_DAYS), now)
    value = range_param.strip().lower()
    if value == '24h':
        return (now - timedelta(hours=24), now)
    if value == '7d':
        return (now - timedelta(days=7), now)
    if value == '30d':
        return (now - timedelta(days=30), now)
    if value == 'mtd':
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return (start, now)
    if ':' in value:
        try:
            start_str, end_str = value.split(':', 1)
            start = datetime.fromisoformat(start_str).replace(tzinfo=timezone.utc)
            end = datetime.fromisoformat(end_str).replace(tzinfo=timezone.utc)
            if end <= start:
                raise ValueError('end <= start')
            return (start, end)
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail=f'Invalid range: {exc}')
    raise HTTPException(status_code=400, detail=f'Unsupported range token: {range_param}')


def _tenant_scope_clause(auth: AuthContext):
    """Every caller — including Owners — is scoped to their own tenant.

    Cross-tenant visibility is intentionally not a cost-permission concern;
    platform operators who need all-tenant views should use a different
    tool rather than overload `cost:view`.
    """
    return LlmUsage.tenant_id == auth.tenant_id


def _apply_tenant_scope(stmt, auth: AuthContext, tenant_column):
    return stmt.where(tenant_column == auth.tenant_id)


def _apply_optional_fact_filters(
    filters: list[Any],
    source,
    *,
    app_id: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> list[Any]:
    if app_id:
        filters.append(source.app_id == app_id)
    if provider:
        filters.append(source.provider == provider)
    if model:
        filters.append(source.model == model)
    return filters


def _utc_day_start(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def _next_utc_day_start(value: datetime) -> datetime:
    return _utc_day_start(value) + timedelta(days=1)


def _split_range_for_rollup(
    start: datetime,
    end: datetime,
) -> tuple[tuple[date, date] | None, list[tuple[datetime, datetime]]]:
    """Return ``(full_day_range, raw_windows)`` for an exact aggregate query.

    Rollups are daily UTC buckets, so any partial boundary day must still be
    read from raw ``llm_usage`` to keep ``24h`` / custom windows exact.
    """
    raw_windows: list[tuple[datetime, datetime]] = []

    full_day_start = start
    if start != _utc_day_start(start):
        boundary_end = min(end, _next_utc_day_start(start))
        if boundary_end > start:
            raw_windows.append((start, boundary_end))
        full_day_start = _next_utc_day_start(start)

    full_day_end = end
    end_day_start = _utc_day_start(end)
    if end != end_day_start:
        if end_day_start > full_day_start:
            raw_windows.append((end_day_start, end))
        full_day_end = end_day_start

    full_day_range: tuple[date, date] | None = None
    if full_day_end > full_day_start:
        full_day_range = (full_day_start.date(), full_day_end.date())

    return full_day_range, raw_windows


# ── Response shapes ─────────────────────────────────────────────────


class CostKpi(CamelModel):
    total_cost_usd: float
    total_tokens: int
    total_calls: int
    error_calls: int
    pricing_fallback_calls: int


class TimeSeriesPoint(CamelModel):
    day: str
    cost_usd: float
    tokens: int
    calls: int


class GroupedSpend(CamelModel):
    key: str
    cost_usd: float
    tokens: int
    calls: int


class CostOverviewResponse(CamelModel):
    kpis: CostKpi
    time_series: list[TimeSeriesPoint]
    spend_by_app: list[GroupedSpend]
    spend_by_purpose: list[GroupedSpend]
    signals: dict[str, Any]
    computed_at: datetime


class SpendBundleResponse(CamelModel):
    by_app: list[GroupedSpend]
    by_purpose: list[GroupedSpend]
    top_models: list[GroupedSpend]
    top_users: list[GroupedSpend]
    computed_at: datetime


class EntityRow(CamelModel):
    owner_type: str
    owner_id: uuid.UUID | None
    cost_usd: float
    total_tokens: int
    call_count: int
    first_at: datetime | None
    last_at: datetime | None


class EntityListResponse(CamelModel):
    items: list[EntityRow]
    total: int
    page: int
    page_size: int


class EntityDrillDown(CamelModel):
    owner_type: str
    owner_id: uuid.UUID | None
    cost_usd: float
    total_tokens: int
    call_count: int
    by_purpose: list[GroupedSpend]
    by_model: list[GroupedSpend]


class BatchItemRequest(CamelModel):
    owner_type: str
    owner_id: uuid.UUID


class BatchLookupRequest(CamelModel):
    range: str | None = None
    app_id: str | None = None
    provider: str | None = None
    model: str | None = None
    items: list[BatchItemRequest] = Field(default_factory=list)


class ChipSummary(CamelModel):
    cost_usd: float
    total_tokens: int
    call_count: int


class CallRow(CamelModel):
    id: uuid.UUID
    created_at: datetime
    tenant_id: uuid.UUID
    user_id: uuid.UUID | None
    app_id: str
    subsystem: str | None
    owner_type: str
    owner_id: uuid.UUID | None
    provider: str
    model: str
    call_purpose: str | None
    status: str
    input_tokens: int
    output_tokens: int
    cached_read_tokens: int
    reasoning_tokens: int
    total_tokens: int
    cost_usd: float
    pricing_fallback: bool
    duration_ms: int | None
    correlation_id: uuid.UUID | None


class CallsListResponse(CamelModel):
    items: list[CallRow]
    total: int
    page: int
    page_size: int


class CallDetail(CallRow):
    cost_breakdown: dict[str, Any] | None
    modality_details: dict[str, Any] | None
    server_tool_usage: dict[str, Any] | None
    finish_reason: str | None
    request_id: str | None
    error_code: str | None
    traffic_type: str | None


class EfficiencyGaugePoint(CamelModel):
    label: str
    value: float


class EfficiencyBundleResponse(CamelModel):
    cache_gauge: list[EfficiencyGaugePoint]
    cache_by_purpose: list[GroupedSpend]
    error_gauge: list[EfficiencyGaugePoint]
    error_by_code: list[GroupedSpend]
    unpriced_calls: list[GroupedSpend]
    reasoning_by_model: list[GroupedSpend]
    computed_at: datetime


class PricingRowOut(CamelModel):
    id: uuid.UUID
    provider: str
    model: str
    effective_from: datetime
    effective_to: datetime | None
    input_per_1m_usd: float
    output_per_1m_usd: float
    cached_read_per_1m_usd: float
    cache_write_5m_per_1m_usd: float
    cache_write_1h_per_1m_usd: float
    reasoning_per_1m_usd: float
    audio_input_per_1m_usd: float | None
    audio_input_per_minute_usd: float | None
    image_input_per_1m_usd: float | None
    server_tool_prices: dict[str, Any] | None
    currency: str
    source: str
    source_snapshot_id: uuid.UUID | None
    source_model_id: str | None
    notes: str | None
    created_at: datetime
    created_by: uuid.UUID | None


class CatalogRowOut(CamelModel):
    provider: str
    model: str
    display_name: str | None
    family: str | None
    context_limit: int | None
    output_limit: int | None
    supports_reasoning: bool
    supports_tool_call: bool
    modalities_input: list[str]
    modalities_output: list[str]
    status: str
    last_seen_at: datetime


class SnapshotRowOut(CamelModel):
    id: uuid.UUID
    fetched_at: datetime
    status: str
    added_count: int
    updated_count: int
    unchanged_count: int
    removed_count: int
    payload_hash: str
    error_message: str | None
    duration_ms: int | None


class PricingBundleResponse(CamelModel):
    pricing: list[PricingRowOut]
    catalog: list[CatalogRowOut]
    refresh_history: list[SnapshotRowOut]


class PricingCreateRequest(CamelModel):
    provider: str
    model: str
    input_per_1m_usd: float = 0
    output_per_1m_usd: float = 0
    cached_read_per_1m_usd: float = 0
    cache_write_5m_per_1m_usd: float = 0
    cache_write_1h_per_1m_usd: float = 0
    reasoning_per_1m_usd: float = 0
    audio_input_per_1m_usd: float | None = None
    audio_input_per_minute_usd: float | None = None
    image_input_per_1m_usd: float | None = None
    server_tool_prices: dict[str, Any] | None = None
    currency: str = 'USD'
    notes: str | None = None


class PricingPatchRequest(CamelModel):
    input_per_1m_usd: float | None = None
    output_per_1m_usd: float | None = None
    cached_read_per_1m_usd: float | None = None
    cache_write_5m_per_1m_usd: float | None = None
    cache_write_1h_per_1m_usd: float | None = None
    reasoning_per_1m_usd: float | None = None
    audio_input_per_1m_usd: float | None = None
    audio_input_per_minute_usd: float | None = None
    image_input_per_1m_usd: float | None = None
    server_tool_prices: dict[str, Any] | None = None
    notes: str | None = None


class RefreshDiff(CamelModel):
    snapshot_id: uuid.UUID
    status: str
    added_count: int
    updated_count: int
    unchanged_count: int
    removed_count: int
    model_count: int
    payload_hash: str
    deduped: bool


class BackfillRequest(CamelModel):
    start: date
    end: date


class UnpricedBackfillRequest(CamelModel):
    limit: int | None = None
    all_tenants: bool = False


class UnpricedBackfillResponse(CamelModel):
    scanned: int
    repriced: int
    still_unpriced: int
    days_rolled: int


class BackfillResponse(CamelModel):
    days_processed: int
    rows_upserted: int
    tenants: list[uuid.UUID]


# ── Overview + Spend + Efficiency bundles ──────────────────────────


def _sum_column(column, label: str):
    return func.coalesce(func.sum(column), 0).label(label)


@router.get('/overview', response_model=CostOverviewResponse)
async def cost_overview(
    range: str | None = Query(None),
    app_id: str | None = Query(None),
    provider: str | None = Query(None),
    model: str | None = Query(None),
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> CostOverviewResponse:
    start, end = _parse_range(range)
    full_day_range, raw_windows = _split_range_for_rollup(start, end)

    # ── KPI bundle ───────────────────────────────────────────────
    total_cost = 0.0
    total_tokens = 0
    total_calls = 0
    error_calls = 0

    if full_day_range is not None:
        rollup_filters = _apply_optional_fact_filters(
            [
                LlmUsageDailyRollup.day >= full_day_range[0],
                LlmUsageDailyRollup.day < full_day_range[1],
            ],
            LlmUsageDailyRollup,
            app_id=app_id,
            provider=provider,
            model=model,
        )
        kpi_rollup_stmt = select(
            _sum_column(LlmUsageDailyRollup.cost_usd, 'cost_usd'),
            _sum_column(LlmUsageDailyRollup.total_tokens, 'tokens'),
            _sum_column(LlmUsageDailyRollup.call_count, 'calls'),
            _sum_column(
                case(
                    (LlmUsageDailyRollup.status != 'ok', LlmUsageDailyRollup.call_count),
                    else_=0,
                ),
                'errors',
            ),
        ).where(and_(*rollup_filters))
        kpi_rollup_stmt = _apply_tenant_scope(
            kpi_rollup_stmt,
            auth,
            LlmUsageDailyRollup.tenant_id,
        )
        rollup_row = (await db.execute(kpi_rollup_stmt)).one()
        total_cost += _to_float(rollup_row[0])
        total_tokens += int(rollup_row[1] or 0)
        total_calls += int(rollup_row[2] or 0)
        error_calls += int(rollup_row[3] or 0)

    for raw_start, raw_end in raw_windows:
        raw_filters = _apply_optional_fact_filters(
            [
                LlmUsage.created_at >= raw_start,
                LlmUsage.created_at < raw_end,
            ],
            LlmUsage,
            app_id=app_id,
            provider=provider,
            model=model,
        )
        kpi_raw_stmt = select(
            _sum_column(LlmUsage.cost_usd, 'cost_usd'),
            _sum_column(LlmUsage.total_tokens, 'tokens'),
            func.count(LlmUsage.id).label('calls'),
            func.sum(case((LlmUsage.status != 'ok', 1), else_=0)).label('errors'),
        ).where(and_(*raw_filters))
        kpi_raw_stmt = _apply_tenant_scope(kpi_raw_stmt, auth, LlmUsage.tenant_id)
        raw_row = (await db.execute(kpi_raw_stmt)).one()
        total_cost += _to_float(raw_row[0])
        total_tokens += int(raw_row[1] or 0)
        total_calls += int(raw_row[2] or 0)
        error_calls += int(raw_row[3] or 0)

    fallback_filters = _apply_optional_fact_filters(
        [
            LlmUsage.created_at >= start,
            LlmUsage.created_at < end,
            LlmUsage.pricing_fallback.is_(True),
        ],
        LlmUsage,
        app_id=app_id,
        provider=provider,
        model=model,
    )
    fallback_stmt = select(func.count(LlmUsage.id)).where(and_(*fallback_filters))
    fallback_stmt = _apply_tenant_scope(fallback_stmt, auth, LlmUsage.tenant_id)
    pricing_fallback_calls = int((await db.execute(fallback_stmt)).scalar_one() or 0)
    kpis = CostKpi(
        total_cost_usd=total_cost,
        total_tokens=total_tokens,
        total_calls=total_calls,
        error_calls=error_calls,
        pricing_fallback_calls=pricing_fallback_calls,
    )

    # ── Time series (daily buckets) ──────────────────────────────
    time_series_map: dict[str, dict[str, float | int]] = {}
    if full_day_range is not None:
        ts_rollup_filters = _apply_optional_fact_filters(
            [
                LlmUsageDailyRollup.day >= full_day_range[0],
                LlmUsageDailyRollup.day < full_day_range[1],
            ],
            LlmUsageDailyRollup,
            app_id=app_id,
            provider=provider,
            model=model,
        )
        ts_rollup_stmt = (
            select(
                LlmUsageDailyRollup.day,
                _sum_column(LlmUsageDailyRollup.cost_usd, 'cost_usd'),
                _sum_column(LlmUsageDailyRollup.total_tokens, 'tokens'),
                _sum_column(LlmUsageDailyRollup.call_count, 'calls'),
            )
            .where(and_(*ts_rollup_filters))
            .group_by(LlmUsageDailyRollup.day)
            .order_by(LlmUsageDailyRollup.day.asc())
        )
        ts_rollup_stmt = _apply_tenant_scope(
            ts_rollup_stmt,
            auth,
            LlmUsageDailyRollup.tenant_id,
        )
        for row in (await db.execute(ts_rollup_stmt)).all():
            day_key = row[0].isoformat() if row[0] else ''
            time_series_map[day_key] = {
                'cost_usd': _to_float(row[1]),
                'tokens': int(row[2] or 0),
                'calls': int(row[3] or 0),
            }

    day_expr = func.date_trunc('day', LlmUsage.created_at).label('day')
    for raw_start, raw_end in raw_windows:
        ts_raw_filters = _apply_optional_fact_filters(
            [
                LlmUsage.created_at >= raw_start,
                LlmUsage.created_at < raw_end,
            ],
            LlmUsage,
            app_id=app_id,
            provider=provider,
            model=model,
        )
        ts_raw_stmt = (
            select(
                day_expr,
                _sum_column(LlmUsage.cost_usd, 'cost_usd'),
                _sum_column(LlmUsage.total_tokens, 'tokens'),
                func.count(LlmUsage.id).label('calls'),
            )
            .where(and_(*ts_raw_filters))
            .group_by(day_expr)
            .order_by(day_expr.asc())
        )
        ts_raw_stmt = _apply_tenant_scope(ts_raw_stmt, auth, LlmUsage.tenant_id)
        for row in (await db.execute(ts_raw_stmt)).all():
            day_key = row[0].date().isoformat() if row[0] else ''
            bucket = time_series_map.setdefault(day_key, {'cost_usd': 0.0, 'tokens': 0, 'calls': 0})
            bucket['cost_usd'] = float(bucket['cost_usd']) + _to_float(row[1])
            bucket['tokens'] = int(bucket['tokens']) + int(row[2] or 0)
            bucket['calls'] = int(bucket['calls']) + int(row[3] or 0)

    time_series = [
        TimeSeriesPoint(
            day=day_key,
            cost_usd=float(values['cost_usd']),
            tokens=int(values['tokens']),
            calls=int(values['calls']),
        )
        for day_key, values in sorted(time_series_map.items(), key=lambda item: item[0])
    ]

    # ── Spend by app / purpose ───────────────────────────────────
    spend_by_app = await _grouped_spend(
        db,
        auth,
        start,
        end,
        LlmUsage.app_id,
        rollup_group_column=LlmUsageDailyRollup.app_id,
        app_id=app_id,
        provider=provider,
        model=model,
    )
    spend_by_purpose = await _grouped_spend(
        db,
        auth,
        start,
        end,
        func.coalesce(LlmUsage.call_purpose, 'unspecified'),
        rollup_group_column=func.coalesce(LlmUsageDailyRollup.call_purpose, 'unspecified'),
        app_id=app_id,
        provider=provider,
        model=model,
    )

    signals: dict[str, Any] = {}
    if kpis.pricing_fallback_calls:
        signals['unpriced_calls'] = kpis.pricing_fallback_calls
    if kpis.error_calls:
        signals['error_calls'] = kpis.error_calls

    return CostOverviewResponse(
        kpis=kpis,
        time_series=time_series,
        spend_by_app=spend_by_app,
        spend_by_purpose=spend_by_purpose,
        signals=signals,
        computed_at=datetime.now(timezone.utc),
    )


@router.get('/spend', response_model=SpendBundleResponse)
async def cost_spend(
    range: str | None = Query(None),
    app_id: str | None = Query(None),
    provider: str | None = Query(None),
    model: str | None = Query(None),
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> SpendBundleResponse:
    start, end = _parse_range(range)

    by_app = await _grouped_spend(
        db,
        auth,
        start,
        end,
        LlmUsage.app_id,
        rollup_group_column=LlmUsageDailyRollup.app_id,
        app_id=app_id,
        provider=provider,
        model=model,
    )
    by_purpose = await _grouped_spend(
        db,
        auth,
        start,
        end,
        func.coalesce(LlmUsage.call_purpose, 'unspecified'),
        rollup_group_column=func.coalesce(LlmUsageDailyRollup.call_purpose, 'unspecified'),
        app_id=app_id,
        provider=provider,
        model=model,
    )
    top_models = await _grouped_spend(
        db,
        auth,
        start,
        end,
        LlmUsage.model,
        rollup_group_column=LlmUsageDailyRollup.model,
        app_id=app_id,
        provider=provider,
        model=model,
        limit=10,
    )
    top_users = await _top_users_by_email(
        db,
        auth,
        start,
        end,
        app_id=app_id,
        provider=provider,
        model=model,
        limit=10,
    )

    return SpendBundleResponse(
        by_app=by_app,
        by_purpose=by_purpose,
        top_models=top_models,
        top_users=top_users,
        computed_at=datetime.now(timezone.utc),
    )


@router.get('/efficiency', response_model=EfficiencyBundleResponse)
async def cost_efficiency(
    range: str | None = Query(None),
    app_id: str | None = Query(None),
    provider: str | None = Query(None),
    model: str | None = Query(None),
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> EfficiencyBundleResponse:
    start, end = _parse_range(range)
    full_day_range, raw_windows = _split_range_for_rollup(start, end)

    cached_read = 0
    uncached = 0
    total_calls = 0
    errors = 0

    if full_day_range is not None:
        rollup_filters = _apply_optional_fact_filters(
            [
                LlmUsageDailyRollup.day >= full_day_range[0],
                LlmUsageDailyRollup.day < full_day_range[1],
            ],
            LlmUsageDailyRollup,
            app_id=app_id,
            provider=provider,
            model=model,
        )
        cache_rollup_stmt = select(
            _sum_column(LlmUsageDailyRollup.cached_read_tokens, 'cached_read'),
            _sum_column(LlmUsageDailyRollup.input_tokens, 'input'),
            _sum_column(LlmUsageDailyRollup.call_count, 'calls'),
            _sum_column(
                case(
                    (LlmUsageDailyRollup.status != 'ok', LlmUsageDailyRollup.call_count),
                    else_=0,
                ),
                'errors',
            ),
        ).where(and_(*rollup_filters))
        cache_rollup_stmt = _apply_tenant_scope(
            cache_rollup_stmt,
            auth,
            LlmUsageDailyRollup.tenant_id,
        )
        rollup_row = (await db.execute(cache_rollup_stmt)).one()
        cached_read += int(rollup_row[0] or 0)
        uncached += int(rollup_row[1] or 0)
        total_calls += int(rollup_row[2] or 0)
        errors += int(rollup_row[3] or 0)

    for raw_start, raw_end in raw_windows:
        raw_filters = _apply_optional_fact_filters(
            [
                LlmUsage.created_at >= raw_start,
                LlmUsage.created_at < raw_end,
            ],
            LlmUsage,
            app_id=app_id,
            provider=provider,
            model=model,
        )
        cache_raw_stmt = select(
            _sum_column(LlmUsage.cached_read_tokens, 'cached_read'),
            _sum_column(LlmUsage.input_tokens, 'input'),
            func.count(LlmUsage.id).label('calls'),
            func.sum(case((LlmUsage.status != 'ok', 1), else_=0)).label('errors'),
        ).where(and_(*raw_filters))
        cache_raw_stmt = _apply_tenant_scope(cache_raw_stmt, auth, LlmUsage.tenant_id)
        raw_row = (await db.execute(cache_raw_stmt)).one()
        cached_read += int(raw_row[0] or 0)
        uncached += int(raw_row[1] or 0)
        total_calls += int(raw_row[2] or 0)
        errors += int(raw_row[3] or 0)

    total_input = cached_read + uncached
    cache_gauge = [
        EfficiencyGaugePoint(label='cached_read', value=float(cached_read)),
        EfficiencyGaugePoint(
            label='hit_rate',
            value=round(cached_read / total_input, 4) if total_input else 0.0,
        ),
    ]

    cache_by_purpose = await _grouped_spend(
        db,
        auth,
        start,
        end,
        func.coalesce(LlmUsage.call_purpose, 'unspecified'),
        rollup_group_column=func.coalesce(LlmUsageDailyRollup.call_purpose, 'unspecified'),
        app_id=app_id,
        provider=provider,
        model=model,
        sort_metric='tokens',
    )
    error_gauge = [
        EfficiencyGaugePoint(label='errors', value=float(errors)),
        EfficiencyGaugePoint(
            label='error_rate',
            value=round(errors / total_calls, 4) if total_calls else 0.0,
        ),
    ]

    error_by_code = await _grouped_spend(
        db,
        auth,
        start,
        end,
        func.coalesce(LlmUsage.error_code, 'unknown'),
        app_id=app_id,
        provider=provider,
        model=model,
        raw_extra_filters=[LlmUsage.status != 'ok'],
        sort_metric='calls',
        use_rollup=False,
    )

    unpriced_calls = await _grouped_spend(
        db,
        auth,
        start,
        end,
        LlmUsage.model,
        app_id=app_id,
        provider=provider,
        model=model,
        raw_extra_filters=[LlmUsage.pricing_fallback.is_(True)],
        sort_metric='calls',
        use_rollup=False,
    )

    reasoning_by_model = await _grouped_spend(
        db,
        auth,
        start,
        end,
        LlmUsage.model,
        rollup_group_column=LlmUsageDailyRollup.model,
        app_id=app_id,
        provider=provider,
        model=model,
        raw_extra_filters=[LlmUsage.reasoning_tokens > 0],
        rollup_extra_filters=[LlmUsageDailyRollup.reasoning_tokens > 0],
        sort_metric='tokens',
    )

    return EfficiencyBundleResponse(
        cache_gauge=cache_gauge,
        cache_by_purpose=cache_by_purpose,
        error_gauge=error_gauge,
        error_by_code=error_by_code,
        unpriced_calls=unpriced_calls,
        reasoning_by_model=reasoning_by_model,
        computed_at=datetime.now(timezone.utc),
    )


async def _top_users_by_email(
    db: AsyncSession,
    auth: AuthContext,
    start: datetime,
    end: datetime,
    *,
    app_id: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    limit: int = 10,
) -> list[GroupedSpend]:
    """Top-spend users joined with ``users.email`` — no UUID rendering on the UI side.

    Reads ``llm_usage`` directly (rollups don't carry email). The join is
    left-outer so rows with a deleted/null user_id don't disappear; they
    collapse under the ``unknown`` bucket via ``coalesce(email, 'unknown')``.
    """
    filters: list[Any] = [
        LlmUsage.created_at >= start,
        LlmUsage.created_at < end,
    ]
    _apply_optional_fact_filters(
        filters, LlmUsage, app_id=app_id, provider=provider, model=model,
    )

    email_key = func.coalesce(User.email, 'unknown').label('key')
    stmt = (
        select(
            email_key,
            _sum_column(LlmUsage.cost_usd, 'cost_usd'),
            _sum_column(LlmUsage.total_tokens, 'tokens'),
            func.count(LlmUsage.id).label('calls'),
        )
        .select_from(LlmUsage)
        .join(User, User.id == LlmUsage.user_id, isouter=True)
        .where(and_(*filters))
        .group_by(email_key)
        .order_by(desc('cost_usd'), desc('calls'))
        .limit(limit)
    )
    stmt = _apply_tenant_scope(stmt, auth, LlmUsage.tenant_id)

    rows = (await db.execute(stmt)).all()
    return [
        GroupedSpend(
            key=str(row[0]),
            cost_usd=_to_float(row[1]),
            tokens=int(row[2] or 0),
            calls=int(row[3] or 0),
        )
        for row in rows
    ]


async def _grouped_spend(
    db: AsyncSession,
    auth: AuthContext,
    start: datetime,
    end: datetime,
    raw_group_column,
    *,
    rollup_group_column=None,
    app_id: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    raw_extra_filters: list[Any] | None = None,
    rollup_extra_filters: list[Any] | None = None,
    sort_metric: Literal['cost', 'tokens', 'calls'] = 'cost',
    limit: int = 10,
    use_rollup: bool = True,
) -> list[GroupedSpend]:
    grouped: dict[str, GroupedSpend] = {}

    def _merge_row(row_key: Any, cost_value: Any, token_value: Any, call_value: Any) -> None:
        key = str(row_key) if row_key is not None else 'unspecified'
        existing = grouped.get(key)
        if existing is None:
            grouped[key] = GroupedSpend(
                key=key,
                cost_usd=_to_float(cost_value),
                tokens=int(token_value or 0),
                calls=int(call_value or 0),
            )
            return
        existing.cost_usd += _to_float(cost_value)
        existing.tokens += int(token_value or 0)
        existing.calls += int(call_value or 0)

    if use_rollup and rollup_group_column is not None:
        full_day_range, raw_windows = _split_range_for_rollup(start, end)
        if full_day_range is not None:
            rollup_filters = _apply_optional_fact_filters(
                [
                    LlmUsageDailyRollup.day >= full_day_range[0],
                    LlmUsageDailyRollup.day < full_day_range[1],
                    *(rollup_extra_filters or []),
                ],
                LlmUsageDailyRollup,
                app_id=app_id,
                provider=provider,
                model=model,
            )
            rollup_stmt = (
                select(
                    rollup_group_column.label('key'),
                    _sum_column(LlmUsageDailyRollup.cost_usd, 'cost_usd'),
                    _sum_column(LlmUsageDailyRollup.total_tokens, 'tokens'),
                    _sum_column(LlmUsageDailyRollup.call_count, 'calls'),
                )
                .where(and_(*rollup_filters))
                .group_by(rollup_group_column)
            )
            rollup_stmt = _apply_tenant_scope(
                rollup_stmt,
                auth,
                LlmUsageDailyRollup.tenant_id,
            )
            for row in (await db.execute(rollup_stmt)).all():
                _merge_row(row[0], row[1], row[2], row[3])
    else:
        raw_windows = [(start, end)]

    for raw_start, raw_end in raw_windows:
        raw_filters = _apply_optional_fact_filters(
            [
                LlmUsage.created_at >= raw_start,
                LlmUsage.created_at < raw_end,
                *(raw_extra_filters or []),
            ],
            LlmUsage,
            app_id=app_id,
            provider=provider,
            model=model,
        )
        raw_stmt = (
            select(
                raw_group_column.label('key'),
                _sum_column(LlmUsage.cost_usd, 'cost_usd'),
                _sum_column(LlmUsage.total_tokens, 'tokens'),
                func.count(LlmUsage.id).label('calls'),
            )
            .where(and_(*raw_filters))
            .group_by(raw_group_column)
        )
        raw_stmt = _apply_tenant_scope(raw_stmt, auth, LlmUsage.tenant_id)
        for row in (await db.execute(raw_stmt)).all():
            _merge_row(row[0], row[1], row[2], row[3])

    sort_key = {
        'cost': lambda item: (item.cost_usd, item.tokens, item.calls),
        'tokens': lambda item: (item.tokens, item.cost_usd, item.calls),
        'calls': lambda item: (item.calls, item.cost_usd, item.tokens),
    }[sort_metric]
    rows = sorted(grouped.values(), key=sort_key, reverse=True)
    return rows[:limit]


# ── Entities + batch + drill ────────────────────────────────────────


@router.get('/entities', response_model=EntityListResponse)
async def list_entities(
    range: str | None = Query(None),
    app_id: str | None = Query(None),
    provider: str | None = Query(None),
    model: str | None = Query(None),
    owner_type: str | None = Query(None),
    sort: Literal['cost_desc', 'calls_desc', 'recent'] = Query('cost_desc'),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=_ENTITIES_PAGE_MAX),
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> EntityListResponse:
    start, end = _parse_range(range)
    window = and_(LlmUsage.created_at >= start, LlmUsage.created_at < end)

    base_filters = _apply_optional_fact_filters([window], LlmUsage, app_id=app_id, provider=provider, model=model)
    if owner_type:
        base_filters.append(LlmUsage.owner_type == owner_type)

    stmt = (
        select(
            LlmUsage.owner_type,
            LlmUsage.owner_id,
            _sum_column(LlmUsage.cost_usd, 'cost_usd'),
            _sum_column(LlmUsage.total_tokens, 'tokens'),
            func.count(LlmUsage.id).label('calls'),
            func.min(LlmUsage.created_at).label('first_at'),
            func.max(LlmUsage.created_at).label('last_at'),
        )
        .where(and_(*base_filters))
        .group_by(LlmUsage.owner_type, LlmUsage.owner_id)
    )
    stmt = _apply_tenant_scope(stmt, auth, LlmUsage.tenant_id)

    order_col = {
        'cost_desc': desc('cost_usd'),
        'calls_desc': desc('calls'),
        'recent': desc('last_at'),
    }[sort]
    stmt = stmt.order_by(order_col).limit(page_size).offset((page - 1) * page_size)

    rows = (await db.execute(stmt)).all()

    # Total owners in-scope (a second cheap count query).
    total_stmt = (
        select(LlmUsage.owner_type, LlmUsage.owner_id)
        .where(and_(*base_filters))
        .group_by(LlmUsage.owner_type, LlmUsage.owner_id)
    )
    total_stmt = _apply_tenant_scope(total_stmt, auth, LlmUsage.tenant_id)
    total_stmt = select(func.count()).select_from(total_stmt.subquery())
    total = int((await db.execute(total_stmt)).scalar_one() or 0)

    return EntityListResponse(
        items=[
            EntityRow(
                owner_type=row[0],
                owner_id=row[1],
                cost_usd=_to_float(row[2]),
                total_tokens=int(row[3] or 0),
                call_count=int(row[4] or 0),
                first_at=row[5],
                last_at=row[6],
            )
            for row in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get('/entity/{owner_type}/{owner_id}', response_model=EntityDrillDown)
async def entity_drill(
    owner_type: str,
    owner_id: uuid.UUID,
    range: str | None = Query(None),
    app_id: str | None = Query(None),
    provider: str | None = Query(None),
    model: str | None = Query(None),
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> EntityDrillDown:
    start, end = _parse_range(range)
    base_filters = _apply_optional_fact_filters(
        [
            LlmUsage.owner_type == owner_type,
            LlmUsage.owner_id == owner_id,
            LlmUsage.created_at >= start,
            LlmUsage.created_at < end,
        ],
        LlmUsage,
        app_id=app_id,
        provider=provider,
        model=model,
    )

    summary_stmt = select(
        _sum_column(LlmUsage.cost_usd, 'cost_usd'),
        _sum_column(LlmUsage.total_tokens, 'tokens'),
        func.count(LlmUsage.id).label('calls'),
    ).where(and_(*base_filters))
    summary_stmt = _apply_tenant_scope(summary_stmt, auth, LlmUsage.tenant_id)
    row = (await db.execute(summary_stmt)).one()
    if int(row[2] or 0) == 0:
        raise HTTPException(status_code=404, detail='No usage rows for this entity')

    by_purpose = await _grouped_spend(
        db,
        auth,
        start,
        end,
        func.coalesce(LlmUsage.call_purpose, 'unspecified'),
        app_id=app_id,
        provider=provider,
        model=model,
        raw_extra_filters=[LlmUsage.owner_type == owner_type, LlmUsage.owner_id == owner_id],
        use_rollup=False,
    )
    by_model = await _grouped_spend(
        db,
        auth,
        start,
        end,
        LlmUsage.model,
        app_id=app_id,
        provider=provider,
        model=model,
        raw_extra_filters=[LlmUsage.owner_type == owner_type, LlmUsage.owner_id == owner_id],
        use_rollup=False,
    )

    return EntityDrillDown(
        owner_type=owner_type,
        owner_id=owner_id,
        cost_usd=_to_float(row[0]),
        total_tokens=int(row[1] or 0),
        call_count=int(row[2] or 0),
        by_purpose=by_purpose,
        by_model=by_model,
    )


@router.post('/entity/batch', response_model=dict[str, ChipSummary])
async def entity_batch(
    body: BatchLookupRequest,
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> dict[str, ChipSummary]:
    """Fetch chip summaries for up to 100 entities in one round-trip."""
    if not body.items:
        return {}
    if len(body.items) > _MAX_BATCH_ITEMS:
        raise HTTPException(
            status_code=400,
            detail=f'batch size exceeds {_MAX_BATCH_ITEMS}',
        )

    range_window = None
    if body.range:
        start, end = _parse_range(body.range)
        range_window = and_(LlmUsage.created_at >= start, LlmUsage.created_at < end)

    pair_conditions = [
        and_(LlmUsage.owner_type == item.owner_type, LlmUsage.owner_id == item.owner_id)
        for item in body.items
    ]
    filters = [func.coalesce(LlmUsage.owner_id.isnot(None), True)]
    if pair_conditions:
        filters.append(or_(*pair_conditions))
    if range_window is not None:
        filters.append(range_window)
    _apply_optional_fact_filters(
        filters,
        LlmUsage,
        app_id=body.app_id,
        provider=body.provider,
        model=body.model,
    )

    stmt = (
        select(
            LlmUsage.owner_type,
            LlmUsage.owner_id,
            _sum_column(LlmUsage.cost_usd, 'cost_usd'),
            _sum_column(LlmUsage.total_tokens, 'tokens'),
            func.count(LlmUsage.id).label('calls'),
        )
        .where(and_(*filters))
        .group_by(LlmUsage.owner_type, LlmUsage.owner_id)
    )
    stmt = _apply_tenant_scope(stmt, auth, LlmUsage.tenant_id)
    rows = (await db.execute(stmt)).all()
    return {
        f'{row[0]}:{row[1]}': ChipSummary(
            cost_usd=_to_float(row[2]),
            total_tokens=int(row[3] or 0),
            call_count=int(row[4] or 0),
        )
        for row in rows
    }


# ── Calls (raw rows) ────────────────────────────────────────────────


@router.get('/calls', response_model=CallsListResponse)
async def list_calls(
    range: str | None = Query(None),
    app_id: str | None = Query(None),
    owner_type: str | None = Query(None),
    provider: str | None = Query(None),
    model: str | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=_CALLS_PAGE_MAX),
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> CallsListResponse:
    start, end = _parse_range(range)
    filters = [LlmUsage.created_at >= start, LlmUsage.created_at < end]
    if app_id:
        filters.append(LlmUsage.app_id == app_id)
    if owner_type:
        filters.append(LlmUsage.owner_type == owner_type)
    if provider:
        filters.append(LlmUsage.provider == provider)
    if model:
        filters.append(LlmUsage.model == model)
    if status:
        filters.append(LlmUsage.status == status)

    base = select(LlmUsage).where(and_(*filters))
    base = _apply_tenant_scope(base, auth, LlmUsage.tenant_id)

    count_stmt = select(func.count()).select_from(
        _apply_tenant_scope(select(LlmUsage.id).where(and_(*filters)), auth, LlmUsage.tenant_id).subquery()
    )
    total = int((await db.execute(count_stmt)).scalar_one() or 0)

    page_stmt = base.order_by(LlmUsage.created_at.desc()).limit(page_size).offset((page - 1) * page_size)
    items = [_row_to_call(r) for r in (await db.execute(page_stmt)).scalars().all()]
    return CallsListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get('/calls/{call_id}', response_model=CallDetail)
async def call_detail(
    call_id: uuid.UUID,
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> CallDetail:
    stmt = select(LlmUsage).where(LlmUsage.id == call_id)
    stmt = _apply_tenant_scope(stmt, auth, LlmUsage.tenant_id)
    row = (await db.execute(stmt)).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail='Call not found')
    return _row_to_call_detail(row)


def _row_to_call(row: LlmUsage) -> CallRow:
    return CallRow(
        id=row.id,
        created_at=row.created_at,
        tenant_id=row.tenant_id,
        user_id=row.user_id,
        app_id=row.app_id,
        subsystem=row.subsystem,
        owner_type=row.owner_type,
        owner_id=row.owner_id,
        provider=row.provider,
        model=row.model,
        call_purpose=row.call_purpose,
        status=row.status,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        cached_read_tokens=row.cached_read_tokens,
        reasoning_tokens=row.reasoning_tokens,
        total_tokens=row.total_tokens,
        cost_usd=_to_float(row.cost_usd),
        pricing_fallback=row.pricing_fallback,
        duration_ms=row.duration_ms,
        correlation_id=row.correlation_id,
    )


def _row_to_call_detail(row: LlmUsage) -> CallDetail:
    base = _row_to_call(row)
    return CallDetail(
        **base.model_dump(),
        cost_breakdown=row.cost_breakdown,
        modality_details=row.modality_details,
        server_tool_usage=row.server_tool_usage,
        finish_reason=row.finish_reason,
        request_id=row.request_id,
        error_code=row.error_code,
        traffic_type=row.traffic_type,
    )


# ── Pricing bundle + mutations ──────────────────────────────────────


@router.get('/pricing/bundle', response_model=PricingBundleResponse)
async def pricing_bundle(
    active_only: bool = Query(True),
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> PricingBundleResponse:
    pricing_stmt = select(ModelPricing)
    if active_only:
        pricing_stmt = pricing_stmt.where(ModelPricing.effective_to.is_(None))
    pricing_stmt = pricing_stmt.order_by(
        ModelPricing.provider.asc(), ModelPricing.model.asc(), ModelPricing.effective_from.desc()
    )
    pricing_rows = [_pricing_row_out(r) for r in (await db.execute(pricing_stmt)).scalars().all()]

    catalog_stmt = (
        select(ModelsDevCatalog)
        .order_by(ModelsDevCatalog.provider.asc(), ModelsDevCatalog.model.asc())
    )
    catalog_rows = [_catalog_row_out(r) for r in (await db.execute(catalog_stmt)).scalars().all()]

    history_stmt = select(ModelsDevSnapshot).order_by(ModelsDevSnapshot.fetched_at.desc()).limit(20)
    history_rows = [_snapshot_row_out(r) for r in (await db.execute(history_stmt)).scalars().all()]

    # Used by the auth context — acknowledged to satisfy static checkers.
    _ = auth
    return PricingBundleResponse(
        pricing=pricing_rows,
        catalog=catalog_rows,
        refresh_history=history_rows,
    )


@router.post('/pricing', response_model=PricingRowOut)
async def pricing_create(
    body: PricingCreateRequest,
    request: Request,
    auth: AuthContext = require_permission('cost:edit'),
    db: AsyncSession = Depends(get_db),
) -> PricingRowOut:
    now = datetime.now(timezone.utc)

    # Close any active row for (provider, model).
    close_stmt = (
        update(ModelPricing)
        .where(
            ModelPricing.provider == body.provider,
            ModelPricing.model == body.model,
            ModelPricing.effective_to.is_(None),
        )
        .values(effective_to=now)
        .returning(ModelPricing.id)
    )
    closed_ids = [r[0] for r in (await db.execute(close_stmt)).all()]

    new_row = ModelPricing(
        provider=body.provider,
        model=body.model,
        effective_from=now,
        effective_to=None,
        input_per_1m_usd=Decimal(str(body.input_per_1m_usd)),
        output_per_1m_usd=Decimal(str(body.output_per_1m_usd)),
        cached_read_per_1m_usd=Decimal(str(body.cached_read_per_1m_usd)),
        cache_write_5m_per_1m_usd=Decimal(str(body.cache_write_5m_per_1m_usd)),
        cache_write_1h_per_1m_usd=Decimal(str(body.cache_write_1h_per_1m_usd)),
        reasoning_per_1m_usd=Decimal(str(body.reasoning_per_1m_usd)),
        audio_input_per_1m_usd=_optional_decimal(body.audio_input_per_1m_usd),
        audio_input_per_minute_usd=_optional_decimal(body.audio_input_per_minute_usd),
        image_input_per_1m_usd=_optional_decimal(body.image_input_per_1m_usd),
        server_tool_prices=body.server_tool_prices,
        currency=body.currency,
        source='manual',
        created_by=auth.user_id,
        notes=body.notes,
    )
    db.add(new_row)
    await db.flush()

    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action='cost.pricing.created',
        entity_type='model_pricing',
        entity_id=new_row.id,
        before_state={'closed_ids': [str(cid) for cid in closed_ids]} if closed_ids else None,
        after_state=_pricing_row_out(new_row).model_dump(mode='json'),
        request=request,
    )
    await db.commit()
    await db.refresh(new_row)
    pricing_cache.invalidate()
    return _pricing_row_out(new_row)


@router.patch('/pricing/{pricing_id}', response_model=PricingRowOut)
async def pricing_patch(
    pricing_id: uuid.UUID,
    body: PricingPatchRequest,
    request: Request,
    auth: AuthContext = require_permission('cost:edit'),
    db: AsyncSession = Depends(get_db),
) -> PricingRowOut:
    existing = (await db.execute(select(ModelPricing).where(ModelPricing.id == pricing_id))).scalars().first()
    if existing is None:
        raise HTTPException(status_code=404, detail='pricing row not found')
    if existing.effective_to is not None:
        raise HTTPException(status_code=400, detail='cannot patch a historical row; create a new one')

    now = datetime.now(timezone.utc)
    existing.effective_to = now
    await db.flush()

    def _pick(current: Decimal, incoming: float | None) -> Decimal:
        if incoming is None:
            return current
        return Decimal(str(incoming))

    def _pick_optional(
        current: Decimal | None, incoming: float | None, supplied: bool
    ) -> Decimal | None:
        if not supplied:
            return current
        if incoming is None:
            return None
        return Decimal(str(incoming))

    payload_fields = body.model_dump(exclude_unset=True)
    new_row = ModelPricing(
        provider=existing.provider,
        model=existing.model,
        effective_from=now,
        effective_to=None,
        input_per_1m_usd=_pick(existing.input_per_1m_usd, body.input_per_1m_usd),
        output_per_1m_usd=_pick(existing.output_per_1m_usd, body.output_per_1m_usd),
        cached_read_per_1m_usd=_pick(existing.cached_read_per_1m_usd, body.cached_read_per_1m_usd),
        cache_write_5m_per_1m_usd=_pick(existing.cache_write_5m_per_1m_usd, body.cache_write_5m_per_1m_usd),
        cache_write_1h_per_1m_usd=_pick(existing.cache_write_1h_per_1m_usd, body.cache_write_1h_per_1m_usd),
        reasoning_per_1m_usd=_pick(existing.reasoning_per_1m_usd, body.reasoning_per_1m_usd),
        audio_input_per_1m_usd=_pick_optional(
            existing.audio_input_per_1m_usd, body.audio_input_per_1m_usd, 'audioInputPer1MUsd' in payload_fields or 'audio_input_per_1m_usd' in payload_fields,
        ),
        audio_input_per_minute_usd=_pick_optional(
            existing.audio_input_per_minute_usd, body.audio_input_per_minute_usd, 'audioInputPerMinuteUsd' in payload_fields or 'audio_input_per_minute_usd' in payload_fields,
        ),
        image_input_per_1m_usd=_pick_optional(
            existing.image_input_per_1m_usd, body.image_input_per_1m_usd, 'imageInputPer1MUsd' in payload_fields or 'image_input_per_1m_usd' in payload_fields,
        ),
        server_tool_prices=body.server_tool_prices if 'serverToolPrices' in payload_fields or 'server_tool_prices' in payload_fields else existing.server_tool_prices,
        currency=existing.currency,
        source='manual',
        created_by=auth.user_id,
        notes=body.notes if body.notes is not None else existing.notes,
    )
    db.add(new_row)
    await db.flush()

    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action='cost.pricing.updated',
        entity_type='model_pricing',
        entity_id=new_row.id,
        before_state=_pricing_row_out(existing).model_dump(mode='json'),
        after_state=_pricing_row_out(new_row).model_dump(mode='json'),
        request=request,
    )
    await db.commit()
    await db.refresh(new_row)
    pricing_cache.invalidate()
    return _pricing_row_out(new_row)


@router.post('/pricing/refresh', response_model=RefreshDiff)
@limiter.limit(
    settings.COST_PRICING_REFRESH_RATE_LIMIT,
    error_message='Pricing refresh is rate-limited. Please wait before retrying.',
)
async def pricing_refresh(
    request: Request,
    auth: AuthContext = require_permission('cost:edit'),
    db: AsyncSession = Depends(get_db),
) -> RefreshDiff:
    """Pull the latest pricing from models.dev.

    Requires ``cost:edit`` and is rate-limited per authenticated actor.
    """
    from app.services.cost_tracking.models_dev_client import (
        ModelsDevFetchError,
        fetch_models_dev_api,
    )
    from app.services.cost_tracking.models_dev_refresh import (
        ModelsDevRefreshError,
        apply_refresh,
    )

    async def _latest_snapshot_id() -> str | None:
        last_snapshot = (
            await db.execute(
                select(ModelsDevSnapshot)
                .order_by(ModelsDevSnapshot.fetched_at.desc())
                .limit(1)
            )
        ).scalars().first()
        return str(last_snapshot.id) if last_snapshot else None

    try:
        payload = await fetch_models_dev_api()
    except ModelsDevFetchError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                'error': 'models.dev unavailable',
                'message': str(exc),
                'last_snapshot_id': await _latest_snapshot_id(),
            },
        )

    payload_hash = hashlib.sha256(
        repr(sorted(payload.items(), key=lambda kv: kv[0])).encode()
    ).hexdigest()
    try:
        diff = await apply_refresh(
            db,
            payload=payload,
            payload_hash=payload_hash,
            actor_id=auth.user_id,
        )
    except ModelsDevRefreshError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                'error': 'models.dev refresh invalid',
                'message': str(exc),
                'last_snapshot_id': await _latest_snapshot_id(),
            },
        )
    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action='cost.pricing.refresh',
        entity_type='models_dev_snapshot',
        entity_id=diff['snapshot_id'],
        after_state=diff,
        request=request,
    )
    await db.commit()
    pricing_cache.invalidate()
    return RefreshDiff(
        snapshot_id=diff['snapshot_id'],
        status=diff.get('status', 'ok'),
        added_count=diff.get('added_count', 0),
        updated_count=diff.get('updated_count', 0),
        unchanged_count=diff.get('unchanged_count', 0),
        removed_count=diff.get('removed_count', 0),
        model_count=diff.get('model_count', 0),
        payload_hash=payload_hash,
        deduped=diff.get('deduped', False),
    )


@router.post('/pricing/backfill-unpriced', response_model=UnpricedBackfillResponse)
async def pricing_backfill_unpriced(
    body: UnpricedBackfillRequest,
    request: Request,
    auth: AuthContext = require_permission('cost:edit'),
    db: AsyncSession = Depends(get_db),
) -> UnpricedBackfillResponse:
    """Re-price every ``llm_usage`` row with ``pricing_fallback=true``.

    Scoped to the caller's tenant unless ``all_tenants=true`` is requested
    (still gated by ``cost:edit``). Rollups for affected days are re-run
    automatically. Safe to re-run — rows that remain unpriced stay unpriced.
    """
    from app.services.cost_tracking.backfill import backfill_unpriced

    tenant_scope = None if body.all_tenants else auth.tenant_id
    result = await backfill_unpriced(db, tenant_id=tenant_scope, limit=body.limit)

    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action='cost.pricing.backfill_unpriced',
        entity_type='llm_usage',
        entity_id=uuid.uuid4(),
        after_state={'all_tenants': body.all_tenants, 'limit': body.limit, **result},
        request=request,
    )
    await db.commit()
    return UnpricedBackfillResponse(**result)


@router.get('/pricing/refresh/{snapshot_id}', response_model=SnapshotRowOut)
async def pricing_refresh_snapshot(
    snapshot_id: uuid.UUID,
    auth: AuthContext = require_permission('cost:view'),
    db: AsyncSession = Depends(get_db),
) -> SnapshotRowOut:
    row = (await db.execute(select(ModelsDevSnapshot).where(ModelsDevSnapshot.id == snapshot_id))).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail='snapshot not found')
    _ = auth
    return _snapshot_row_out(row)


# ── Admin: rollup backfill ──────────────────────────────────────────


@admin_router.post('/cost-rollup/backfill', response_model=BackfillResponse)
async def rollup_backfill(
    body: BackfillRequest,
    request: Request,
    auth: AuthContext = require_permission('cost:edit'),
    db: AsyncSession = Depends(get_db),
) -> BackfillResponse:
    from app.services.cost_tracking.rollup import populate_rollup_range

    if body.end < body.start:
        raise HTTPException(status_code=400, detail='end must be >= start')

    result = await populate_rollup_range(db, start=body.start, end=body.end)
    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action='cost.rollup.backfill',
        entity_type='llm_usage_daily_rollup',
        entity_id=uuid.uuid4(),
        after_state={
            'start': body.start.isoformat(),
            'end': body.end.isoformat(),
            **result,
        },
        request=request,
    )
    await db.commit()
    return BackfillResponse(
        days_processed=result['days_processed'],
        rows_upserted=result['rows_upserted'],
        tenants=result['tenants'],
    )


# ── Row -> DTO helpers ──────────────────────────────────────────────


def _pricing_row_out(row: ModelPricing) -> PricingRowOut:
    return PricingRowOut(
        id=row.id,
        provider=row.provider,
        model=row.model,
        effective_from=row.effective_from,
        effective_to=row.effective_to,
        input_per_1m_usd=_to_float(row.input_per_1m_usd),
        output_per_1m_usd=_to_float(row.output_per_1m_usd),
        cached_read_per_1m_usd=_to_float(row.cached_read_per_1m_usd),
        cache_write_5m_per_1m_usd=_to_float(row.cache_write_5m_per_1m_usd),
        cache_write_1h_per_1m_usd=_to_float(row.cache_write_1h_per_1m_usd),
        reasoning_per_1m_usd=_to_float(row.reasoning_per_1m_usd),
        audio_input_per_1m_usd=_to_float(row.audio_input_per_1m_usd) if row.audio_input_per_1m_usd is not None else None,
        audio_input_per_minute_usd=_to_float(row.audio_input_per_minute_usd) if row.audio_input_per_minute_usd is not None else None,
        image_input_per_1m_usd=_to_float(row.image_input_per_1m_usd) if row.image_input_per_1m_usd is not None else None,
        server_tool_prices=row.server_tool_prices,
        currency=row.currency,
        source=row.source,
        source_snapshot_id=row.source_snapshot_id,
        source_model_id=row.source_model_id,
        notes=row.notes,
        created_at=row.created_at,
        created_by=row.created_by,
    )


def _catalog_row_out(row: ModelsDevCatalog) -> CatalogRowOut:
    return CatalogRowOut(
        provider=row.provider,
        model=row.model,
        display_name=row.display_name,
        family=row.family,
        context_limit=row.context_limit,
        output_limit=row.output_limit,
        supports_reasoning=row.supports_reasoning,
        supports_tool_call=row.supports_tool_call,
        modalities_input=list(row.modalities_input or []),
        modalities_output=list(row.modalities_output or []),
        status=row.status,
        last_seen_at=row.last_seen_at,
    )


def _snapshot_row_out(row: ModelsDevSnapshot) -> SnapshotRowOut:
    return SnapshotRowOut(
        id=row.id,
        fetched_at=row.fetched_at,
        status=row.status,
        added_count=row.added_count,
        updated_count=row.updated_count,
        unchanged_count=row.unchanged_count,
        removed_count=row.removed_count,
        payload_hash=row.payload_hash,
        error_message=row.error_message,
        duration_ms=row.duration_ms,
    )


def _to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _optional_decimal(value: float | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


# Suppress "unused" linter hits for dynamic-error paths.
_ = IntegrityError
_ = LlmUsageDailyRollup
