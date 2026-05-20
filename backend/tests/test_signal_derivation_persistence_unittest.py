"""Persistence-layer regression tests for ``upsert_derived_signals``.

The shipped MQL definition fans into ~6 signal types per lead. With the
keyset loader's batch_size=1000 leads, the orchestrator called
``upsert_derived_signals`` with ~6,000 derived signals at once, blowing
through Postgres's 65,535-parameter-per-statement cap (6,000 × 18 cols
≈ 108,000). asyncpg raised a generic DBAPIError; the orchestrator's
except-block then triggered MissingGreenlet on ``definition.id`` access,
masking the real cause.

This test pins the fix: ``upsert_derived_signals`` chunks the rows into
≤500-row INSERTs (500 × 18 cols = 9,000 params, comfortable margin) so
the underlying ``db.execute`` is called multiple times for large inputs
and never with a single >500-row VALUES list.
"""
from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

from app.services.analytics.signal_derivation.base import DerivedSignal
from app.services.analytics.signal_derivation.persistence import (
    upsert_derived_signals,
)


def _signal(i: int) -> DerivedSignal:
    return DerivedSignal(
        lead_id=f"lead-{i:05d}",
        signal_type="mql_score",
        signal_value="2",
        signal_value_numeric=Decimal("2"),
        signal_at=None,
        detected_at=datetime(2026, 5, 17, tzinfo=timezone.utc),
        confidence=None,
        supporting_quote=None,
        ordinal=0,
        attributes={},
        source_activity_id=None,
        eval_run_id=None,
        thread_evaluation_id=None,
        sync_run_id=None,
    )


def _values_row_count(execute_call) -> int:
    """Pull the number of rows out of a pg_insert(...).values(rows) call.

    SQLAlchemy stashes multi-row VALUES on the Insert's private
    ``_multi_values`` attribute — a list-of-list-of-row-dicts. With our
    single ``.values(rows)`` call there is exactly one outer entry, and
    its length is the row count we passed in.
    """
    stmt = execute_call.args[0]
    return len(stmt._multi_values[0]) if stmt._multi_values else 0


class UpsertDerivedSignalsChunkingTests(unittest.IsolatedAsyncioTestCase):
    async def test_zero_rows_skips_execute(self) -> None:
        db = MagicMock()
        db.execute = AsyncMock()
        n = await upsert_derived_signals(
            db,
            iter(()),
            tenant_id=uuid.uuid4(),
            app_id="inside-sales",
            signal_definition_id=uuid.uuid4(),
        )
        self.assertEqual(n, 0)
        db.execute.assert_not_awaited()

    async def test_small_input_single_statement(self) -> None:
        db = MagicMock()
        db.execute = AsyncMock()
        signals = [_signal(i) for i in range(10)]
        n = await upsert_derived_signals(
            db,
            signals,
            tenant_id=uuid.uuid4(),
            app_id="inside-sales",
            signal_definition_id=uuid.uuid4(),
        )
        self.assertEqual(n, 10)
        self.assertEqual(db.execute.await_count, 1)
        self.assertEqual(_values_row_count(db.execute.await_args), 10)

    async def test_exact_chunk_boundary(self) -> None:
        db = MagicMock()
        db.execute = AsyncMock()
        signals = [_signal(i) for i in range(500)]
        n = await upsert_derived_signals(
            db,
            signals,
            tenant_id=uuid.uuid4(),
            app_id="inside-sales",
            signal_definition_id=uuid.uuid4(),
        )
        self.assertEqual(n, 500)
        # exactly one chunk
        self.assertEqual(db.execute.await_count, 1)
        self.assertEqual(_values_row_count(db.execute.await_args), 500)

    async def test_just_above_chunk_boundary_splits(self) -> None:
        db = MagicMock()
        db.execute = AsyncMock()
        signals = [_signal(i) for i in range(501)]
        n = await upsert_derived_signals(
            db,
            signals,
            tenant_id=uuid.uuid4(),
            app_id="inside-sales",
            signal_definition_id=uuid.uuid4(),
        )
        self.assertEqual(n, 501)
        self.assertEqual(db.execute.await_count, 2)
        per_call = [_values_row_count(c) for c in db.execute.await_args_list]
        self.assertEqual(per_call, [500, 1])

    async def test_six_thousand_rows_chunks_into_twelve_statements(self) -> None:
        """The original bug case: 1000-lead batch × 6 signal types per lead.

        Before the fix this was one 6,000-row VALUES list with ~108K bind
        parameters — past Postgres's 65,535 cap. After the fix it splits
        cleanly into 12 × 500-row statements.
        """
        db = MagicMock()
        db.execute = AsyncMock()
        signals = [_signal(i) for i in range(6_000)]
        n = await upsert_derived_signals(
            db,
            signals,
            tenant_id=uuid.uuid4(),
            app_id="inside-sales",
            signal_definition_id=uuid.uuid4(),
        )
        self.assertEqual(n, 6_000)
        self.assertEqual(db.execute.await_count, 12)
        # Every chunk must stay at or under the safe 500-row cap so we
        # never reach the 65,535-parameter Postgres ceiling.
        for call in db.execute.await_args_list:
            self.assertLessEqual(_values_row_count(call), 500)


if __name__ == "__main__":
    unittest.main()
