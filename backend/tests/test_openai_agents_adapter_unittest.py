import asyncio
import json
import unittest
from typing import Any
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from openai.types.responses import ResponseTextDeltaEvent

from app.services.chat_engine.openai_agents_adapter import (
    SherlockContext,
    build_sherlock_agent,
    build_sherlock_tools,
    create_openai_client,
)
from app.services.report_builder.scratchpad_state import default_scratchpad


class SherlockContextTests(unittest.TestCase):
    def test_context_holds_platform_state_including_provider(self):
        ctx = SherlockContext(
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='azure_openai',
            working_session={'scratchpad': {}, 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )

        self.assertEqual(ctx.app_id, 'kaira-bot')
        self.assertEqual(ctx.provider, 'azure_openai')
        self.assertIsNotNone(ctx.auth)

    def test_context_does_not_carry_db_session(self):
        """Tool handlers open their own session inside the handler to avoid
        concurrent-ops races (the Agents SDK runs tools in parallel)."""
        import dataclasses

        field_names = {f.name for f in dataclasses.fields(SherlockContext)}
        self.assertNotIn('db', field_names)


class ParseToolArgsTests(unittest.TestCase):
    """The Responses API sends ``"{}"`` for tools with all-optional params;
    that must be a valid empty-args call, not a 'malformed' error."""

    def test_empty_object_is_valid_empty_args(self):
        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        self.assertEqual(_parse_tool_args('{}'), {})

    def test_empty_string_is_valid_empty_args(self):
        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        self.assertEqual(_parse_tool_args(''), {})

    def test_whitespace_only_is_valid_empty_args(self):
        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        self.assertEqual(_parse_tool_args('   '), {})

    def test_valid_dict_returned_intact(self):
        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        self.assertEqual(
            _parse_tool_args('{"app_id":"voice-rx","limit":10}'),
            {'app_id': 'voice-rx', 'limit': 10},
        )

    def test_json_null_is_malformed(self):
        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        self.assertIsNone(_parse_tool_args('null'))

    def test_json_array_is_malformed(self):
        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        self.assertIsNone(_parse_tool_args('[1,2,3]'))

    def test_parse_error_is_malformed(self):
        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        self.assertIsNone(_parse_tool_args('{not-json'))


class BuildToolsTests(unittest.TestCase):
    def test_creates_function_tools_from_json_definitions(self):
        tool_defs = [
            {
                'name': 'data_query',
                'description': 'Answer analytical questions.',
                'inputSchema': {
                    'type': 'object',
                    'properties': {'question': {'type': 'string'}},
                    'required': ['question'],
                },
            },
            {
                'name': 'blueprint_save',
                'description': 'Persist a blueprint.',
                'inputSchema': {
                    'type': 'object',
                    'properties': {'name': {'type': 'string'}},
                    'required': ['name'],
                },
            },
        ]

        tools = build_sherlock_tools(tool_defs)

        self.assertEqual(len(tools), 2)
        self.assertEqual(tools[0].name, 'data_query')
        self.assertEqual(tools[1].name, 'blueprint_save')

    def test_tool_schemas_use_non_strict_mode(self):
        tool_defs = [
            {
                'name': 'discover',
                'description': 'Discover dimensions.',
                'inputSchema': {
                    'type': 'object',
                    'properties': {},
                    'required': [],
                },
            },
        ]

        tools = build_sherlock_tools(tool_defs)

        self.assertFalse(tools[0].strict_json_schema)


class ClientFactoryTests(unittest.TestCase):
    def test_creates_native_openai_client(self):
        import openai

        client = create_openai_client(api_key='test-key', azure=False)

        self.assertIsInstance(client, openai.AsyncOpenAI)

    def test_creates_azure_openai_client(self):
        import openai

        client = create_openai_client(
            api_key='test-key',
            azure=True,
            azure_endpoint='https://sanp-ai.openai.azure.com',
            api_version='2025-04-01-preview',
        )

        self.assertIsInstance(client, openai.AsyncAzureOpenAI)


class AgentConfigurationTests(unittest.TestCase):
    def test_agent_uses_openai_responses_model(self):
        from agents.models.openai_responses import OpenAIResponsesModel

        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=False,
        )

        self.assertIsInstance(agent.model, OpenAIResponsesModel)

    def test_agent_uses_chat_completions_model_is_forbidden(self):
        from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel

        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=False,
        )

        self.assertNotIsInstance(agent.model, OpenAIChatCompletionsModel)

    def test_agent_temperature_is_point_three(self):
        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=False,
        )

        self.assertEqual(agent.model_settings.temperature, 0.3)

    def test_tool_choice_required_when_forced(self):
        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=True,
        )

        self.assertEqual(agent.model_settings.tool_choice, 'required')

    def test_tool_choice_auto_when_not_forced(self):
        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=False,
        )

        self.assertIn(agent.model_settings.tool_choice, (None, 'auto'))


class StreamingBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_content_deltas_flow_through_queue(self):
        from app.services.chat_engine.openai_agents_adapter import run_sherlock_sdk_turn

        ctx = SherlockContext(
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='openai',
            working_session={'scratchpad': {}, 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )

        mock_stream = MagicMock()
        mock_event = MagicMock()
        mock_event.type = 'raw_response_event'
        mock_event.data = ResponseTextDeltaEvent.model_construct(
            content_index=0,
            delta='Pass rate is 91%',
            item_id='output_1',
            logprobs=[],
            output_index=0,
            sequence_number=1,
            type='response.output_text.delta',
        )

        async def fake_stream_events():
            yield mock_event

        mock_stream.stream_events = fake_stream_events
        mock_stream.final_output = 'Pass rate is 91%'
        mock_stream.last_response_id = 'resp_abc123'

        with patch('app.services.chat_engine.openai_agents_adapter.Runner') as mock_runner:
            mock_runner.run_streamed.return_value = mock_stream

            events = []
            async for event in run_sherlock_sdk_turn(
                user_message='show pass rate',
                instructions='You are Sherlock.',
                tools=[],
                sherlock_context=ctx,
                model='gpt-5.4',
                client=MagicMock(),
            ):
                events.append(event)

        content_deltas = [event for event in events if event['event'] == 'content_delta']
        self.assertTrue(len(content_deltas) >= 1)
        self.assertEqual(content_deltas[0]['data']['delta'], 'Pass rate is 91%')
        self.assertEqual([event for event in events if event['event'] == 'done'], [])
        self.assertEqual([event for event in events if event['event'] == 'chart'], [])
        self.assertEqual([event for event in events if event['event'] == 'blueprint'], [])

        internal = [event for event in events if event['event'] == '_internal_turn_complete']
        self.assertEqual(len(internal), 1)
        self.assertEqual(internal[0]['data']['last_response_id'], 'resp_abc123')
        self.assertEqual(internal[0]['data']['final_output'], 'Pass rate is 91%')

    async def test_legacy_tool_aliases_are_canonicalized_in_runtime_events(self):
        from app.services.chat_engine.openai_agents_adapter import _sherlock_tool_handler

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        tool_db = AsyncMock()
        sc = SherlockContext(
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='openai',
            working_session={'scratchpad': default_scratchpad(), 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )
        ctx = SimpleNamespace(context=sc, tool_name='analyze', tool_call_id='tc_1')

        with patch('app.database.async_session', return_value=_SessionCtx(tool_db)), patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=AsyncMock(return_value=json.dumps({'status': 'ok', 'row_count': 3, 'question': 'show rows'})),
        ) as dispatch_mock:
            result = await _sherlock_tool_handler(ctx, '{"question":"show rows"}')

        self.assertEqual(json.loads(result)['row_count'], 3)
        self.assertEqual(dispatch_mock.await_args.args[0], 'data_query')
        self.assertEqual(sc.tool_call_log[0]['name'], 'data_query')
        emitted_names = [call.args[0]['data']['name'] for call in sc.emit.await_args_list[:2]]
        self.assertEqual(emitted_names, ['data_query', 'data_query'])

    async def test_fatal_alias_contract_error_aborts_tool_turn(self):
        from app.services.chat_engine.openai_agents_adapter import _sherlock_tool_handler

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        tool_db = AsyncMock()
        sc = SherlockContext(
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='openai',
            working_session={'scratchpad': default_scratchpad(), 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )
        ctx = SimpleNamespace(context=sc, tool_name='data_query', tool_call_id='tc_1')

        payload = json.dumps({
            'status': 'error',
            'reason': 'invalid_output_alias_contract',
            'error': 'Generated query failed validation: bad alias',
            'question': 'show pass rate by rule_id',
        })

        with patch('app.database.async_session', return_value=_SessionCtx(tool_db)), patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=AsyncMock(return_value=payload),
        ):
            with self.assertRaisesRegex(RuntimeError, 'bad alias'):
                await _sherlock_tool_handler(ctx, '{"question":"show pass rate by rule_id"}')

        emitted_events = [call.args[0]['event'] for call in sc.emit.await_args_list]
        self.assertEqual(emitted_events, ['tool_call_start', 'tool_call_end'])

    async def test_run_sherlock_sdk_turn_propagates_runner_errors(self):
        from app.services.chat_engine.openai_agents_adapter import run_sherlock_sdk_turn

        ctx = SherlockContext(
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='openai',
            working_session={'scratchpad': {}, 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )

        mock_stream = MagicMock()

        async def fake_stream_events():
            raise RuntimeError('fatal tool failure')
            yield  # pragma: no cover

        mock_stream.stream_events = fake_stream_events
        mock_stream.final_output = ''
        mock_stream.last_response_id = None

        with patch('app.services.chat_engine.openai_agents_adapter.Runner') as mock_runner:
            mock_runner.run_streamed.return_value = mock_stream

            with self.assertRaisesRegex(RuntimeError, 'fatal tool failure'):
                async for _event in run_sherlock_sdk_turn(
                    user_message='show pass rate',
                    instructions='You are Sherlock.',
                    tools=[],
                    sherlock_context=ctx,
                    model='gpt-5.4',
                    client=MagicMock(),
                ):
                    pass


class StatusLineTests(unittest.TestCase):
    """B3: adapter emits a 'status' event after tool_call_end with a
    friendly sentence that the UI renders verbatim as shimmer text."""

    def test_status_line_known_tool_uses_friendly_noun(self):
        from app.services.chat_engine.openai_agents_adapter import _status_line_after_tool

        self.assertIn('query', _status_line_after_tool('data_query'))
        self.assertIn('schema inspection', _status_line_after_tool('catalog_inspect'))
        self.assertIn('entity resolution', _status_line_after_tool('resolve_entity'))

    def test_status_line_unknown_tool_falls_back(self):
        from app.services.chat_engine.openai_agents_adapter import _status_line_after_tool

        line = _status_line_after_tool('mystery_tool')
        self.assertTrue(line.startswith('Reasoning'))
        self.assertTrue(line.endswith('…'))


class StreamPacerTests(unittest.IsolatedAsyncioTestCase):
    """Server-side pacer that evens out bursty LLM token streams.

    Contract under test:
      1. A single blob of text is split into multiple paced chunks.
      2. Non-text events (tool_call_*/status/error) flush buffered text
         before themselves — ordering is preserved.
      3. finalize() drains the remainder immediately and stops the ticker.
      4. Empty-delta calls are no-ops.
    """

    async def _drain(self, queue: asyncio.Queue) -> list[dict]:
        out: list[dict] = []
        while not queue.empty():
            out.append(queue.get_nowait())
        return out

    async def test_text_is_split_into_paced_chunks(self):
        from app.services.chat_engine.openai_agents_adapter import _StreamPacer

        q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        pacer = _StreamPacer(q)
        pacer.start()
        # Enough text that natural drain can't be a single chunk.
        text = 'The quick brown fox jumps over the lazy dog. ' * 10
        await pacer.enqueue_text(text)
        # Let the ticker run for ~600ms — enough to fully drain at 25ms/tick.
        await asyncio.sleep(0.6)
        await pacer.finalize()

        events = await self._drain(q)
        self.assertTrue(all(e['event'] == 'content_delta' for e in events))
        self.assertEqual(''.join(e['data']['delta'] for e in events), text)
        self.assertGreaterEqual(len(events), 2, 'pacer should emit in multiple chunks')

    async def test_non_text_event_flushes_buffered_text_first(self):
        from app.services.chat_engine.openai_agents_adapter import _StreamPacer

        q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        pacer = _StreamPacer(q)
        pacer.start()
        # Queue text, then immediately emit a tool_call_start — it MUST
        # arrive after every text chunk, not interleaved.
        await pacer.enqueue_text('first half of a sentence ')
        await pacer.enqueue_other({'event': 'tool_call_start', 'data': {'toolName': 'data_query'}})
        await pacer.enqueue_text('second half of a sentence')
        await pacer.finalize()

        events = await self._drain(q)
        tool_index = next(i for i, e in enumerate(events) if e['event'] == 'tool_call_start')
        pre = ''.join(e['data']['delta'] for e in events[:tool_index] if e['event'] == 'content_delta')
        post = ''.join(e['data']['delta'] for e in events[tool_index + 1:] if e['event'] == 'content_delta')
        self.assertEqual(pre, 'first half of a sentence ')
        self.assertEqual(post, 'second half of a sentence')

    async def test_finalize_drains_remaining_and_stops_ticker(self):
        from app.services.chat_engine.openai_agents_adapter import _StreamPacer

        q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        pacer = _StreamPacer(q)
        pacer.start()
        await pacer.enqueue_text('short burst')
        # finalize BEFORE ticker would naturally drain — drain must happen anyway.
        await pacer.finalize()

        events = await self._drain(q)
        self.assertEqual(''.join(e['data']['delta'] for e in events), 'short burst')
        self.assertTrue(pacer._task is None or pacer._task.done())

    async def test_empty_delta_is_noop(self):
        from app.services.chat_engine.openai_agents_adapter import _StreamPacer

        q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        pacer = _StreamPacer(q)
        pacer.start()
        await pacer.enqueue_text('')
        await pacer.finalize()
        self.assertTrue(q.empty())

    async def test_finalize_is_idempotent(self):
        from app.services.chat_engine.openai_agents_adapter import _StreamPacer

        q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        pacer = _StreamPacer(q)
        pacer.start()
        await pacer.enqueue_text('hello')
        await pacer.finalize()
        # Second finalize must not raise or re-emit.
        await pacer.finalize()
        events = await self._drain(q)
        self.assertEqual(''.join(e['data']['delta'] for e in events), 'hello')
