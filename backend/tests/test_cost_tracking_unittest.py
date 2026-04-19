"""Unit tests for the cost_tracking module (Phase 1)."""
from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.cost_tracking.correlation import (
    CORRELATION_ID,
    get_correlation_id,
    reset_correlation_id,
    set_correlation_id,
)
from app.services.cost_tracking.models import empty_metadata
from app.services.cost_tracking.normalizers import (
    normalize_anthropic,
    normalize_gemini,
    normalize_openai_chat,
    normalize_openai_responses,
)
from app.services.cost_tracking.pricing import PricingRow, compute_cost
from app.services.cost_tracking.pricing_cache import PricingCache
from app.services.cost_tracking.provider_map import (
    ALLOWLIST,
    PROVIDER_MAP,
    internal_provider_from_classname,
    model_family_for,
)


def _pricing_row(**overrides) -> PricingRow:
    defaults: dict = {
        'id': uuid.uuid4(),
        'provider': 'openai',
        'model': 'gpt-4o-mini',
        'effective_from': datetime(2026, 1, 1, tzinfo=timezone.utc),
        'effective_to': None,
        'input_per_1m_usd': Decimal('1'),
        'cached_read_per_1m_usd': Decimal('0.5'),
        'cache_write_5m_per_1m_usd': Decimal('2'),
        'cache_write_1h_per_1m_usd': Decimal('4'),
        'output_per_1m_usd': Decimal('4'),
        'reasoning_per_1m_usd': Decimal('4'),
        'audio_input_per_1m_usd': None,
        'audio_input_per_minute_usd': None,
        'image_input_per_1m_usd': None,
        'server_tool_prices': None,
        'currency': 'USD',
        'source': 'bootstrap',
    }
    defaults.update(overrides)
    return PricingRow(**defaults)


class ProviderMapTests(unittest.TestCase):
    def test_allowlist_matches_provider_map_keys(self):
        self.assertEqual(ALLOWLIST, frozenset(PROVIDER_MAP.keys()))

    def test_internal_provider_from_classname(self):
        self.assertEqual(internal_provider_from_classname('GeminiProvider'), 'gemini')
        self.assertEqual(internal_provider_from_classname('OpenAIProvider'), 'openai')
        self.assertEqual(
            internal_provider_from_classname('AzureOpenAIProvider'), 'azure_openai'
        )
        self.assertEqual(
            internal_provider_from_classname('AnthropicProvider'), 'anthropic'
        )
        self.assertEqual(internal_provider_from_classname('Unknown'), 'unknown')

    def test_model_family_detection(self):
        self.assertEqual(model_family_for('openai', 'gpt-4o-mini'), 'gpt-4o')
        self.assertEqual(model_family_for('gemini', 'gemini-2.5-pro'), 'gemini-2.5')
        self.assertEqual(
            model_family_for('anthropic', 'claude-sonnet-4-6'), 'claude-sonnet'
        )
        self.assertIsNone(model_family_for('unknown_provider', 'unknown-model'))


class ComputeCostTests(unittest.TestCase):
    def test_zero_tokens_zero_cost(self):
        cost, breakdown, fallback = compute_cost(_pricing_row(), input_tokens=0, output_tokens=0)
        self.assertEqual(cost, Decimal('0'))
        self.assertEqual(breakdown['total_usd'], '0')
        self.assertFalse(fallback)

    def test_missing_pricing_marks_fallback(self):
        cost, breakdown, fallback = compute_cost(None, input_tokens=1000)
        self.assertEqual(cost, Decimal('0'))
        self.assertTrue(fallback)
        self.assertEqual(breakdown['reason'], 'pricing_missing')

    def test_line_items_sum_to_total(self):
        cost, breakdown, _ = compute_cost(
            _pricing_row(),
            input_tokens=1_000_000,  # 1M @ $1 = $1
            output_tokens=500_000,  # 0.5M @ $4 = $2
            cached_read_tokens=200_000,  # 0.2M @ $0.5 = $0.1
            reasoning_tokens=100_000,  # 0.1M @ $4 = $0.4
        )
        self.assertEqual(cost, Decimal('3.50000000'))
        self.assertIn('input', breakdown)
        self.assertIn('output', breakdown)
        self.assertIn('cached_read', breakdown)
        self.assertIn('reasoning', breakdown)

    def test_cache_write_ttl_1h_picks_higher_rate(self):
        cost, breakdown, _ = compute_cost(
            _pricing_row(),
            cached_write_tokens=1_000_000,
            cached_write_ttl='1h',
        )
        # 1M @ $4 per 1M = $4
        self.assertEqual(cost, Decimal('4.00000000'))
        self.assertEqual(breakdown['cached_write']['ttl'], '1h')

    def test_cache_write_defaults_to_5m(self):
        cost, _breakdown, _ = compute_cost(
            _pricing_row(),
            cached_write_tokens=1_000_000,
        )
        # 1M @ $2 per 1M = $2
        self.assertEqual(cost, Decimal('2.00000000'))

    def test_audio_per_minute(self):
        pricing = _pricing_row(audio_input_per_minute_usd=Decimal('0.012'))
        cost, breakdown, _ = compute_cost(pricing, audio_seconds=60.0)
        # 1 minute @ $0.012 = $0.012
        self.assertEqual(cost, Decimal('0.01200000'))
        self.assertIn('audio_input', breakdown)


