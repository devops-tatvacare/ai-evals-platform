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
        """Phase 3: strict SDK rejects malformed args; the parser raises
        and the handler projects the raise into a ``MALFORMED_ARGS``
        envelope (see ``MalformedArgsDispatcherTests`` below)."""
        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        with self.assertRaises(ValueError):
            _parse_tool_args('null')

    def test_json_array_is_malformed(self):
        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        with self.assertRaises(ValueError):
            _parse_tool_args('[1,2,3]')

    def test_parse_error_is_malformed(self):
        import json as _json

        from app.services.chat_engine.openai_agents_adapter import _parse_tool_args

        with self.assertRaises(_json.JSONDecodeError):
            _parse_tool_args('{not-json')


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

    def test_tool_schemas_use_strict_mode(self):
        """Phase 3 (plan §Phase-3 step 4): strict schemas. Malformed args
        fail at the Agents SDK boundary; the handler's defensive catch
        projects any slipped-through raise into a ``MALFORMED_ARGS``
        envelope (see ``MalformedArgsDispatcherTests``)."""
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

        self.assertTrue(tools[0].strict_json_schema)


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
        )

        self.assertIsInstance(agent.model, OpenAIResponsesModel)

    def test_agent_uses_chat_completions_model_is_forbidden(self):
        from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel

        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
        )

        self.assertNotIsInstance(agent.model, OpenAIChatCompletionsModel)

    def test_agent_temperature_is_point_three(self):
        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
        )

        self.assertEqual(agent.model_settings.temperature, 0.3)

    def test_tool_choice_is_always_auto_phase5(self):
        """Phase 5 §691: ``tool_choice`` is ``'auto'`` always. Both prior
        coercion paths (specific-tool and ``'required'``) are gone."""
        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
        )

        self.assertEqual(agent.model_settings.tool_choice, 'auto')


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

    async def test_sql_alias_contract_error_returns_envelope_without_raising(self):
        """Phase 2: ``invalid_output_alias_contract`` no longer raises
        ``RuntimeError`` from the dispatcher. The outer agent observes
        ``outcome.reason_code = 'SQL_INVALID_OUTPUT_ALIAS_CONTRACT'`` and
        is expected to replan on its own.
        """
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

        envelope_payload = json.dumps({
            'status': 'error',
            'summary': 'query failed',
            'outcome': {
                'kind': 'error',
                'capability': 'analytics',
                'reason_code': 'SQL_INVALID_OUTPUT_ALIAS_CONTRACT',
                'warnings': ['Generated query failed validation: bad alias'],
                'counts': {'rows': 0, 'records': 0, 'affected': 0},
            },
            'payload': {'question': 'show pass rate by rule_id'},
        })

        with patch('app.database.async_session', return_value=_SessionCtx(tool_db)), patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=AsyncMock(return_value=envelope_payload),
        ):
            result = await _sherlock_tool_handler(ctx, '{"question":"show pass rate by rule_id"}')

        self.assertEqual(json.loads(result)['outcome']['reason_code'], 'SQL_INVALID_OUTPUT_ALIAS_CONTRACT')
        emitted_events = [call.args[0]['event'] for call in sc.emit.await_args_list]
        # tool_call_start, tool_call_end, status — status event fires after
        # tool_call_end now that the fatal raise is gone.
        self.assertEqual(emitted_events[:2], ['tool_call_start', 'tool_call_end'])
        self.assertIn('status', emitted_events)
        self.assertEqual(sc.artifacts, [])

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


