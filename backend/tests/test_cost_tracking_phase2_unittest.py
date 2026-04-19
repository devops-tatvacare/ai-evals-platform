"""Phase 2 unit tests: correlation middleware, Sherlock turn context, aggregation,
entity-recognition wrap, and the Agents SDK CostTrackingProcessor shape.
"""
from __future__ import annotations

import asyncio
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.cost_tracking.aggregation import aggregate_turn_usage
from app.services.cost_tracking.correlation import (
    CORRELATION_ID,
    SHERLOCK_TURN_CONTEXT,
    SherlockTurnContext,
    get_correlation_id,
    get_sherlock_turn_context,
    reset_correlation_id,
    reset_sherlock_turn_context,
    set_correlation_id,
    set_sherlock_turn_context,
)
from app.services.cost_tracking.tracing.agents_tracing_processor import (
    CostTrackingProcessor,
    _extract_span_metadata,
    _has_real_usage,
)


class CorrelationContextVarTests(unittest.TestCase):
    def test_correlation_set_reset(self):
        self.assertIsNone(get_correlation_id())
        cid = uuid.uuid4()
        token = set_correlation_id(cid)
        self.assertEqual(get_correlation_id(), cid)
        reset_correlation_id(token)
        self.assertIsNone(CORRELATION_ID.get())

    def test_sherlock_turn_context_set_reset(self):
        self.assertIsNone(get_sherlock_turn_context())
        ctx = SherlockTurnContext(
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id='kaira-bot',
            turn_id=uuid.uuid4(),
        )
        token = set_sherlock_turn_context(ctx)
        self.assertIs(get_sherlock_turn_context(), ctx)
        reset_sherlock_turn_context(token)
        self.assertIsNone(SHERLOCK_TURN_CONTEXT.get())


class CorrelationMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def test_middleware_sets_contextvar_for_request_duration(self):
        from app.middleware.correlation import CorrelationIdMiddleware

        observed: list[uuid.UUID | None] = []

        async def fake_app(scope, receive, send):
            observed.append(get_correlation_id())
            await send({'type': 'http.response.start', 'status': 200, 'headers': []})
            await send({'type': 'http.response.body', 'body': b'ok'})

        mw = CorrelationIdMiddleware(fake_app)
        sent: list[dict] = []

        async def _recv():
            return {'type': 'http.request', 'body': b'', 'more_body': False}

        async def _send(msg):
            sent.append(msg)

        scope = {'type': 'http', 'headers': [], 'path': '/api/health'}
        await mw(scope, _recv, _send)

        self.assertEqual(len(observed), 1)
        self.assertIsInstance(observed[0], uuid.UUID)
        # ContextVar is reset once the request completes.
        self.assertIsNone(get_correlation_id())
        # Correlation id echoes back on the response.
        start = next(m for m in sent if m['type'] == 'http.response.start')
        header_names = [h[0] for h in start.get('headers') or []]
        self.assertIn(b'x-correlation-id', header_names)

    async def test_middleware_honors_inbound_header(self):
        from app.middleware.correlation import CorrelationIdMiddleware

        inbound = uuid.uuid4()

        async def fake_app(scope, receive, send):
            await send({'type': 'http.response.start', 'status': 200, 'headers': []})
            await send({'type': 'http.response.body', 'body': b''})

        mw = CorrelationIdMiddleware(fake_app)
        sent: list[dict] = []

        async def _recv():
            return {'type': 'http.request', 'body': b'', 'more_body': False}

        async def _send(msg):
            sent.append(msg)

        scope = {
            'type': 'http',
            'headers': [(b'x-correlation-id', str(inbound).encode('ascii'))],
            'path': '/api/x',
        }
        await mw(scope, _recv, _send)

        start = next(m for m in sent if m['type'] == 'http.response.start')
        echoed = dict(start['headers'])[b'x-correlation-id'].decode('ascii')
        self.assertEqual(echoed, str(inbound))


class AggregateTurnUsageTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_none_when_no_rows(self):
        class _Zero:
            def one(self):
                return (0, 0, 0, 0, 0, 0, 0, 0, 0)

        db = AsyncMock()
        db.execute.return_value = _Zero()
        result = await aggregate_turn_usage(db, owner_type='sherlock_turn', owner_id=uuid.uuid4())
        self.assertIsNone(result)

    async def test_returns_summary_for_rows(self):
        class _Row:
            def one(self):
                return (100, 50, 25, 0, 10, 0, 185, 0.00123, 3)

        db = AsyncMock()
        db.execute.return_value = _Row()
        summary = await aggregate_turn_usage(
            db, owner_type='sherlock_turn', owner_id=uuid.uuid4()
        )
        assert summary is not None
        self.assertEqual(summary['inputTokens'], 100)
        self.assertEqual(summary['outputTokens'], 50)
        self.assertEqual(summary['cachedReadTokens'], 25)
        self.assertEqual(summary['reasoningTokens'], 10)
        self.assertEqual(summary['totalTokens'], 185)
        self.assertEqual(summary['callCount'], 3)
        self.assertAlmostEqual(summary['costUsd'], 0.00123)


