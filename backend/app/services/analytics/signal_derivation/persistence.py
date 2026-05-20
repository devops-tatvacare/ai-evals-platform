"""Signal derivation framework — shared persistence of derived signals.

Phase 11B of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

One way to turn ``DerivedSignal`` objects into ``analytics.fact_lead_signal``
rows, and one upsert keyed on ``uq_fact_lead_signal_framework`` — used by
all three invocation paths (the scheduled ``rule`` Transform, the
per-eval-run ``llm_transcript`` populate, and the operator ``llm_profile``
backfill). Every framework row carries ``signal_definition_id``; the dedup
key is ``(tenant_id, app_id, lead_id, signal_type, detected_at, ordinal)``.
"""
from __future__ import annotations

import uuid
from typing import Any, Iterable

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_lead_facts import FactLeadSignal
from app.services.analytics.signal_derivation.base import DerivedSignal

# Conflict target — matches the partial unique index uq_fact_lead_signal_framework
# (migration 0045).
_FRAMEWORK_KEY = [
    "tenant_id", "app_id", "lead_id", "signal_type", "detected_at", "ordinal",
]
_FRAMEWORK_KEY_WHERE = text("signal_definition_id IS NOT NULL")


def derived_signal_to_fact_row(
    signal: DerivedSignal,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    signal_definition_id: uuid.UUID,
) -> dict[str, Any]:
    """Build a ``fact_lead_signal`` row dict from a ``DerivedSignal``.

    The caller owns the three stamped ids; everything else comes off the
    signal. Optional lineage (``eval_run_id`` etc.) passes straight through.
    """
    return {
        "id": uuid.uuid4(),
        "tenant_id": tenant_id,
        "app_id": app_id,
        "signal_definition_id": signal_definition_id,
        "lead_id": signal.lead_id,
        "signal_type": signal.signal_type,
        "signal_value": signal.signal_value,
        "signal_value_numeric": signal.signal_value_numeric,
        "signal_at": signal.signal_at,
        "detected_at": signal.detected_at,
        "confidence": signal.confidence,
        "supporting_quote": signal.supporting_quote,
        "ordinal": signal.ordinal,
        "attributes": signal.attributes,
        "source_activity_id": signal.source_activity_id,
        "eval_run_id": signal.eval_run_id,
        "thread_evaluation_id": signal.thread_evaluation_id,
        "sync_run_id": signal.sync_run_id,
    }


async def upsert_derived_signals(
    db: AsyncSession,
    signals: Iterable[DerivedSignal],
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    signal_definition_id: uuid.UUID,
) -> int:
    """Upsert framework signal rows on ``uq_fact_lead_signal_framework``.

    Re-running over unchanged source state collapses to the same rows
    (``detected_at`` is source-derived). Returns the row count touched.
    """
    rows = [
        derived_signal_to_fact_row(
            s,
            tenant_id=tenant_id,
            app_id=app_id,
            signal_definition_id=signal_definition_id,
        )
        for s in signals
    ]
    if not rows:
        return 0
    # Postgres caps bind parameters at 65,535 per statement. fact_lead_signal
    # has 18 columns per row, so a single VALUES (…) tops out around
    # 65,535 / 18 ≈ 3,640 rows. A 1000-lead batch × 6 signal types per lead
    # blew past that and asyncpg raised a generic DBAPIError. Chunking to
    # 500 rows × 18 cols = 9,000 params keeps a comfortable margin for
    # future schema growth without losing the upsert semantics — the
    # outer caller is already inside its own transaction and calls
    # `db.commit()` once after this returns.
    _CHUNK = 500
    for start in range(0, len(rows), _CHUNK):
        chunk = rows[start : start + _CHUNK]
        stmt = pg_insert(FactLeadSignal).values(chunk)
        stmt = stmt.on_conflict_do_update(
            index_elements=_FRAMEWORK_KEY,
            index_where=_FRAMEWORK_KEY_WHERE,
            set_={
                "signal_definition_id": stmt.excluded.signal_definition_id,
                "signal_value": stmt.excluded.signal_value,
                "signal_value_numeric": stmt.excluded.signal_value_numeric,
                "signal_at": stmt.excluded.signal_at,
                "confidence": stmt.excluded.confidence,
                "supporting_quote": stmt.excluded.supporting_quote,
                "attributes": stmt.excluded.attributes,
                "source_activity_id": stmt.excluded.source_activity_id,
                "eval_run_id": stmt.excluded.eval_run_id,
                "thread_evaluation_id": stmt.excluded.thread_evaluation_id,
                "sync_run_id": stmt.excluded.sync_run_id,
            },
        )
        await db.execute(stmt)
    return len(rows)
