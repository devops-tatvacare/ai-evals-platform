"""Pricing lookup + cost computation.

Resolves the effective ``model_pricing`` row for a given (provider, model, at)
tuple and applies it to an ``LLMCallMetadata`` envelope to produce a
``(cost_usd, breakdown, pricing_version_id, fallback)`` tuple.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost import ModelPricing


_ONE_MILLION = Decimal('1000000')
_ZERO = Decimal('0')


@dataclass(frozen=True)
class PricingRow:
    """In-memory snapshot of a ``model_pricing`` row used by the cache + recorder."""

    id: uuid.UUID
    provider: str
    model: str
    effective_from: datetime
    effective_to: datetime | None
    input_per_1m_usd: Decimal
    cached_read_per_1m_usd: Decimal
    cache_write_5m_per_1m_usd: Decimal
    cache_write_1h_per_1m_usd: Decimal
    output_per_1m_usd: Decimal
    reasoning_per_1m_usd: Decimal
    audio_input_per_1m_usd: Decimal | None
    audio_input_per_minute_usd: Decimal | None
    image_input_per_1m_usd: Decimal | None
    server_tool_prices: dict[str, Any] | None
    currency: str
    source: str

    @classmethod
    def from_orm(cls, row: ModelPricing) -> 'PricingRow':
        return cls(
            id=row.id,
            provider=row.provider,
            model=row.model,
            effective_from=row.effective_from,
            effective_to=row.effective_to,
            input_per_1m_usd=_to_decimal(row.input_per_1m_usd),
            cached_read_per_1m_usd=_to_decimal(row.cached_read_per_1m_usd),
            cache_write_5m_per_1m_usd=_to_decimal(row.cache_write_5m_per_1m_usd),
            cache_write_1h_per_1m_usd=_to_decimal(row.cache_write_1h_per_1m_usd),
            output_per_1m_usd=_to_decimal(row.output_per_1m_usd),
            reasoning_per_1m_usd=_to_decimal(row.reasoning_per_1m_usd),
            audio_input_per_1m_usd=_optional_decimal(row.audio_input_per_1m_usd),
            audio_input_per_minute_usd=_optional_decimal(row.audio_input_per_minute_usd),
            image_input_per_1m_usd=_optional_decimal(row.image_input_per_1m_usd),
            server_tool_prices=row.server_tool_prices,
            currency=row.currency,
            source=row.source,
        )


def _to_decimal(value: Any) -> Decimal:
    if value is None:
        return _ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _optional_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    return _to_decimal(value)


async def fetch_pricing(
    db: AsyncSession, provider: str, model: str, at: datetime
) -> PricingRow | None:
    """Return the ``model_pricing`` row effective at ``at`` for (provider, model)."""
    stmt = (
        select(ModelPricing)
        .where(
            ModelPricing.provider == provider,
            ModelPricing.model == model,
            ModelPricing.effective_from <= at,
            or_(ModelPricing.effective_to.is_(None), ModelPricing.effective_to > at),
        )
        .order_by(ModelPricing.effective_from.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    row = result.scalars().first()
    if row is None:
        return None
    return PricingRow.from_orm(row)


def compute_cost(
    pricing: PricingRow | None,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cached_read_tokens: int = 0,
    cached_write_tokens: int = 0,
    cached_write_ttl: str | None = None,
    reasoning_tokens: int = 0,
    tool_use_prompt_tokens: int = 0,
    audio_seconds: float | None = None,
    server_tool_usage: dict[str, Any] | None = None,
) -> tuple[Decimal, dict[str, Any], bool]:
    """Compute USD cost + a structured breakdown.

    Returns ``(cost_usd, breakdown, pricing_fallback)``. If ``pricing`` is
    ``None`` the cost is zero and ``pricing_fallback=True`` so callers can
    persist the fact that no rate applied.
    """
    if pricing is None:
        return (_ZERO, {'reason': 'pricing_missing'}, True)

    breakdown: dict[str, Any] = {}
    total = _ZERO

    def _line(name: str, tokens: int, rate: Decimal) -> None:
        nonlocal total
        if not tokens or rate <= 0:
            return
        amount = (Decimal(tokens) * rate / _ONE_MILLION).quantize(Decimal('0.00000001'))
        breakdown[name] = {'tokens': tokens, 'rate_per_1m_usd': str(rate), 'usd': str(amount)}
        total += amount

    _line('input', input_tokens, pricing.input_per_1m_usd)
    _line('output', output_tokens, pricing.output_per_1m_usd)
    _line('cached_read', cached_read_tokens, pricing.cached_read_per_1m_usd)
    _line('reasoning', reasoning_tokens, pricing.reasoning_per_1m_usd)
    _line('tool_use_prompt', tool_use_prompt_tokens, pricing.input_per_1m_usd)

    if cached_write_tokens:
        if cached_write_ttl == '1h':
            rate = pricing.cache_write_1h_per_1m_usd
        else:
            rate = pricing.cache_write_5m_per_1m_usd
        _line('cached_write', cached_write_tokens, rate)
        if rate > 0:
            breakdown['cached_write']['ttl'] = cached_write_ttl or '5m'

    if audio_seconds and audio_seconds > 0:
        if pricing.audio_input_per_minute_usd and pricing.audio_input_per_minute_usd > 0:
            amount = (
                Decimal(str(audio_seconds)) / Decimal('60') * pricing.audio_input_per_minute_usd
            ).quantize(Decimal('0.00000001'))
            breakdown['audio_input'] = {
                'seconds': audio_seconds,
                'rate_per_minute_usd': str(pricing.audio_input_per_minute_usd),
                'usd': str(amount),
            }
            total += amount

    if server_tool_usage and pricing.server_tool_prices:
        server_cost = _ZERO
        server_lines: dict[str, Any] = {}
        for key, count in server_tool_usage.items():
            try:
                units = Decimal(str(count))
            except Exception:
                continue
            rate_raw = pricing.server_tool_prices.get(f'{key}_per_1k')
            if rate_raw is None:
                continue
            rate = _to_decimal(rate_raw)
            amount = (units * rate / Decimal('1000')).quantize(Decimal('0.00000001'))
            server_lines[key] = {'units': str(units), 'rate_per_1k_usd': str(rate), 'usd': str(amount)}
            server_cost += amount
        if server_lines:
            breakdown['server_tool'] = server_lines
            total += server_cost

    breakdown['total_usd'] = str(total)
    breakdown['pricing_source'] = pricing.source
    return (total, breakdown, False)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


__all__ = ['PricingRow', 'fetch_pricing', 'compute_cost', 'now_utc']