class PackDispatchTests(unittest.IsolatedAsyncioTestCase):
    """Phase 2: the harness dispatcher extracts ``Artifact`` triples from
    the §6.2 ``ToolEnvelope`` emitted by handlers. Pack ownership is
    broadened so the analytics pack claims ``discover``, ``lookup``,
    ``data_query`` + catalog tools, and the report-builder pack claims
    the blueprint tools. Tools whose envelope carries no ``outcome.artifact``
    slot (most read-only tools) add nothing to ``sc.artifacts``.
    """

    def test_sherlock_context_has_artifacts_not_legacy_fields(self):
        import dataclasses

        field_names = {f.name for f in dataclasses.fields(SherlockContext)}
        self.assertIn('artifacts', field_names)
        self.assertNotIn('chart_payload', field_names)
        self.assertNotIn('composed_report', field_names)

    def test_resolve_pack_id_for_tool_returns_pack_ids_for_claimed_tools(self):
        # Post-audit: pack registry + tool->pack lookup both live in
        # ``capability_pack.py`` (plan §6.3 — one pack registry, one
        # contract owner). The old ``artifact.resolve_pack_for`` bridge was
        # removed.
        from app.services.chat_engine.capability_pack import (
            CAPABILITY_PACK_REGISTRY,
            ensure_packs_registered,
            resolve_pack_id_for_tool,
        )

        ensure_packs_registered()
        self.assertEqual(resolve_pack_id_for_tool('data_query'), 'analytics')
        self.assertEqual(resolve_pack_id_for_tool('blueprint_compose'), 'report_builder')
        # Phase 2 extends pack ownership: the analytics pack claims every
        # analytics-family tool, not just ``data_query``.
        self.assertEqual(resolve_pack_id_for_tool('lookup'), 'analytics')
        self.assertEqual(resolve_pack_id_for_tool('discover'), 'analytics')
        self.assertEqual(resolve_pack_id_for_tool('blueprint_list'), 'report_builder')
        self.assertIsNone(resolve_pack_id_for_tool('mystery_tool'))
        # Phase 8: the registry now also carries the ``contract_stub`` proof
        # pack. Assert the core packs are still present without hard-pinning
        # the full set (new packs are allowed via the registry).
        self.assertGreaterEqual(
            set(CAPABILITY_PACK_REGISTRY),
            {'analytics', 'report_builder'},
        )

    async def _run_dispatcher(self, tool_name: str, envelope_payload: dict):
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
        ctx = SimpleNamespace(context=sc, tool_name=tool_name, tool_call_id='tc_1')

        with patch('app.database.async_session', return_value=_SessionCtx(tool_db)), patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=AsyncMock(return_value=json.dumps(envelope_payload)),
        ):
            await _sherlock_tool_handler(ctx, '{}')
        return sc

    async def test_data_query_ok_appends_analytics_chart_artifact(self):
        envelope = {
            'status': 'ok',
            'summary': '1 rows',
            'outcome': {
                'kind': 'artifact',
                'capability': 'analytics',
                'reason_code': None,
                'warnings': [],
                'counts': {'rows': 1, 'records': 0, 'affected': 0},
                'artifact': {
                    'type': 'chart',
                    'contract': 'analytics.chart.v1',
                    'extras': {'rendered_as': 'bar', 'top_n': None},
                },
            },
            'payload': {
                'chart': {'kind': 'chart', 'spec': {}, 'data': [], 'title': 't'},
                'row_count': 1,
                'data': [],
            },
        }
        sc = await self._run_dispatcher('data_query', envelope)

        self.assertEqual(len(sc.artifacts), 1)
        artifact = sc.artifacts[0]
        self.assertEqual(artifact.pack_id, 'analytics')
        self.assertEqual(artifact.contract_id, 'analytics.chart.v1')
        self.assertEqual(artifact.payload['kind'], 'chart')
        self.assertEqual(artifact.extras, {'rendered_as': 'bar', 'top_n': None})

    async def test_blueprint_compose_ok_appends_report_builder_artifact(self):
        envelope = {
            'status': 'ok',
            'summary': "blueprint composed",
            'outcome': {
                'kind': 'artifact',
                'capability': 'report_builder',
                'reason_code': None,
                'warnings': [],
                'counts': {'rows': 0, 'records': 0, 'affected': 0},
                'artifact': {
                    'type': 'blueprint',
                    'contract': 'report_builder.blueprint.v1',
                    'extras': {},
                },
            },
            'payload': {
                'blueprint': {'name': 'Weekly review', 'sections': []},
            },
        }
        sc = await self._run_dispatcher('blueprint_compose', envelope)

        self.assertEqual(len(sc.artifacts), 1)
        artifact = sc.artifacts[0]
        self.assertEqual(artifact.pack_id, 'report_builder')
        self.assertEqual(artifact.contract_id, 'report_builder.blueprint.v1')
        self.assertEqual(artifact.payload['name'], 'Weekly review')

    async def test_data_query_error_does_not_append_artifact(self):
        envelope = {
            'status': 'error',
            'summary': 'query failed',
            'outcome': {
                'kind': 'error',
                'capability': 'analytics',
                'reason_code': 'SQL_EXECUTION_ERROR',
                'warnings': ['boom'],
                'counts': {'rows': 0, 'records': 0, 'affected': 0},
            },
            'payload': {'question': 'q'},
        }
        sc = await self._run_dispatcher('data_query', envelope)

        self.assertEqual(sc.artifacts, [])

    async def test_unrelated_tool_does_not_append_artifact(self):
        # ``lookup`` is claimed by analytics pack but produces a read
        # envelope with no ``outcome.artifact`` slot.
        envelope = {
            'status': 'ok',
            'summary': '3 records',
            'outcome': {
                'kind': 'read',
                'capability': 'analytics',
                'reason_code': None,
                'warnings': [],
                'counts': {'rows': 0, 'records': 3, 'affected': 0},
            },
            'payload': {'dimension': 'agent', 'values': []},
        }
        sc = await self._run_dispatcher('lookup', envelope)

        self.assertEqual(sc.artifacts, [])

    def test_dispatcher_has_no_tool_name_literals(self):
        import re
        from pathlib import Path

        adapter_src = Path('backend/app/services/chat_engine/openai_agents_adapter.py').read_text()
        pattern = re.compile(r"tool_name\s*==\s*['\"](data_query|blueprint_compose)['\"]")
        self.assertIsNone(
            pattern.search(adapter_src),
            'harness dispatcher must not hard-code analytics / report-builder tool names',
        )


