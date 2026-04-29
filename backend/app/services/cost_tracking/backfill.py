"""Backfill pricing for historical ``analytics.fact_llm_generation`` rows.

Operates on rows where ``pricing_fallback=true``: re-resolves pricing via
the standard ``pricing_cache`` lookup (same path the live recorder uses),
re-runs ``compute_cost``, and updates the row when a rate is now available.

This never fabricates rates. If pricing for (provider, model, created_at) is
still missing, the row stays as-is; the return payload reports it under
``still_unpriced`` so the UI can surface "still missing N — add rates".

Rollups for affected UTC days are re-run after the updates land so that
daily totals stay in sync with the authoritative ``analytics.fact_llm_generation`` sums.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost import FactLlmGeneration
from app.services.cost_tracking.pricing import compute_cost, fetch_best_available_pricing
from app.services.cost_tracking.rollup import populate_rollup_day

_log = logging.getLogger(__name__)


async def backfill_unpriced(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Re-price every ``analytics.fact_llm_generation`` row with ``pricing_fallback=true``.

    Args:
        tenant_id: when provided, scope to a single tenant (caller-passed from
            auth context). ``None`` means platform-wide (operator path).
        limit: optional upper bound on rows processed in one call; useful for
            chunked backfills on large datasets.

    Returns ``{'scanned', 'repriced', 'still_unpriced', 'days_rolled'}``.
    """
    stmt = select(FactLlmGeneration).where(FactLlmGeneration.pricing_fallback.is_(True))
    if tenant_id is not None:
        stmt = stmt.where(FactLlmGeneration.tenant_id == tenant_id)
    stmt = stmt.order_by(FactLlmGeneration.created_at.asc())
    if limit is not None:
        stmt = stmt.limit(limit)

    rows = (await db.execute(stmt)).scalars().all()
    scanned = len(rows)
    repriced = 0
    still_unpriced = 0
    affected_days: set[date] = set()

    for row in rows:
        pricing = await fetch_best_available_pricing(
            db, row.provider, row.model, tenant_id=row.tenant_id
        )
        if pricing is None:
            still_unpriced += 1
            continue

        cost_usd, breakdown, fallback = compute_cost(
            pricing,
            input_tokens=row.input_tokens,
            output_tokens=row.output_tokens,
            cached_read_tokens=row.cached_read_tokens,
            cached_write_tokens=row.cached_write_tokens,
            cached_write_ttl=row.cached_write_ttl,
            reasoning_tokens=row.reasoning_tokens,
            tool_use_prompt_tokens=row.tool_use_prompt_tokens,
            audio_seconds=float(row.audio_seconds) if row.audio_seconds is not None else None,
            server_tool_usage=row.server_tool_usage,
        )
        if fallback:
            # compute_cost can still return fallback=True if pricing is
            # structurally incomplete (all rates zero). Leave the row alone.
            still_unpriced += 1
            continue

        await db.execute(
            update(FactLlmGeneration)
            .where(FactLlmGeneration.id == row.id)
            .values(
                cost_usd=cost_usd,
                cost_breakdown=breakdown,
                pricing_version_id=pricing.id,
                pricing_fallback=False,
            )
        )
        repriced += 1
        affected_days.add(row.created_at.date())

    if repriced:
        await db.flush()
        for day in sorted(affected_days):
            try:
                await populate_rollup_day(db, day)
            except Exception:
                _log.exception('rollup refresh failed for %s; continuing', day)

    return {
        'scanned': scanned,
        'repriced': repriced,
        'still_unpriced': still_unpriced,
        'days_rolled': len(affected_days),
    }


async def backfill_unpriced_for_alias(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    provider: str,
    observed: str,
    limit: int | None = None,
) -> dict[str, Any]:
    """Re-price rows that match a single (tenant, provider, observed) tuple.

    Called after an alias is created or updated so historical fallback rows
    pick up the newly available rate. Narrower than :func:`backfill_unpriced`
    — scans only the rows that actually care about this alias.
    """
    stmt = (
        select(FactLlmGeneration)
        .where(
            FactLlmGeneration.pricing_fallback.is_(True),
            FactLlmGeneration.tenant_id == tenant_id,
            FactLlmGeneration.provider == provider,
            FactLlmGeneration.model == observed,
        )
        .order_by(FactLlmGeneration.created_at.asc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)

    rows = (await db.execute(stmt)).scalars().all()
    scanned = len(rows)
    repriced = 0
    still_unpriced = 0
    affected_days: set[date] = set()

    for row in rows:
        pricing = await fetch_best_available_pricing(
            db, row.provider, row.model, tenant_id=row.tenant_id
        )
        if pricing is None:
            still_unpriced += 1
            continue

        cost_usd, breakdown, fallback = compute_cost(
            pricing,
            input_tokens=row.input_tokens,
            output_tokens=row.output_tokens,
            cached_read_tokens=row.cached_read_tokens,
            cached_write_tokens=row.cached_write_tokens,
            cached_write_ttl=row.cached_write_ttl,
            reasoning_tokens=row.reasoning_tokens,
            tool_use_prompt_tokens=row.tool_use_prompt_tokens,
            audio_seconds=float(row.audio_seconds) if row.audio_seconds is not None else None,
            server_tool_usage=row.server_tool_usage,
        )
        if fallback:
            still_unpriced += 1
            continue

        await db.execute(
            update(FactLlmGeneration)
            .where(FactLlmGeneration.id == row.id)
            .values(
                cost_usd=cost_usd,
                cost_breakdown=breakdown,
                pricing_version_id=pricing.id,
                pricing_fallback=False,
            )
        )
        repriced += 1
        affected_days.add(row.created_at.date())

    if repriced:
        await db.flush()
        for day in sorted(affected_days):
            try:
                await populate_rollup_day(db, day)
            except Exception:
                _log.exception('rollup refresh failed for %s; continuing', day)

    return {
        'scanned': scanned,
        'repriced': repriced,
        'still_unpriced': still_unpriced,
        'days_rolled': len(affected_days),
    }
