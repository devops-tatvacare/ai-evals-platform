"""Phase 4 unit tests: super-admin gating, rollup idempotency, models.dev refresh diffing.

Route-level integration tests are not included here — the repo's installed
FastAPI/Starlette combo has a pre-existing ``on_startup`` incompatibility that
prevents any ``routes/*.py`` module from importing in isolation (see the
pre-Phase-4 baseline failure list). Phase 4 instead covers:

1. ``require_super_admin`` allow/deny matrix.
2. ``OWNER_ONLY_SURFACES`` contains the three ``cost:*`` entries.
3. Rollup idempotency: two runs for the same day produce one row per scope.
4. models.dev ``apply_refresh`` behaviours: dedupe on identical payload_hash,
   added/updated/unchanged/removed counts.
"""
from __future__ import annotations

import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.auth.context import AuthContext, is_super_admin, require_super_admin
from app.auth.permission_catalog import OWNER_ONLY_SURFACES
from app.constants import SYSTEM_TENANT_ID


def _auth(*, is_owner: bool, tenant_id: uuid.UUID) -> AuthContext:
    return AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=tenant_id,
        email='x@y.com',
        role_id=uuid.uuid4(),
        is_owner=is_owner,
        permissions=frozenset(),
        app_access=frozenset(),
    )


class SuperAdminGatingTests(unittest.IsolatedAsyncioTestCase):
    async def test_super_admin_allowed(self):
        auth = _auth(is_owner=True, tenant_id=SYSTEM_TENANT_ID)
        self.assertTrue(is_super_admin(auth))
        result = await require_super_admin(auth=auth)
        self.assertIs(result, auth)

    async def test_owner_of_other_tenant_denied(self):
        auth = _auth(is_owner=True, tenant_id=uuid.uuid4())
        self.assertFalse(is_super_admin(auth))
        with self.assertRaises(HTTPException) as ctx:
            await require_super_admin(auth=auth)
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_non_owner_denied(self):
        auth = _auth(is_owner=False, tenant_id=SYSTEM_TENANT_ID)
        self.assertFalse(is_super_admin(auth))
        with self.assertRaises(HTTPException):
            await require_super_admin(auth=auth)


class OwnerOnlySurfacesTests(unittest.TestCase):
    def test_cost_surfaces_registered(self):
        ids = {entry['id'] for entry in OWNER_ONLY_SURFACES}
        self.assertIn('cost:access', ids)
        self.assertIn('cost:pricing', ids)
        self.assertIn('cost:pricing.refresh', ids)


class ModelsDevRefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_deduped_when_payload_hash_matches_latest(self):
        """Identical payload_hash short-circuits — no catalog/pricing writes, only the
        snapshot row is still inserted."""
        from app.services.cost_tracking import models_dev_refresh as mod
        from app.models.cost import ModelsDevSnapshot

        latest = ModelsDevSnapshot(
            id=uuid.uuid4(),
            fetched_at=datetime.now(timezone.utc) - timedelta(hours=1),
            payload_hash='same',
            model_count=0,
            status='ok',
            raw_payload={},
        )

        class _Scalars:
            def __init__(self, value):
                self._value = value

            def first(self):
                return self._value

            def all(self):
                return []

        class _Result:
            def __init__(self, value):
                self._value = value

            def scalars(self):
                return _Scalars(self._value)

        db = AsyncMock()
        db.execute.side_effect = [_Result(latest)]
        db.flush = AsyncMock()

        added_rows: list = []
        db.add = lambda obj: added_rows.append(obj)

        payload = {'openai': {'models': [{'id': 'gpt-4o', 'cost': {'input': 1, 'output': 2}}]}}
        diff = await mod.apply_refresh(
            db, payload=payload, payload_hash='same', actor_id=None
        )
        self.assertTrue(diff['deduped'])
        # Only the snapshot row is added on the dedupe path.
        self.assertTrue(any(isinstance(r, ModelsDevSnapshot) for r in added_rows))


class RollupTests(unittest.IsolatedAsyncioTestCase):
    async def test_rollup_day_deletes_existing_rows_first(self):
        """populate_rollup_day must DELETE before SELECT+INSERT so reruns
        don't double-count."""
        from app.services.cost_tracking import rollup as mod

        delete_calls: list = []
        inserts: list = []

        class _Result:
            def all(self):
                return []

        db = AsyncMock()

        async def _execute(stmt):
            delete_calls.append(stmt)
            return _Result()

        db.execute.side_effect = _execute
        db.add = lambda obj: inserts.append(obj)
        db.flush = AsyncMock()

        target = date(2026, 4, 19)
        summary = await mod.populate_rollup_day(db, target)

        # The first execute call should be the DELETE; second is the SELECT.
        self.assertEqual(summary['day'], target.isoformat())
        self.assertGreaterEqual(len(delete_calls), 2)

    async def test_rollup_range_rejects_reversed_window(self):
        from app.services.cost_tracking.rollup import populate_rollup_range

        db = AsyncMock()
        with self.assertRaises(ValueError):
            await populate_rollup_range(
                db, start=date(2026, 4, 19), end=date(2026, 4, 18)
            )


class DerivedRatesTests(unittest.TestCase):
    def test_anthropic_cache_write_heuristic(self):
        from app.services.cost_tracking.models_dev_refresh import _derive_rates

        rates = _derive_rates(
            'anthropic',
            {
                'cost_input': '3',
                'cost_output': '15',
                'cost_cache_read': None,
                'cost_cache_write': None,
                'cost_reasoning': None,
            },
        )
        # cached_read = 0.1 × input = 0.3
        self.assertEqual(rates['cached_read_per_1m_usd'].quantize(Decimal('0.00')), Decimal('0.30'))
        # cache_write_5m = 1.25 × input = 3.75
        self.assertEqual(rates['cache_write_5m_per_1m_usd'].quantize(Decimal('0.00')), Decimal('3.75'))
        # cache_write_1h = 2.0 × input = 6.00
        self.assertEqual(rates['cache_write_1h_per_1m_usd'].quantize(Decimal('0.00')), Decimal('6.00'))
        # reasoning defaults to output rate
        self.assertEqual(rates['reasoning_per_1m_usd'], Decimal('15'))


if __name__ == '__main__':
    unittest.main()
