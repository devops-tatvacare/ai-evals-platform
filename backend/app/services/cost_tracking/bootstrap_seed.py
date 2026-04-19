"""Bootstrap seed: idempotently import ``model_pricing`` rows from committed JSON.

Intended to run once at startup as part of ``seed_all_defaults``. The file at
``backend/app/seeds/data/model_pricing.json`` is the day-1 fallback for every
model we already call from ``api_logs``. Phase 4's models.dev refresh is the
ongoing source of truth — bootstrap rates are never overwritten once a
``source='models_dev'`` or ``source='manual'`` row exists for the same
(provider, model).
"""
from __future__ import annotations

import json
import logging
import pathlib
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost import ModelPricing

_log = logging.getLogger(__name__)

_SEED_PATH = pathlib.Path(__file__).resolve().parents[2] / 'seeds' / 'data' / 'model_pricing.json'


def _decimal(value: Any, default: str = '0') -> Decimal:
    if value is None:
        return Decimal(default)
    return Decimal(str(value))


def _optional_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


async def seed_model_pricing(session: AsyncSession) -> int:
    """Insert bootstrap pricing rows for models without any existing rate.

    Returns the number of rows inserted.
    """
    if not _SEED_PATH.exists():
        _log.warning('model_pricing seed file missing at %s', _SEED_PATH)
        return 0

    try:
        raw = json.loads(_SEED_PATH.read_text())
    except json.JSONDecodeError as exc:
        _log.warning('model_pricing seed JSON invalid: %s', exc)
        return 0

    entries = raw.get('pricing') or []
    if not entries:
        return 0

    # Existing (provider, model) tuples with any pricing row — don't stomp them.
    existing_stmt = select(ModelPricing.provider, ModelPricing.model).distinct()
    existing = {(row[0], row[1]) for row in (await session.execute(existing_stmt)).all()}

    now = datetime.now(timezone.utc)
    inserted = 0
    for entry in entries:
        provider = entry.get('provider')
        model = entry.get('model')
        if not provider or not model:
            continue
        if (provider, model) in existing:
            continue
        session.add(
            ModelPricing(
                provider=provider,
                model=model,
                effective_from=now,
                effective_to=None,
                input_per_1m_usd=_decimal(entry.get('input_per_1m_usd')),
                cached_read_per_1m_usd=_decimal(entry.get('cached_read_per_1m_usd')),
                cache_write_5m_per_1m_usd=_decimal(entry.get('cache_write_5m_per_1m_usd')),
                cache_write_1h_per_1m_usd=_decimal(entry.get('cache_write_1h_per_1m_usd')),
                output_per_1m_usd=_decimal(entry.get('output_per_1m_usd')),
                reasoning_per_1m_usd=_decimal(entry.get('reasoning_per_1m_usd')),
                audio_input_per_1m_usd=_optional_decimal(entry.get('audio_input_per_1m_usd')),
                audio_input_per_minute_usd=_optional_decimal(
                    entry.get('audio_input_per_minute_usd')
                ),
                image_input_per_1m_usd=_optional_decimal(entry.get('image_input_per_1m_usd')),
                server_tool_prices=entry.get('server_tool_prices'),
                currency=entry.get('currency', 'USD'),
                source='bootstrap',
                source_snapshot_id=None,
                source_model_id=entry.get('source_model_id'),
                notes=entry.get('notes'),
            )
        )
        inserted += 1

    if inserted:
        _log.info('seeded %d bootstrap model_pricing rows', inserted)
    return inserted
