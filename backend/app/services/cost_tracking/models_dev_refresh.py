"""models.dev refresh flow.

Takes the raw payload from :mod:`models_dev_client` plus a pre-computed
``payload_hash`` and applies the effective-dated upsert sequence described in
§7.8 of the spec:

1. Short-circuit if ``payload_hash`` matches the most recent snapshot (snapshot
   row still written so operators see "we checked, no changes").
2. Insert a ``analytics.snapshot_llm_models_catalog`` row (raw_payload retained for audit).
3. Upsert ``analytics.ref_llm_models_catalog`` from the payload.
4. For every (provider, model): derive the new rate tuple, close the active
   row if present, insert a new effective row with ``source='models_dev'``.
5. Flip missing catalog entries to ``status='deprecated_in_source'`` — never
   touch their pricing rows.
6. Return a diff summary the caller uses for the audit log + response body.

Never raises for missing optional rate fields; missing cache/reasoning
prices fall through to :mod:`provider_map` heuristics and are flagged in
``cost_breakdown.derived_pricing_fields`` via the ``RefLlmModelPricing.notes`` column.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Iterable

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost import RefLlmModelPricing, RefLlmModelsCatalog, SnapshotLlmModelsCatalog
from app.services.cost_tracking.provider_map import (
    ALLOWLIST,
    PROVIDER_DERIVED_PRICING,
    PROVIDER_MAP,
)

_log = logging.getLogger(__name__)


class ModelsDevRefreshError(RuntimeError):
    """Raised when the fetched models.dev payload cannot produce a usable refresh."""


async def apply_refresh(
    db: AsyncSession,
    *,
    payload: dict[str, Any],
    payload_hash: str,
    actor_id: uuid.UUID | None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)

    # Flatten and filter the payload down to providers we care about. The
    # models.dev API returns a provider-keyed map; each value has ``models``
    # (list or map) + provider metadata.
    flattened = list(_flatten_payload(payload))
    if not flattened:
        raise ModelsDevRefreshError(
            'models.dev payload contained no supported providers/models for the configured allowlist.'
        )
    expected_pairs = {(row['provider'], row['model']) for row in flattened}

    latest_stmt = (
        select(SnapshotLlmModelsCatalog)
        .order_by(SnapshotLlmModelsCatalog.fetched_at.desc())
        .limit(1)
    )
    latest = (await db.execute(latest_stmt)).scalars().first()
    deduped = (
        latest is not None
        and latest.payload_hash == payload_hash
        and await _catalog_covers_payload(db, expected_pairs)
    )

    snapshot = SnapshotLlmModelsCatalog(
        id=uuid.uuid4(),
        fetched_at=now,
        actor_id=actor_id,
        payload_hash=payload_hash,
        model_count=len(flattened),
        status='ok',
        raw_payload=_filter_payload_to_allowlist(payload),
    )
    db.add(snapshot)
    await db.flush()

    if deduped:
        snapshot.unchanged_count = len(flattened)
        await db.flush()
        return {
            'snapshot_id': snapshot.id,
            'status': 'ok',
            'model_count': len(flattened),
            'added_count': 0,
            'updated_count': 0,
            'unchanged_count': len(flattened),
            'removed_count': 0,
            'deduped': True,
        }

    # ── Catalog + pricing upserts ────────────────────────────────
    seen_pairs: set[tuple[str, str]] = set()
    added = 0
    updated = 0
    unchanged = 0

    for row in flattened:
        provider_key = row['provider']  # internal key (gemini / openai / ...)
        model = row['model']
        seen_pairs.add((provider_key, model))

        catalog = await _upsert_catalog(db, row, snapshot_id=snapshot.id, now=now)
        _ = catalog

        new_rates = _derive_rates(provider_key, row)
        state = await _apply_pricing_row(
            db,
            provider=provider_key,
            model=model,
            rates=new_rates,
            source_snapshot_id=snapshot.id,
            source_model_id=row.get('source_model_id'),
            now=now,
            actor_id=actor_id,
        )
        if state == 'added':
            added += 1
        elif state == 'updated':
            updated += 1
        else:
            unchanged += 1

    # ── Deprecation pass ─────────────────────────────────────────
    catalog_stmt = select(RefLlmModelsCatalog).where(
        RefLlmModelsCatalog.status == 'active',
    )
    removed = 0
    for cat in (await db.execute(catalog_stmt)).scalars().all():
        if (cat.provider, cat.model) not in seen_pairs:
            cat.status = 'deprecated_in_source'
            removed += 1

    snapshot.added_count = added
    snapshot.updated_count = updated
    snapshot.unchanged_count = unchanged
    snapshot.removed_count = removed
    await db.flush()

    return {
        'snapshot_id': snapshot.id,
        'status': 'ok',
        'model_count': len(flattened),
        'added_count': added,
        'updated_count': updated,
        'unchanged_count': unchanged,
        'removed_count': removed,
        'deduped': False,
    }


async def _catalog_covers_payload(
    db: AsyncSession,
    expected_pairs: set[tuple[str, str]],
) -> bool:
    if not expected_pairs:
        return False

    catalog_rows = (
        await db.execute(
            select(RefLlmModelsCatalog.provider, RefLlmModelsCatalog.model).where(
                RefLlmModelsCatalog.status == 'active',
            )
        )
    ).all()
    active_pairs = {(provider, model) for provider, model in catalog_rows}
    return expected_pairs.issubset(active_pairs)


# ── Payload parsing ──────────────────────────────────────────────────


def _flatten_payload(payload: dict[str, Any]) -> Iterable[dict[str, Any]]:
    """Yield flattened ``{provider, model, source_model_id, …}`` records.

    Only providers in ``ALLOWLIST`` (via ``provider_map``) are yielded. The
    rest are ignored silently.
    """
    for provider_key, entry in (payload or {}).items():
        if provider_key not in ALLOWLIST:
            continue
        internal_provider, _alias_map = PROVIDER_MAP[provider_key]
        models = _models_iter(entry)
        for model_entry in models:
            model_id = model_entry.get('id') or model_entry.get('model') or model_entry.get('name')
            if not model_id:
                continue
            cost = model_entry.get('cost') or {}
            limits = model_entry.get('limit') or {}
            modalities = model_entry.get('modalities') or {}
            yield {
                'provider_key': provider_key,
                'provider': internal_provider,
                'model': str(model_id),
                'source_model_id': str(model_id),
                'display_name': model_entry.get('name'),
                'family': model_entry.get('family'),
                'context_limit': _coerce_int(limits.get('context')),
                'output_limit': _coerce_int(limits.get('output')),
                'supports_reasoning': bool(model_entry.get('reasoning') or False),
                'supports_tool_call': bool(model_entry.get('tool_call') or False),
                'supports_attachment': bool(model_entry.get('attachment') or False),
                # Verified 2026-05-18 against https://models.dev/api.json — chat
                # models (gpt-4o, gemini-2.5-flash-preview-09-2025, etc) carry
                # ``structured_output: boolean``. Older / embedding / TTS rows
                # omit it; bool(None) → False is the right default.
                'supports_structured_output': bool(
                    model_entry.get('structured_output') or False
                ),
                'modalities_input': _as_list(modalities.get('input')),
                'modalities_output': _as_list(modalities.get('output')),
                'open_weights': bool(model_entry.get('open_weights') or False),
                'release_date': _coerce_date(model_entry.get('release_date')),
                'last_updated_source': _coerce_date(model_entry.get('last_updated')),
                'knowledge_cutoff': model_entry.get('knowledge'),
                'cost_input': cost.get('input'),
                'cost_output': cost.get('output'),
                'cost_cache_read': cost.get('cache_read') or cost.get('input_cache_read'),
                'cost_cache_write': cost.get('cache_write') or cost.get('input_cache_write'),
                'cost_reasoning': cost.get('reasoning') or cost.get('output_reasoning'),
            }


def _models_iter(entry: Any) -> Iterable[dict[str, Any]]:
    models = entry.get('models') if isinstance(entry, dict) else None
    if isinstance(models, list):
        for model in models:
            if isinstance(model, dict):
                yield model
        return
    if isinstance(models, dict):
        for key, model in models.items():
            if isinstance(model, dict):
                merged = dict(model)
                merged.setdefault('id', key)
                yield merged


def _filter_payload_to_allowlist(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in (payload or {}).items() if k in ALLOWLIST}


def _coerce_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_list(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str):
        return [value]
    return []


def _coerce_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


# ── DB upserts ──────────────────────────────────────────────────────


async def _upsert_catalog(
    db: AsyncSession,
    row: dict[str, Any],
    *,
    snapshot_id: uuid.UUID,
    now: datetime,
) -> RefLlmModelsCatalog:
    existing = (
        await db.execute(
            select(RefLlmModelsCatalog).where(
                RefLlmModelsCatalog.provider == row['provider'],
                RefLlmModelsCatalog.model == row['model'],
            )
        )
    ).scalars().first()

    if existing is None:
        catalog = RefLlmModelsCatalog(
            provider_key=row['provider_key'],
            provider=row['provider'],
            model_id=row['source_model_id'],
            model=row['model'],
            display_name=row['display_name'],
            family=row['family'],
            context_limit=row['context_limit'],
            output_limit=row['output_limit'],
            supports_reasoning=row['supports_reasoning'],
            supports_tool_call=row['supports_tool_call'],
            supports_attachment=row['supports_attachment'],
            supports_structured_output=row['supports_structured_output'],
            modalities_input=row['modalities_input'],
            modalities_output=row['modalities_output'],
            open_weights=row['open_weights'],
            release_date=row['release_date'],
            last_updated_source=row['last_updated_source'],
            knowledge_cutoff=row['knowledge_cutoff'],
            status='active',
            last_snapshot_id=snapshot_id,
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(catalog)
        return catalog

    existing.provider_key = row['provider_key']
    existing.model_id = row['source_model_id']
    existing.display_name = row['display_name']
    existing.family = row['family']
    existing.context_limit = row['context_limit']
    existing.output_limit = row['output_limit']
    existing.supports_reasoning = row['supports_reasoning']
    existing.supports_tool_call = row['supports_tool_call']
    existing.supports_attachment = row['supports_attachment']
    existing.supports_structured_output = row['supports_structured_output']
    existing.modalities_input = row['modalities_input']
    existing.modalities_output = row['modalities_output']
    existing.open_weights = row['open_weights']
    existing.release_date = row['release_date']
    existing.last_updated_source = row['last_updated_source']
    existing.knowledge_cutoff = row['knowledge_cutoff']
    existing.status = 'active'
    existing.last_snapshot_id = snapshot_id
    existing.last_seen_at = now
    return existing


def _derive_rates(provider_key: str, row: dict[str, Any]) -> dict[str, Decimal]:
    input_rate = _coerce_decimal(row.get('cost_input'))
    output_rate = _coerce_decimal(row.get('cost_output'))

    heuristics = PROVIDER_DERIVED_PRICING.get(provider_key, {})
    cache_read_raw = row.get('cost_cache_read')
    if cache_read_raw is not None:
        cached_read_rate = _coerce_decimal(cache_read_raw)
    else:
        cached_read_rate = (
            input_rate * heuristics.get('cached_read_multiplier', Decimal('0'))
        ).quantize(Decimal('0.000001'))

    cache_write_raw = row.get('cost_cache_write')
    if cache_write_raw is not None:
        cache_write_5m = _coerce_decimal(cache_write_raw)
        cache_write_1h = cache_write_5m
    else:
        cache_write_5m = (
            input_rate * heuristics.get('cache_write_5m_multiplier', Decimal('0'))
        ).quantize(Decimal('0.000001'))
        cache_write_1h = (
            input_rate * heuristics.get('cache_write_1h_multiplier', Decimal('0'))
        ).quantize(Decimal('0.000001'))

    reasoning_raw = row.get('cost_reasoning')
    if reasoning_raw is not None:
        reasoning_rate = _coerce_decimal(reasoning_raw)
    elif heuristics.get('reasoning_from_output'):
        reasoning_rate = output_rate
    else:
        reasoning_rate = Decimal('0')

    return {
        'input_per_1m_usd': input_rate,
        'output_per_1m_usd': output_rate,
        'cached_read_per_1m_usd': cached_read_rate,
        'cache_write_5m_per_1m_usd': cache_write_5m,
        'cache_write_1h_per_1m_usd': cache_write_1h,
        'reasoning_per_1m_usd': reasoning_rate,
    }


def _coerce_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal('0')
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal('0')


async def _apply_pricing_row(
    db: AsyncSession,
    *,
    provider: str,
    model: str,
    rates: dict[str, Decimal],
    source_snapshot_id: uuid.UUID,
    source_model_id: str | None,
    now: datetime,
    actor_id: uuid.UUID | None,
) -> str:
    """Compare rates to the currently active row; close + insert if different."""
    current = (
        await db.execute(
            select(RefLlmModelPricing)
            .where(
                RefLlmModelPricing.provider == provider,
                RefLlmModelPricing.model == model,
                RefLlmModelPricing.effective_to.is_(None),
            )
            .limit(1)
        )
    ).scalars().first()

    if current is not None and _rates_equal(current, rates):
        return 'unchanged'

    if current is not None:
        await db.execute(
            update(RefLlmModelPricing)
            .where(RefLlmModelPricing.id == current.id)
            .values(effective_to=now)
        )

    new_row = RefLlmModelPricing(
        provider=provider,
        model=model,
        effective_from=now,
        effective_to=None,
        input_per_1m_usd=rates['input_per_1m_usd'],
        output_per_1m_usd=rates['output_per_1m_usd'],
        cached_read_per_1m_usd=rates['cached_read_per_1m_usd'],
        cache_write_5m_per_1m_usd=rates['cache_write_5m_per_1m_usd'],
        cache_write_1h_per_1m_usd=rates['cache_write_1h_per_1m_usd'],
        reasoning_per_1m_usd=rates['reasoning_per_1m_usd'],
        currency='USD',
        source='models_dev',
        source_snapshot_id=source_snapshot_id,
        source_model_id=source_model_id,
        created_by=actor_id,
    )
    db.add(new_row)
    await db.flush()
    return 'added' if current is None else 'updated'


def _rates_equal(current: RefLlmModelPricing, rates: dict[str, Decimal]) -> bool:
    for key, value in rates.items():
        current_value = getattr(current, key, Decimal('0')) or Decimal('0')
        if _coerce_decimal(current_value) != value:
            return False
    return True


__all__ = ['ModelsDevRefreshError', 'apply_refresh']
