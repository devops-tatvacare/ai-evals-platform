"""Daily aggregate rollup for ``llm_usage``.

Populates ``llm_usage_daily_rollup`` from ``llm_usage`` rows grouped by
``(day, tenant_id, app_id, user_id, provider, model, call_purpose, status)``.

The rollup is *only* consumed by overview / spend / efficiency dashboards
(§8 of the spec). Entity drill-down, raw-call views, and ``CostChip`` lookups
read ``llm_usage`` directly, so a stale or missing rollup row can never
mis-attribute cost to the wrong owner — it just costs a slower overview
refresh.

This module exposes:

- ``populate_rollup_day(db, day)`` — idempotent upsert for a single UTC day.
- ``populate_rollup_range(db, start, end)`` — loop over days in a date window.

Both are idempotent: they DELETE the target day's rows first, then reinsert
from source — so a partial run (or retried job) never double-counts.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost import LlmUsage, LlmUsageDailyRollup

_log = logging.getLogger(__name__)


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start, end


async def populate_rollup_day(db: AsyncSession, day: date) -> dict[str, Any]:
    """Rebuild ``llm_usage_daily_rollup`` rows for ``day``.

    Returns a small summary dict. Runs inside the caller's transaction —
    the caller owns commit.
    """
    start, end = _day_bounds(day)

    # Wipe the day first so we can idempotently reinsert without duplicates.
    delete_stmt = delete(LlmUsageDailyRollup).where(LlmUsageDailyRollup.day == day)
    await db.execute(delete_stmt)

    group_cols = (
        LlmUsage.tenant_id,
        LlmUsage.app_id,
        LlmUsage.user_id,
        LlmUsage.provider,
        LlmUsage.model,
        func.coalesce(LlmUsage.call_purpose, '').label('call_purpose'),
        LlmUsage.status,
    )
    select_stmt = (
        select(
            *group_cols,
            func.coalesce(func.sum(LlmUsage.input_tokens), 0).label('input_tokens'),
            func.coalesce(func.sum(LlmUsage.output_tokens), 0).label('output_tokens'),
            func.coalesce(func.sum(LlmUsage.cached_read_tokens), 0).label('cached_read'),
            func.coalesce(func.sum(LlmUsage.cached_write_tokens), 0).label('cached_write'),
            func.coalesce(func.sum(LlmUsage.reasoning_tokens), 0).label('reasoning'),
            func.coalesce(func.sum(LlmUsage.tool_use_prompt_tokens), 0).label('tool_use_prompt'),
            func.coalesce(func.sum(LlmUsage.total_tokens), 0).label('total_tokens'),
            func.coalesce(func.sum(LlmUsage.cost_usd), 0).label('cost_usd'),
            func.count(LlmUsage.id).label('call_count'),
        )
        .where(LlmUsage.created_at >= start)
        .where(LlmUsage.created_at < end)
        .group_by(*group_cols)
    )

    rows = (await db.execute(select_stmt)).all()
    tenants: set[uuid.UUID] = set()
    for row in rows:
        rollup = LlmUsageDailyRollup(
            id=uuid.uuid4(),
            day=day,
            tenant_id=row[0],
            app_id=row[1],
            user_id=row[2],
            provider=row[3],
            model=row[4],
            # Coalesced empty string → NULL for clean overview joins.
            call_purpose=row[5] or None,
            status=row[6],
            input_tokens=int(row[7] or 0),
            output_tokens=int(row[8] or 0),
            cached_read_tokens=int(row[9] or 0),
            cached_write_tokens=int(row[10] or 0),
            reasoning_tokens=int(row[11] or 0),
            tool_use_prompt_tokens=int(row[12] or 0),
            total_tokens=int(row[13] or 0),
            cost_usd=_to_decimal(row[14]),
            call_count=int(row[15] or 0),
        )
        db.add(rollup)
        tenants.add(row[0])
    await db.flush()
    _log.info('rollup day=%s rows=%d tenants=%d', day.isoformat(), len(rows), len(tenants))
    return {
        'day': day.isoformat(),
        'rows_upserted': len(rows),
        'tenants': [str(t) for t in tenants],
    }


async def populate_rollup_range(
    db: AsyncSession,
    *,
    start: date,
    end: date,
) -> dict[str, Any]:
    """Rollup every day in ``[start, end]`` inclusive."""
    if end < start:
        raise ValueError('end must be >= start')
    day = start
    total_rows = 0
    tenants: set[str] = set()
    days = 0
    while day <= end:
        summary = await populate_rollup_day(db, day)
        total_rows += int(summary.get('rows_upserted', 0))
        for t in summary.get('tenants', []):
            tenants.add(t)
        days += 1
        day += timedelta(days=1)

    tenant_uuids: list[uuid.UUID] = []
    for t in tenants:
        try:
            tenant_uuids.append(uuid.UUID(t))
        except (ValueError, TypeError):
            continue

    return {
        'days_processed': days,
        'rows_upserted': total_rows,
        'tenants': tenant_uuids,
    }


def _to_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal('0')
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


__all__ = ['populate_rollup_day', 'populate_rollup_range']