class NormalizerTests(unittest.TestCase):
    def test_gemini_splits_cached_and_reasoning(self):
        response = SimpleNamespace(
            usage_metadata=SimpleNamespace(
                prompt_token_count=1200,
                candidates_token_count=300,
                cached_content_token_count=800,
                thoughts_token_count=100,
                tool_use_prompt_token_count=0,
            ),
            candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name='STOP'))],
        )
        meta = normalize_gemini(response)
        self.assertEqual(meta['provider'], 'gemini')
        self.assertEqual(meta['input_tokens'], 400)  # 1200 - 800 cached
        self.assertEqual(meta['cached_read_tokens'], 800)
        self.assertEqual(meta['output_tokens'], 300)
        self.assertEqual(meta['reasoning_tokens'], 100)
        self.assertEqual(meta['finish_reason'], 'STOP')

    def test_gemini_missing_usage_produces_zero_row(self):
        response = SimpleNamespace(usage_metadata=None)
        meta = normalize_gemini(response)
        self.assertEqual(meta['input_tokens'], 0)
        self.assertEqual(meta['output_tokens'], 0)
        self.assertNotIn('finish_reason', meta)

    def test_openai_chat_splits_cached_and_reasoning(self):
        response = SimpleNamespace(
            id='chatcmpl-abc',
            usage=SimpleNamespace(
                prompt_tokens=1000,
                completion_tokens=500,
                prompt_tokens_details=SimpleNamespace(cached_tokens=600),
                completion_tokens_details=SimpleNamespace(reasoning_tokens=200),
            ),
            choices=[SimpleNamespace(finish_reason='stop')],
        )
        meta = normalize_openai_chat(response)
        self.assertEqual(meta['provider'], 'openai')
        self.assertEqual(meta['input_tokens'], 400)
        self.assertEqual(meta['cached_read_tokens'], 600)
        self.assertEqual(meta['output_tokens'], 300)
        self.assertEqual(meta['reasoning_tokens'], 200)
        self.assertEqual(meta['request_id'], 'chatcmpl-abc')
        self.assertEqual(meta['finish_reason'], 'stop')

    def test_openai_responses_basic(self):
        response = SimpleNamespace(
            id='resp_1',
            status='completed',
            usage=SimpleNamespace(
                input_tokens=800,
                output_tokens=400,
                input_tokens_details={'cached_tokens': 100},
                output_tokens_details={'reasoning_tokens': 250},
            ),
        )
        meta = normalize_openai_responses(response)
        self.assertEqual(meta['api_surface'], 'responses')
        self.assertEqual(meta['input_tokens'], 700)
        self.assertEqual(meta['cached_read_tokens'], 100)
        self.assertEqual(meta['output_tokens'], 150)
        self.assertEqual(meta['reasoning_tokens'], 250)
        self.assertEqual(meta['request_id'], 'resp_1')
        self.assertEqual(meta['finish_reason'], 'completed')

    def test_anthropic_cache_write_ttl_detection(self):
        response = SimpleNamespace(
            id='msg_1',
            stop_reason='end_turn',
            usage=SimpleNamespace(
                input_tokens=500,
                output_tokens=200,
                cache_read_input_tokens=100,
                cache_creation_input_tokens=300,
                cache_creation={'ephemeral_5m_input_tokens': 50, 'ephemeral_1h_input_tokens': 250},
            ),
        )
        meta = normalize_anthropic(response)
        self.assertEqual(meta['provider'], 'anthropic')
        self.assertEqual(meta['input_tokens'], 500)
        self.assertEqual(meta['cached_read_tokens'], 100)
        self.assertEqual(meta['cached_write_tokens'], 300)
        self.assertEqual(meta['cached_write_ttl'], '1h')
        self.assertEqual(meta['finish_reason'], 'end_turn')

    def test_anthropic_does_not_fabricate_server_tool_usage(self):
        response = SimpleNamespace(
            usage=SimpleNamespace(
                input_tokens=10,
                output_tokens=20,
                cache_read_input_tokens=0,
                cache_creation_input_tokens=0,
            ),
        )
        meta = normalize_anthropic(response)
        self.assertNotIn('server_tool_usage', meta)


