"""Persist ``llm_usage`` rows. Never raises; never blocks the caller's commit.

Each call opens its own ``AsyncSession`` (mirroring ``save_api_log``) so the
caller's transaction state is never mixed with usage writes. On failure, we
log + increment a failure metric and return without surfacing the error.
"""
from __future__ import annotations

import logging
import time
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.database import async_session
from app.models.cost import LlmUsage, LlmUsageDailyRollup
from app.services.cost_tracking.correlation import get_correlation_id
from app.services.cost_tracking.models import LLMCallMetadata
from app.services.cost_tracking.pricing import compute_cost, now_utc
from app.services.cost_tracking.pricing_cache import pricing_cache
from app.services.cost_tracking.provider_map import model_family_for

_log = logging.getLogger(__name__)

# Lightweight in-process failure counter. Phase 4 will wire this into the
# observability pipeline; today it lets operators grep ``cost_tracking`` logs.
_FAILURE_COUNTER: dict[str, int] = {'count': 0}


def get_failure_count() -> int:
    return _FAILURE_COUNTER['count']


def reset_failure_count() -> None:
    _FAILURE_COUNTER['count'] = 0


async def record_llm_usage(
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID | None,
    app_id: str,
    owner_type: str,
    owner_id: uuid.UUID | None = None,
    subsystem: str | None = None,
    parent_usage_id: uuid.UUID | None = None,
    correlation_id: uuid.UUID | None = None,
    provider: str,
    model: str,
    api_surface: str | None = None,
    call_purpose: str | None = None,
    stage_index: int | None = None,
    metadata: LLMCallMetadata | None = None,
    duration_ms: int | None = None,
    audio_seconds: float | None = None,
    status: str = 'ok',
    error_code: str | None = None,
) -> uuid.UUID | None:
    """Insert one ``llm_usage`` row. Returns the new id or ``None`` on failure."""
    start = time.monotonic()
    try:
        meta: LLMCallMetadata = metadata or {}
        input_tokens = int(meta.get('input_tokens') or 0)
        output_tokens = int(meta.get('output_tokens') or 0)
        cached_read_tokens = int(meta.get('cached_read_tokens') or 0)
        cached_write_tokens = int(meta.get('cached_write_tokens') or 0)
        cached_write_ttl = meta.get('cached_write_ttl')
        reasoning_tokens = int(meta.get('reasoning_tokens') or 0)
        tool_use_prompt_tokens = int(meta.get('tool_use_prompt_tokens') or 0)

        effective_duration_ms = (
            duration_ms if duration_ms is not None else meta.get('duration_ms')
        )
        effective_status = meta.get('status') or status
        effective_error_code = meta.get('error_code') or error_code
        effective_finish_reason = meta.get('finish_reason')
        effective_request_id = meta.get('request_id')
        effective_traffic_type = meta.get('traffic_type')
        effective_server_tool_usage = meta.get('server_tool_usage')
        effective_modality_details = meta.get('modality_details')
        effective_audio_seconds = (
            audio_seconds if audio_seconds is not None else meta.get('audio_seconds')
        )
        effective_correlation_id = correlation_id if correlation_id is not None else get_correlation_id()

        at = now_utc()

        async with async_session() as db:
            pricing = await pricing_cache.get(db, provider, model, at)
            cost_usd, breakdown, fallback = compute_cost(
                pricing,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cached_read_tokens=cached_read_tokens,
                cached_write_tokens=cached_write_tokens,
                cached_write_ttl=cached_write_ttl,
                reasoning_tokens=reasoning_tokens,
                tool_use_prompt_tokens=tool_use_prompt_tokens,
                audio_seconds=effective_audio_seconds,
                server_tool_usage=effective_server_tool_usage,
            )

            idempotency_key: str | None = None
            if effective_request_id:
                idempotency_key = f'{provider}:{effective_request_id}'

            row_id = uuid.uuid4()
            values: dict[str, Any] = {
                'id': row_id,
                'created_at': at,
                'tenant_id': tenant_id,
                'user_id': user_id,
                'app_id': app_id,
                'subsystem': subsystem,
                'owner_type': owner_type,
                'owner_id': owner_id,
                'parent_usage_id': parent_usage_id,
                'correlation_id': effective_correlation_id,
                'provider': provider,
                'model': model,
                'model_family': model_family_for(provider, model),
                'api_surface': api_surface or meta.get('api_surface'),
                'call_purpose': call_purpose,
                'stage_index': stage_index,
                'input_tokens': input_tokens,
                'output_tokens': output_tokens,
                'cached_read_tokens': cached_read_tokens,
                'cached_write_tokens': cached_write_tokens,
                'cached_write_ttl': cached_write_ttl,
                'reasoning_tokens': reasoning_tokens,
                'tool_use_prompt_tokens': tool_use_prompt_tokens,
                'modality_details': effective_modality_details,
                'audio_seconds': _decimal_or_none(effective_audio_seconds),
                'cost_usd': cost_usd,
                'cost_breakdown': breakdown,
                'pricing_version_id': pricing.id if pricing else None,
                'pricing_fallback': fallback,
                'duration_ms': effective_duration_ms,
                'status': effective_status,
                'error_code': effective_error_code,
                'finish_reason': effective_finish_reason,
                'server_tool_usage': effective_server_tool_usage,
                'traffic_type': effective_traffic_type,
                'request_id': effective_request_id,
                'idempotency_key': idempotency_key,
            }

            stmt = pg_insert(LlmUsage).values(**values)
            if idempotency_key is not None:
                # The unique index on idempotency_key is partial
                # (`WHERE idempotency_key IS NOT NULL`), so Postgres requires
                # the same predicate on ON CONFLICT to match the index.
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=['idempotency_key'],
                    index_where=LlmUsage.idempotency_key.isnot(None),
                )

            try:
                result = await db.execute(stmt)
                if idempotency_key is not None and result.rowcount == 0:
                    await db.rollback()
                    return None
                await _upsert_daily_rollup(
                    db,
                    at=at,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    user_id=user_id,
                    provider=provider,
                    model=model,
                    call_purpose=call_purpose,
                    status=effective_status,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cached_read_tokens=cached_read_tokens,
                    cached_write_tokens=cached_write_tokens,
                    reasoning_tokens=reasoning_tokens,
                    tool_use_prompt_tokens=tool_use_prompt_tokens,
                    total_tokens=(
                        input_tokens
                        + output_tokens
                        + cached_read_tokens
                        + cached_write_tokens
                        + reasoning_tokens
                        + tool_use_prompt_tokens
                    ),
                    cost_usd=cost_usd,
                )
                await db.commit()
            except IntegrityError:
                # Idempotency collision on same request_id — safe to ignore.
                await db.rollback()
                return None

        elapsed_ms = (time.monotonic() - start) * 1000
        if elapsed_ms > 50:
            _log.debug('record_llm_usage slow path: %.1fms', elapsed_ms)
        return row_id
    except Exception as exc:  # noqa: BLE001 — recorder must never raise
        _FAILURE_COUNTER['count'] += 1
        _log.warning('record_llm_usage failed: %s', exc)
        return None