class MalformedArgsDispatcherTests(unittest.IsolatedAsyncioTestCase):
    """Phase 2: malformed LLM args surface as a §6.2 ``MALFORMED_ARGS``
    envelope and flow through the same tool_call_start / tool_call_end /
    scratchpad / tool_call_log path as any other tool result. The outer
    agent observes ``outcome.reason_code`` and replans.
    """

    async def _run_with_raw_args(self, raw_args: str, tool_name: str = 'data_query'):
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
        ctx = SimpleNamespace(context=sc, tool_name=tool_name, tool_call_id='tc_bad')

        dispatch_mock = AsyncMock()
        with patch('app.database.async_session', return_value=_SessionCtx(tool_db)), patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=dispatch_mock,
        ):
            raw_result = await _sherlock_tool_handler(ctx, raw_args)

        return sc, dispatch_mock, raw_result

    async def test_non_object_json_returns_malformed_args_envelope(self):
        sc, dispatch_mock, raw_result = await self._run_with_raw_args('[1, 2, 3]')

        # The handler must not have dispatched the tool at all.
        dispatch_mock.assert_not_awaited()

        parsed = json.loads(raw_result)
        self.assertEqual(parsed['status'], 'error')
        self.assertEqual(parsed['outcome']['kind'], 'error')
        self.assertEqual(parsed['outcome']['capability'], 'harness')
        self.assertEqual(parsed['outcome']['reason_code'], 'MALFORMED_ARGS')
        # Plan-pinned: no bespoke {"status":"error","message":...} dict.
        self.assertNotIn('message', parsed)
        # Envelope must carry the counts skeleton, not an ad-hoc blob.
        self.assertEqual(
            parsed['outcome']['counts'],
            {'rows': 0, 'records': 0, 'affected': 0},
        )

    async def test_malformed_args_flow_through_tool_call_events(self):
        sc, _dispatch_mock, _raw = await self._run_with_raw_args('not-json')

        emitted = [call.args[0]['event'] for call in sc.emit.await_args_list]
        # Full life-cycle: start → end → status, same as any other tool call.
        self.assertEqual(emitted[0], 'tool_call_start')
        self.assertIn('tool_call_end', emitted)
        self.assertIn('status', emitted)

        end_event = next(
            call.args[0] for call in sc.emit.await_args_list
            if call.args[0]['event'] == 'tool_call_end'
        )
        outcome = end_event['data']['outcome']
        self.assertEqual(outcome['reason_code'], 'MALFORMED_ARGS')
        self.assertEqual(outcome['kind'], 'error')
        self.assertEqual(outcome['capability'], 'harness')

    async def test_malformed_args_log_carries_outcome_for_persistence(self):
        sc, _dispatch_mock, _raw = await self._run_with_raw_args('[]')

        self.assertEqual(len(sc.tool_call_log), 1)
        entry = sc.tool_call_log[0]
        self.assertEqual(entry['name'], 'data_query')
        # The runtime-event persistence path lifts ``outcome`` off this log
        # entry into the ``sherlock_turn_events.data`` column.
        self.assertEqual(entry['outcome']['reason_code'], 'MALFORMED_ARGS')


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