class CorrelationContextTests(unittest.TestCase):
    def test_set_and_reset(self):
        self.assertIsNone(get_correlation_id())
        corr_id = uuid.uuid4()
        token = set_correlation_id(corr_id)
        self.assertEqual(get_correlation_id(), corr_id)
        reset_correlation_id(token)
        self.assertIsNone(CORRELATION_ID.get())


class PricingCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_cache_hit_avoids_refetch(self):
        cache = PricingCache(ttl_seconds=60, max_entries=10)
        at = datetime(2026, 4, 19, 12, 0, 0, tzinfo=timezone.utc)
        row = _pricing_row(provider='openai', model='gpt-4o-mini')
        with patch(
            'app.services.cost_tracking.pricing_cache.fetch_pricing',
            AsyncMock(return_value=row),
        ) as fetch_mock:
            first = await cache.get(AsyncMock(), 'openai', 'gpt-4o-mini', at)
            second = await cache.get(AsyncMock(), 'openai', 'gpt-4o-mini', at)
        self.assertIs(first, row)
        self.assertIs(second, row)
        self.assertEqual(fetch_mock.await_count, 1)

    async def test_cache_miss_after_invalidate(self):
        cache = PricingCache(ttl_seconds=60, max_entries=10)
        at = datetime(2026, 4, 19, 12, 0, 0, tzinfo=timezone.utc)
        row_a = _pricing_row()
        row_b = _pricing_row(id=uuid.uuid4())
        with patch(
            'app.services.cost_tracking.pricing_cache.fetch_pricing',
            AsyncMock(side_effect=[row_a, row_b]),
        ) as fetch_mock:
            await cache.get(AsyncMock(), 'openai', 'gpt-4o-mini', at)
            cache.invalidate()
            second = await cache.get(AsyncMock(), 'openai', 'gpt-4o-mini', at)
        self.assertIs(second, row_b)
        self.assertEqual(fetch_mock.await_count, 2)


class RecorderSwallowsErrorsTests(unittest.IsolatedAsyncioTestCase):
    async def test_recorder_never_raises(self):
        """Pricing lookup failure + caller rollback: recorder returns None, not raise."""
        from app.services.cost_tracking.recorder import (
            record_llm_usage,
            reset_failure_count,
            get_failure_count,
        )

        reset_failure_count()

        # Force pricing_cache.get to raise so we exercise the swallow path.
        async def _raise(*args, **kwargs):
            raise RuntimeError('boom')

        with patch(
            'app.services.cost_tracking.recorder.pricing_cache.get',
            side_effect=_raise,
        ):
            # async_session() is a real contextmanager over the real engine;
            # we short-circuit before it is invoked.
            result = await record_llm_usage(
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                app_id='voice-rx',
                owner_type='eval_run',
                provider='openai',
                model='gpt-4o-mini',
                metadata=empty_metadata(),
            )
        self.assertIsNone(result)
        self.assertGreaterEqual(get_failure_count(), 1)


if __name__ == '__main__':
    unittest.main()