def _decimal_or_none(value: float | int | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value)).quantize(Decimal('0.01'))
    except Exception:
        return None


async def _upsert_daily_rollup(
    db,
    *,
    at: Any,
    tenant_id: uuid.UUID,
    app_id: str,
    user_id: uuid.UUID | None,
    provider: str,
    model: str,
    call_purpose: str | None,
    status: str,
    input_tokens: int,
    output_tokens: int,
    cached_read_tokens: int,
    cached_write_tokens: int,
    reasoning_tokens: int,
    tool_use_prompt_tokens: int,
    total_tokens: int,
    cost_usd: Decimal,
) -> None:
    day = at.date()
    stmt = pg_insert(LlmUsageDailyRollup).values(
        id=uuid.uuid4(),
        day=day,
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        provider=provider,
        model=model,
        call_purpose=call_purpose,
        status=status,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_read_tokens=cached_read_tokens,
        cached_write_tokens=cached_write_tokens,
        reasoning_tokens=reasoning_tokens,
        tool_use_prompt_tokens=tool_use_prompt_tokens,
        total_tokens=total_tokens,
        cost_usd=cost_usd,
        call_count=1,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[
            'day',
            'tenant_id',
            'app_id',
            'user_id',
            'provider',
            'model',
            'call_purpose',
            'status',
        ],
        set_={
            'input_tokens': LlmUsageDailyRollup.input_tokens + input_tokens,
            'output_tokens': LlmUsageDailyRollup.output_tokens + output_tokens,
            'cached_read_tokens': LlmUsageDailyRollup.cached_read_tokens + cached_read_tokens,
            'cached_write_tokens': LlmUsageDailyRollup.cached_write_tokens + cached_write_tokens,
            'reasoning_tokens': LlmUsageDailyRollup.reasoning_tokens + reasoning_tokens,
            'tool_use_prompt_tokens': LlmUsageDailyRollup.tool_use_prompt_tokens + tool_use_prompt_tokens,
            'total_tokens': LlmUsageDailyRollup.total_tokens + total_tokens,
            'cost_usd': LlmUsageDailyRollup.cost_usd + cost_usd,
            'call_count': LlmUsageDailyRollup.call_count + 1,
        },
    )
    await db.execute(stmt)


__all__ = ['record_llm_usage', 'get_failure_count', 'reset_failure_count']
