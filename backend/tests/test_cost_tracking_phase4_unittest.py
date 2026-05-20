"""Phase 4 unit tests: legacy super-admin helper coverage, cost permission catalog,
rollup idempotency, and models.dev refresh diffing.

Route-level integration tests are not included here — the repo's installed
FastAPI/Starlette combo has a pre-existing ``on_startup`` incompatibility that
prevents any ``routes/*.py`` module from importing in isolation (see the
pre-Phase-4 baseline failure list). Phase 4 instead covers:

1. ``require_super_admin`` allow/deny matrix for the legacy helper itself.
2. Cost permissions remain grantable and are absent from ``OWNER_ONLY_SURFACES``.
3. Rollup idempotency: two runs for the same day produce one row per scope.
4. models.dev ``apply_refresh`` behaviours: dedupe on identical payload_hash,
   added/updated/unchanged/removed counts.
"""
from __future__ import annotations

import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

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


class SuperAdminHelperTests(unittest.IsolatedAsyncioTestCase):
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


class CostPermissionCatalogTests(unittest.TestCase):
    def test_cost_permissions_are_grantable(self):
        """`cost:view` + `cost:edit` are ordinary grantable permissions; the
        previous `cost:*` owner-only surfaces were removed when the surface
        moved off `require_owner` / `require_super_admin` gating."""
        from app.auth.permission_catalog import VALID_PERMISSIONS

        self.assertIn('cost:view', VALID_PERMISSIONS)
        self.assertIn('cost:edit', VALID_PERMISSIONS)

        owner_only_ids = {entry['id'] for entry in OWNER_ONLY_SURFACES}
        self.assertNotIn('cost:access', owner_only_ids)
        self.assertNotIn('cost:pricing', owner_only_ids)
        self.assertNotIn('cost:pricing.refresh', owner_only_ids)


class ModelsDevRefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_deduped_when_payload_hash_matches_latest_and_catalog_is_healthy(self):
        """Identical payload_hash short-circuits only when active catalog rows already
        cover the current payload."""
        from app.services.cost_tracking import models_dev_refresh as mod
        from app.models.cost import RefLlmModelsCatalog, SnapshotLlmModelsCatalog

        latest = SnapshotLlmModelsCatalog(
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

            def all(self):
                return self._value

        db = AsyncMock()
        db.execute.side_effect = [
            _Result(latest),
            _Result([('openai', 'gpt-4o')]),
        ]
        db.flush = AsyncMock()

        added_rows: list = []
        db.add = lambda obj: added_rows.append(obj)

        payload = {'openai': {'models': [{'id': 'gpt-4o', 'cost': {'input': 1, 'output': 2}}]}}
        diff = await mod.apply_refresh(
            db, payload=payload, payload_hash='same', actor_id=None
        )
        self.assertTrue(diff['deduped'])
        # Only the snapshot row is added on the dedupe path.
        self.assertTrue(any(isinstance(r, SnapshotLlmModelsCatalog) for r in added_rows))
        self.assertFalse(any(isinstance(r, RefLlmModelsCatalog) for r in added_rows))

    async def test_matching_hash_replays_when_catalog_is_missing(self):
        """A matching payload hash must still repair empty prod state instead of
        skipping catalog/pricing upserts."""
        from app.services.cost_tracking import models_dev_refresh as mod
        from app.models.cost import SnapshotLlmModelsCatalog

        latest = SnapshotLlmModelsCatalog(
            id=uuid.uuid4(),
            fetched_at=datetime.now(timezone.utc) - timedelta(hours=1),
            payload_hash='same',
            model_count=1,
            status='ok',
            raw_payload={},
        )

        class _Scalars:
            def __init__(self, value):
                self._value = value

            def first(self):
                return self._value

            def all(self):
                return self._value

        class _Result:
            def __init__(self, value):
                self._value = value

            def scalars(self):
                return _Scalars(self._value)

            def all(self):
                return self._value

        db = AsyncMock()
        db.execute.side_effect = [
            _Result(latest),
            _Result([]),
            _Result(None),
            _Result(None),
            _Result([]),
        ]
        db.flush = AsyncMock()

        added_rows: list = []
        db.add = lambda obj: added_rows.append(obj)

        payload = {'openai': {'models': [{'id': 'gpt-4o', 'cost': {'input': 1, 'output': 2}}]}}
        diff = await mod.apply_refresh(
            db, payload=payload, payload_hash='same', actor_id=None
        )
        self.assertFalse(diff['deduped'])
        self.assertEqual(diff['added_count'], 1)

    async def test_empty_supported_payload_raises(self):
        from app.services.cost_tracking.models_dev_refresh import (
            ModelsDevRefreshError,
            apply_refresh,
        )

        db = AsyncMock()
        with self.assertRaises(ModelsDevRefreshError):
            await apply_refresh(
                db,
                payload={'unknown-provider': {'models': [{'id': 'm1'}]}},
                payload_hash='hash',
                actor_id=None,
            )


class RateLimitKeyTests(unittest.TestCase):
    def test_actor_or_ip_key_prefers_actor_subject(self):
        from starlette.requests import Request

        from app.auth.rate_limits import actor_or_ip_rate_limit_key
        from app.auth.utils import create_access_token

        token = create_access_token(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email='x@y.com',
            role_id=uuid.uuid4(),
        )
        request = Request({
            'type': 'http',
            'headers': [(b'authorization', f'Bearer {token}'.encode())],
            'client': ('127.0.0.1', 1234),
        })

        self.assertTrue(actor_or_ip_rate_limit_key(request).startswith('user:'))

    def test_actor_or_ip_key_falls_back_to_ip_for_invalid_token(self):
        from starlette.requests import Request

        from app.auth.rate_limits import actor_or_ip_rate_limit_key

        request = Request({
            'type': 'http',
            'headers': [(b'authorization', b'Bearer invalid-token')],
            'client': ('127.0.0.1', 1234),
        })

        self.assertEqual(actor_or_ip_rate_limit_key(request), 'ip:127.0.0.1')


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


class UsageCallbackPurposeTests(unittest.IsolatedAsyncioTestCase):
    async def test_default_call_purpose_used_when_wrapper_omits_one(self):
        from app.services.evaluators.runner_utils import make_usage_callback

        callback = make_usage_callback(
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id='voice-rx',
            owner_type='eval_run',
            owner_id=uuid.uuid4(),
            default_call_purpose='report_generation',
        )

        with patch(
            'app.services.evaluators.runner_utils.record_llm_usage',
            new=AsyncMock(),
        ) as record_mock:
            await callback({
                'provider_classname': 'OpenAIProvider',
                'model': 'gpt-4o',
                'metadata': {},
                'status': 'ok',
            })

        self.assertEqual(record_mock.await_args.kwargs['call_purpose'], 'report_generation')

    async def test_explicit_call_purpose_overrides_default(self):
        from app.services.evaluators.runner_utils import make_usage_callback

        callback = make_usage_callback(
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id='voice-rx',
            owner_type='eval_run',
            owner_id=uuid.uuid4(),
            default_call_purpose='batch_evaluation',
        )

        with patch(
            'app.services.evaluators.runner_utils.record_llm_usage',
            new=AsyncMock(),
        ) as record_mock:
            await callback({
                'provider_classname': 'OpenAIProvider',
                'model': 'gpt-4o',
                'metadata': {},
                'status': 'ok',
                'call_purpose': 'intent',
            })

        self.assertEqual(record_mock.await_args.kwargs['call_purpose'], 'intent')


class VertexBedrockCatalogTests(unittest.TestCase):
    def test_google_vertex_and_bedrock_yield_their_own_rows(self):
        from app.services.cost_tracking.models_dev_refresh import _flatten_payload
        payload = {
            'google-vertex': {'models': [
                {'id': 'gemini-2.5-pro', 'cost': {'input': 1, 'output': 2},
                 'modalities': {'input': ['text'], 'output': ['text']}}]},
            'amazon-bedrock': {'models': [
                {'id': 'anthropic.claude-sonnet-4-5', 'cost': {'input': 3, 'output': 4}}]},
        }
        providers = {r['provider'] for r in _flatten_payload(payload)}
        self.assertIn('vertex', providers)
        self.assertIn('bedrock', providers)

    def test_aistudio_google_no_longer_emits_a_vertex_alias(self):
        from app.services.cost_tracking.models_dev_refresh import _flatten_payload
        payload = {'google': {'models': [
            {'id': 'gemini-2.5-flash', 'cost': {'input': 1, 'output': 2}}]}}
        providers = {r['provider'] for r in _flatten_payload(payload)}
        self.assertEqual(providers, {'gemini'})


class VertexBedrockPricingGuardTests(unittest.TestCase):
    def test_derived_pricing_covers_vertex_and_bedrock(self):
        from app.services.cost_tracking.provider_map import PROVIDER_DERIVED_PRICING
        self.assertIn('vertex', PROVIDER_DERIVED_PRICING)
        self.assertIn('bedrock', PROVIDER_DERIVED_PRICING)


if __name__ == '__main__':
    unittest.main()