class EntityRecognitionWrapTests(unittest.IsolatedAsyncioTestCase):
    async def test_wrap_applied_when_turn_id_provided(self):
        from app.services.chat_engine.entity_recognition import (
            _create_entity_recognition_provider,
        )
        from app.services.evaluators.llm_base import LoggingLLMWrapper

        fake_inner = SimpleNamespace(model_name='gpt-4o-mini')
        with patch(
            'app.services.chat_engine.entity_recognition.create_llm_provider',
            return_value=fake_inner,
        ), patch(
            'app.services.chat_engine.entity_recognition.get_llm_settings_from_db',
            AsyncMock(return_value={'api_key': 'x', 'service_account_path': ''}),
        ):
            result = await _create_entity_recognition_provider(
                provider='openai',
                model='gpt-4o-mini',
                tenant_id=str(uuid.uuid4()),
                user_id=str(uuid.uuid4()),
                app_id='kaira-bot',
                turn_id=str(uuid.uuid4()),
            )
        self.assertIsInstance(result, LoggingLLMWrapper)
        self.assertEqual(result._call_purpose, 'entity_recognition')
        self.assertIsNotNone(result._usage_callback)

    async def test_no_wrap_without_app_id(self):
        from app.services.chat_engine.entity_recognition import (
            _create_entity_recognition_provider,
        )
        from app.services.evaluators.llm_base import LoggingLLMWrapper

        fake_inner = SimpleNamespace(model_name='gpt-4o-mini')
        with patch(
            'app.services.chat_engine.entity_recognition.create_llm_provider',
            return_value=fake_inner,
        ), patch(
            'app.services.chat_engine.entity_recognition.get_llm_settings_from_db',
            AsyncMock(return_value={'api_key': 'x', 'service_account_path': ''}),
        ):
            result = await _create_entity_recognition_provider(
                provider='openai',
                model='gpt-4o-mini',
                tenant_id=str(uuid.uuid4()),
                user_id=str(uuid.uuid4()),
            )
        self.assertNotIsInstance(result, LoggingLLMWrapper)


class CostTrackingProcessorTests(unittest.TestCase):
    def test_extract_metadata_from_response_span_with_response(self):
        response = SimpleNamespace(
            id='resp_1',
            model='gpt-4o-mini',
            status='completed',
            usage=SimpleNamespace(
                input_tokens=100,
                output_tokens=50,
                input_tokens_details=SimpleNamespace(cached_tokens=20),
                output_tokens_details=SimpleNamespace(reasoning_tokens=5),
            ),
        )

        class _FakeResponseSpan:
            # Mimic ResponseSpanData minimally.
            def __init__(self, response, usage):
                self.response = response
                self.usage = usage

        # ResponseSpanData imported inside processor; pass a duck-typed
        # instance that passes isinstance check via actual class below.
        from agents.tracing import ResponseSpanData
        data = ResponseSpanData(response=response, input=None, usage=None)
        meta, model, api_surface = _extract_span_metadata(data)
        assert meta is not None
        self.assertEqual(model, 'gpt-4o-mini')
        self.assertEqual(api_surface, 'agents_sdk_response')
        self.assertEqual(meta['input_tokens'], 80)  # 100 - 20 cached
        self.assertEqual(meta['cached_read_tokens'], 20)
        self.assertEqual(meta['output_tokens'], 45)  # 50 - 5 reasoning
        self.assertEqual(meta['reasoning_tokens'], 5)

    def test_has_real_usage(self):
        self.assertFalse(_has_real_usage({}))
        self.assertFalse(
            _has_real_usage({'input_tokens': 0, 'output_tokens': 0})
        )
        self.assertTrue(_has_real_usage({'input_tokens': 10}))

    def test_on_trace_start_captures_turn_context(self):
        processor = CostTrackingProcessor()
        ctx = SherlockTurnContext(
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id='kaira-bot',
            turn_id=uuid.uuid4(),
        )
        token = set_sherlock_turn_context(ctx)
        try:
            trace = SimpleNamespace(trace_id='trace_1')
            processor.on_trace_start(trace)
            state = processor._traces['trace_1']
            self.assertIs(state.turn_context, ctx)
        finally:
            reset_sherlock_turn_context(token)

    def test_processor_skips_when_no_turn_context(self):
        """on_span_end must never fabricate owner attribution."""
        processor = CostTrackingProcessor()
        trace = SimpleNamespace(trace_id='trace_2')
        processor.on_trace_start(trace)  # captures None as turn_context
        # build a minimal fake span with usage
        span = SimpleNamespace(
            trace_id='trace_2',
            span_data=SimpleNamespace(usage={'input_tokens': 5, 'output_tokens': 5}),
        )
        # Should NOT raise, should NOT schedule a record.
        with patch(
            'app.services.cost_tracking.tracing.agents_tracing_processor._schedule_record'
        ) as scheduler:
            processor.on_span_end(span)
        scheduler.assert_not_called()


class JobWorkerCorrelationTests(unittest.IsolatedAsyncioTestCase):
    async def test_process_job_sets_and_resets_correlation(self):
        from app.services import job_worker

        observed: list[uuid.UUID | None] = []

        async def fake_handler(job_id, params, *, tenant_id, user_id):
            observed.append(get_correlation_id())
            return {'ok': True}

        job_worker.JOB_HANDLERS['cost_tracking_test_job'] = fake_handler
        try:
            result = await job_worker.process_job(
                'job_123',
                'cost_tracking_test_job',
                {
                    'tenant_id': str(uuid.uuid4()),
                    'user_id': str(uuid.uuid4()),
                },
            )
        finally:
            job_worker.JOB_HANDLERS.pop('cost_tracking_test_job', None)

        self.assertEqual(result, {'ok': True})
        self.assertEqual(len(observed), 1)
        self.assertIsInstance(observed[0], uuid.UUID)
        # Must be reset after process_job returns.
        self.assertIsNone(get_correlation_id())


if __name__ == '__main__':
    unittest.main()
