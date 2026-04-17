import asyncio
import json
import uuid
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.auth import AuthContext
from app.routes import report_builder
from app.services.report_builder import chat_handler
from app.services.report_builder.schemas import BuilderChatRequest, LegacyBuilderChatRequest
from app.services.report_builder.runtime_store import SherlockRuntimeSession


class ReportBuilderRuntimeStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_resume_stream_returns_completed_marker_without_invoking_new_chat_turn(self):
        runtime_session = SherlockRuntimeSession(
            chat_session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            app_id='kaira-bot',
            tenant_id='tenant-1',
            user_id='user-1',
            provider='openai',
            model='gpt-5.4-mini',
            message_state=[],
            scratchpad={},
            next_event_seq=13,
        )

        with patch(
            'app.routes.report_builder.resolve_sherlock_runtime_session',
            new=AsyncMock(return_value=runtime_session),
        ), patch(
            'app.routes.report_builder.get_or_create_turn',
            new=AsyncMock(return_value=SimpleNamespace(
                id='turn-db-id',
                client_turn_id='turn_123',
                status='done',
                assistant_message_id='assistant-1',
                last_error=None,
            )),
        ), patch(
            'app.routes.report_builder.run_chat_turn_streaming',
            new=AsyncMock(),
        ) as run_turn, patch(
            'app.routes.report_builder.get_sherlock_runtime_session_snapshot',
            new=AsyncMock(return_value={
                'session_id': runtime_session.chat_session_id,
                'provider': runtime_session.provider,
                'model': runtime_session.model,
                'messages': [
                    {
                        'id': 'assistant-1',
                        'role': 'assistant',
                        'content': 'Pass rate is 91%',
                        'metadata': {
                            'terminalStatus': 'done',
                            'toolCalls': [],
                            'chart': None,
                            'blueprint': None,
                            'warnings': [],
                        },
                    },
                ],
            }),
        ):
            response = await report_builder.chat_stream_v2(
                BuilderChatRequest(
                    app_id='kaira-bot',
                    session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
                    turn_id='turn_123',
                    operation='resume',
                    resume_from_seq=12,
                    model='gpt-5.4-mini',
                ),
                auth=AuthContext(
                    user_id=uuid.uuid4(),
                    tenant_id=uuid.uuid4(),
                    email='user@example.com',
                    role_id=uuid.uuid4(),
                    is_owner=False,
                    permissions=frozenset(),
                    app_access=frozenset({'kaira-bot'}),
                ),
                db=AsyncMock(),
            )
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)

        run_turn.assert_not_awaited()
        self.assertIn('event: session', chunks[0])
        self.assertIn('event: done', chunks[1])
        self.assertIn('Pass rate is 91%', chunks[1])
        self.assertNotIn('Resumed from completed turn.', chunks[1])

    async def test_resume_stream_defaults_missing_provider_to_openai(self):
        runtime_session = SherlockRuntimeSession(
            chat_session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            app_id='kaira-bot',
            tenant_id='tenant-1',
            user_id='user-1',
            provider='openai',
            model='gpt-5.4-mini',
            message_state=[],
            scratchpad={},
            next_event_seq=13,
        )

        with patch(
            'app.routes.report_builder.resolve_sherlock_runtime_session',
            new=AsyncMock(return_value=runtime_session),
        ) as resolve_runtime, patch(
            'app.routes.report_builder.get_or_create_turn',
            new=AsyncMock(return_value=SimpleNamespace(
                id='turn-db-id',
                client_turn_id='turn_123',
                status='done',
                assistant_message_id='assistant-1',
                last_error=None,
            )),
        ), patch(
            'app.routes.report_builder.get_sherlock_runtime_session_snapshot',
            new=AsyncMock(return_value={
                'session_id': runtime_session.chat_session_id,
                'provider': runtime_session.provider,
                'model': runtime_session.model,
                'messages': [],
            }),
        ):
            response = await report_builder.chat_stream_v2(
                BuilderChatRequest(
                    app_id='kaira-bot',
                    session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
                    turn_id='turn_123',
                    operation='resume',
                    model='gpt-5.4-mini',
                ),
                auth=AuthContext(
                    user_id=uuid.uuid4(),
                    tenant_id=uuid.uuid4(),
                    email='user@example.com',
                    role_id=uuid.uuid4(),
                    is_owner=False,
                    permissions=frozenset(),
                    app_access=frozenset({'kaira-bot'}),
                ),
                db=AsyncMock(),
            )
            async for _chunk in response.body_iterator:
                pass

        self.assertEqual(resolve_runtime.await_args.kwargs['provider'], 'openai')

    async def test_resume_stream_attaches_to_live_background_turn(self):
        runtime_session = SherlockRuntimeSession(
            chat_session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            app_id='kaira-bot',
            tenant_id='tenant-1',
            user_id='user-1',
            provider='openai',
            model='gpt-5.4-mini',
            message_state=[],
            scratchpad={},
            next_event_seq=13,
        )
        live_task = asyncio.create_task(asyncio.sleep(60))
        report_builder._track_background_task('turn-db-id', live_task)

        try:
            with patch(
                'app.routes.report_builder.resolve_sherlock_runtime_session',
                new=AsyncMock(return_value=runtime_session),
            ), patch(
                'app.routes.report_builder.get_or_create_turn',
                new=AsyncMock(return_value=SimpleNamespace(
                    id='turn-db-id',
                    client_turn_id='turn_123',
                    status='active',
                    assistant_message_id=None,
                    last_error=None,
                )),
            ):
                response = await report_builder.chat_stream_v2(
                    BuilderChatRequest(
                        app_id='kaira-bot',
                        session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
                        turn_id='turn_123',
                        operation='resume',
                        model='gpt-5.4-mini',
                    ),
                    auth=AuthContext(
                        user_id=uuid.uuid4(),
                        tenant_id=uuid.uuid4(),
                        email='user@example.com',
                        role_id=uuid.uuid4(),
                        is_owner=False,
                        permissions=frozenset(),
                        app_access=frozenset({'kaira-bot'}),
                    ),
                    db=AsyncMock(),
                )
                iterator = response.body_iterator
                session_chunk = await anext(iterator)
                await report_builder._publish_turn_event('turn-db-id', {
                    'event': 'done',
                    'data': {
                        'terminalStatus': 'done',
                        'content': 'Live result',
                        'toolCalls': [],
                        'chart': None,
                        'blueprint': None,
                        'warnings': [],
                    },
                })
                await report_builder._close_turn_stream('turn-db-id')
                done_chunk = await anext(iterator)

            self.assertIn('event: session', session_chunk)
            self.assertIn('event: done', done_chunk)
            self.assertIn('Live result', done_chunk)
        finally:
            live_task.cancel()
            try:
                await live_task
            except asyncio.CancelledError:
                pass
            report_builder._SHERLOCK_BACKGROUND_TASKS_BY_TURN.pop('turn-db-id', None)
            report_builder._SHERLOCK_BACKGROUND_SUBSCRIBERS.pop('turn-db-id', None)

    async def test_chat_stream_uses_runtime_provider_and_session_identity(self):
        runtime_session = SherlockRuntimeSession(
            chat_session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            app_id='kaira-bot',
            tenant_id='tenant-1',
            user_id='user-1',
            provider='azure_openai',
            model='gpt-5.4-mini',
            message_state=[],
            scratchpad={
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'last_analysis': None,
                'analysis_history': [],
                'resolved_entities': {},
                'last_evidence': None,
            },
            next_event_seq=1,
        )

        class FakeStream:
            def __init__(self):
                self.call_args = None

            def __call__(self, *args, **kwargs):
                self.call_args = (args, kwargs)

                async def _gen():
                    yield {'event': 'done', 'data': {'toolCalls': [], 'composedReport': None}}

                return _gen()

        auth = AuthContext(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email='user@example.com',
            role_id=uuid.uuid4(),
            is_owner=False,
            permissions=frozenset(),
            app_access=frozenset({'kaira-bot'}),
        )
        body = LegacyBuilderChatRequest(
            app_id='kaira-bot',
            session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            message='show me trends',
            provider='openai',
            model='gpt-5.4-mini',
        )

        run_stream = FakeStream()

        with patch(
            'app.routes.report_builder.resolve_sherlock_runtime_session',
            new=AsyncMock(return_value=runtime_session),
        ) as resolve_runtime, patch(
            'app.routes.report_builder.run_chat_turn_streaming',
            new=run_stream,
        ):
            response = await report_builder.chat_stream(body, auth=auth, db=AsyncMock())
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)

        resolve_runtime.assert_awaited_once()
        self.assertIsNotNone(run_stream.call_args)
        _, kwargs = run_stream.call_args
        self.assertEqual(kwargs['provider'], 'azure_openai')
        self.assertEqual(kwargs['model'], 'gpt-5.4-mini')

        session_chunk = chunks[0]
        self.assertIn('event: session', session_chunk)
        payload = json.loads(session_chunk.split('data: ', 1)[1].strip())
        self.assertEqual(
            payload,
            {
                'sessionId': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
                'provider': 'azure_openai',
                'model': 'gpt-5.4-mini',
            },
        )

    async def test_chat_turn_uses_sdk_runner_not_custom_loop(self):
        async def fake_sdk_stream(*_args, **_kwargs):
            yield {
                'event': '_internal_turn_complete',
                'data': {'last_response_id': 'resp_123', 'final_output': 'Done'},
            }

        session = {
            'chat_session_id': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'last_analysis': None,
                'analysis_history': [],
                'resolved_entities': {},
                'last_evidence': None,
            },
            'last_response_id': None,
        }

        with patch(
            'app.services.report_builder.chat_handler._resolve_tools_for_app',
            new=AsyncMock(return_value=[]),
        ), patch(
            'app.services.report_builder.chat_handler.load_app_config',
            new=AsyncMock(return_value={'displayName': 'Kaira Bot'}),
        ), patch(
            'app.services.report_builder.chat_handler.load_entity_registry',
            return_value=[],
        ), patch(
            'app.services.report_builder.chat_handler.recognize_entities',
            new=AsyncMock(return_value=chat_handler.EntityRecognitionResult()),
        ), patch(
            'app.services.evaluators.settings_helper.get_llm_settings_from_db',
            new=AsyncMock(return_value={'api_key': 'test-key'}),
        ), patch(
            'app.services.report_builder.chat_handler.create_openai_client',
            return_value=MagicMock(),
        ), patch(
            'app.services.report_builder.chat_handler.run_sherlock_sdk_turn',
            side_effect=fake_sdk_stream,
        ) as mock_sdk, patch(
            'app.services.report_builder.chat_handler.run_tool_loop',
            create=True,
        ) as mock_old, patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
        ), patch(
            'app.services.report_builder.chat_handler.record_user_message',
            new=AsyncMock(return_value='user-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.create_assistant_message',
            new=AsyncMock(return_value='assistant-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.finalize_assistant_message',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.update_last_response_id',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ), patch(
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ):
            events = []
            async for event in chat_handler.run_chat_turn_streaming(
                session,
                'show me trends',
                provider='openai',
                model='gpt-5.4-mini',
                db=AsyncMock(),
                auth=AsyncMock(),
            ):
                events.append(event)

        mock_sdk.assert_called_once()
        mock_old.assert_not_called()
        self.assertEqual(events[-1]['event'], 'done')

    async def test_run_chat_turn_streaming_emits_tool_start_before_runner_finishes(self):
        release_runner = asyncio.Event()

        async def fake_sdk_stream(*_args, **_kwargs):
            yield {
                'event': 'tool_call_start',
                'data': {'name': 'analyze', 'toolName': 'analyze', 'toolCallId': 'tc_1'},
            }
            await release_runner.wait()
            yield {
                'event': 'tool_call_end',
                'data': {'name': 'analyze', 'toolName': 'analyze', 'toolCallId': 'tc_1'},
            }
            yield {
                'event': '_internal_turn_complete',
                'data': {'last_response_id': 'resp_123', 'final_output': 'done'},
            }

        session = {
            'chat_session_id': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'last_analysis': None,
                'analysis_history': [],
                'resolved_entities': {},
                'last_evidence': None,
            },
            'last_response_id': None,
        }

        with patch(
            'app.services.report_builder.chat_handler._resolve_tools_for_app',
            new=AsyncMock(return_value=[]),
        ), patch(
            'app.services.report_builder.chat_handler.load_app_config',
            new=AsyncMock(return_value={'displayName': 'Kaira Bot'}),
        ), patch(
            'app.services.report_builder.chat_handler.load_entity_registry',
            return_value=[],
        ), patch(
            'app.services.report_builder.chat_handler.recognize_entities',
            new=AsyncMock(return_value=chat_handler.EntityRecognitionResult()),
        ), patch(
            'app.services.evaluators.settings_helper.get_llm_settings_from_db',
            new=AsyncMock(return_value={'api_key': 'test-key'}),
        ), patch(
            'app.services.report_builder.chat_handler.create_openai_client',
            return_value=MagicMock(),
        ), patch(
            'app.services.report_builder.chat_handler.run_sherlock_sdk_turn',
            side_effect=fake_sdk_stream,
        ), patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
        ), patch(
            'app.services.report_builder.chat_handler.record_user_message',
            new=AsyncMock(return_value='user-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.create_assistant_message',
            new=AsyncMock(return_value='assistant-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.finalize_assistant_message',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.update_last_response_id',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ), patch(
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ):
            stream = chat_handler.run_chat_turn_streaming(
                session,
                'show me rows',
                provider='openai',
                model='gpt-5.4-mini',
                db=AsyncMock(),
                auth=AsyncMock(),
            )

            first_event = await asyncio.wait_for(anext(stream), timeout=0.05)
            self.assertEqual(first_event['event'], 'entity_recognition')
            self.assertTrue(first_event['data']['is_platform_query'])

            second_event = await asyncio.wait_for(anext(stream), timeout=0.05)
            self.assertEqual(second_event['event'], 'tool_call_start')
            self.assertEqual(second_event['data']['name'], 'analyze')
            self.assertGreaterEqual(second_event['data']['seq'], 1)

            release_runner.set()
            remaining = []
            async for event in stream:
                remaining.append(event)

        self.assertEqual(remaining[0]['event'], 'tool_call_end')
        self.assertEqual(remaining[-1]['event'], 'done')

    async def test_run_chat_turn_streaming_emits_content_delta_before_done(self):
        async def fake_sdk_stream(*_args, **_kwargs):
            yield {'event': 'content_delta', 'data': {'delta': 'Hello'}}
            yield {
                'event': '_internal_turn_complete',
                'data': {'last_response_id': 'resp_456', 'final_output': 'Hello'},
            }

        session = {
            'chat_session_id': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'last_analysis': None,
                'analysis_history': [],
                'resolved_entities': {},
                'last_evidence': None,
            },
            'last_response_id': None,
        }

        with patch(
            'app.services.report_builder.chat_handler._resolve_tools_for_app',
            new=AsyncMock(return_value=[]),
        ), patch(
            'app.services.report_builder.chat_handler.load_app_config',
            new=AsyncMock(return_value={'displayName': 'Kaira Bot'}),
        ), patch(
            'app.services.report_builder.chat_handler.load_entity_registry',
            return_value=[],
        ), patch(
            'app.services.report_builder.chat_handler.recognize_entities',
            new=AsyncMock(return_value=chat_handler.EntityRecognitionResult()),
        ), patch(
            'app.services.evaluators.settings_helper.get_llm_settings_from_db',
            new=AsyncMock(return_value={'api_key': 'test-key'}),
        ), patch(
            'app.services.report_builder.chat_handler.create_openai_client',
            return_value=MagicMock(),
        ), patch(
            'app.services.report_builder.chat_handler.run_sherlock_sdk_turn',
            side_effect=fake_sdk_stream,
        ), patch(
            'app.services.report_builder.chat_handler.record_user_message',
            new=AsyncMock(return_value='user-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.create_assistant_message',
            new=AsyncMock(return_value='assistant-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.finalize_assistant_message',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.update_last_response_id',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ), patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
        ), patch(
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ):
            events = []
            async for event in chat_handler.run_chat_turn_streaming(
                session,
                'hello',
                provider='openai',
                model='gpt-5.4-mini',
                db=AsyncMock(),
                auth=AsyncMock(),
            ):
                events.append(event)

        self.assertEqual([event['event'] for event in events], ['entity_recognition', 'content_delta', 'done'])
        self.assertEqual(events[1]['data']['delta'], 'Hello')
        self.assertEqual(events[2]['data']['content'], 'Hello')

    async def test_run_chat_turn_streaming_includes_final_content_in_done_without_delta(self):
        async def fake_sdk_stream(*_args, **_kwargs):
            yield {
                'event': '_internal_turn_complete',
                'data': {'last_response_id': 'resp_789', 'final_output': 'Final answer'},
            }

        session = {
            'chat_session_id': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'resolved_entities': {},
                'last_analysis': None,
                'analysis_history': [],
                'last_evidence': None,
            },
            'last_response_id': None,
        }

        with patch(
            'app.services.report_builder.chat_handler._resolve_tools_for_app',
            new=AsyncMock(return_value=[]),
        ), patch(
            'app.services.report_builder.chat_handler.load_app_config',
            new=AsyncMock(return_value={'displayName': 'Kaira Bot'}),
        ), patch(
            'app.services.report_builder.chat_handler.load_entity_registry',
            return_value=[],
        ), patch(
            'app.services.report_builder.chat_handler.recognize_entities',
            new=AsyncMock(return_value=chat_handler.EntityRecognitionResult()),
        ), patch(
            'app.services.evaluators.settings_helper.get_llm_settings_from_db',
            new=AsyncMock(return_value={'api_key': 'test-key'}),
        ), patch(
            'app.services.report_builder.chat_handler.create_openai_client',
            return_value=MagicMock(),
        ), patch(
            'app.services.report_builder.chat_handler.run_sherlock_sdk_turn',
            side_effect=fake_sdk_stream,
        ), patch(
            'app.services.report_builder.chat_handler.record_user_message',
            new=AsyncMock(return_value='user-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.create_assistant_message',
            new=AsyncMock(return_value='assistant-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.finalize_assistant_message',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.update_last_response_id',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ), patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
        ), patch(
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ):
            events = []
            async for event in chat_handler.run_chat_turn_streaming(
                session,
                'hello',
                provider='openai',
                model='gpt-5.4-mini',
                db=AsyncMock(),
                auth=AsyncMock(),
            ):
                events.append(event)

        self.assertEqual(events[-1]['event'], 'done')
        self.assertEqual(events[-1]['data']['content'], 'Final answer')

    async def test_run_chat_turn_streaming_routes_off_topic_questions_through_sdk_without_tools(self):
        async def fake_sdk_stream(*_args, **_kwargs):
            yield {
                'event': '_internal_turn_complete',
                'data': {
                    'last_response_id': 'resp_789',
                    'final_output': 'Not my patch, but I can inspect Kaira Bot runs and trends.',
                },
            }

        session = {
            'chat_session_id': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'resolved_entities': {},
                'last_analysis': None,
                'analysis_history': [],
                'last_evidence': None,
            },
            'last_response_id': None,
        }

        with patch(
            'app.services.report_builder.chat_handler._resolve_tools_for_app',
            new=AsyncMock(return_value=[]),
        ), patch(
            'app.services.report_builder.chat_handler.load_app_config',
            new=AsyncMock(return_value={'displayName': 'Kaira Bot'}),
        ), patch(
            'app.services.report_builder.chat_handler.load_entity_registry',
            return_value=[],
        ), patch(
            'app.services.report_builder.chat_handler.recognize_entities',
            new=AsyncMock(return_value=chat_handler.EntityRecognitionResult(
                is_platform_query=False,
                out_of_scope_reason='General knowledge question',
            )),
        ), patch(
            'app.services.report_builder.chat_handler.record_user_message',
            new=AsyncMock(return_value='user-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.create_assistant_message',
            new=AsyncMock(return_value='assistant-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.finalize_assistant_message',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ), patch(
            'app.services.report_builder.chat_handler.run_sherlock_sdk_turn',
            side_effect=fake_sdk_stream,
        ) as mock_sdk, patch(
            'app.services.evaluators.settings_helper.get_llm_settings_from_db',
            new=AsyncMock(return_value={'api_key': 'test-key'}),
        ), patch(
            'app.services.report_builder.chat_handler.create_openai_client',
            return_value=MagicMock(),
        ), patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
        ):
            events = []
            async for event in chat_handler.run_chat_turn_streaming(
                session,
                'What is the weather today?',
                provider='openai',
                model='gpt-5.4-mini',
                db=AsyncMock(),
                auth=AsyncMock(),
            ):
                events.append(event)

        mock_sdk.assert_called_once()
        self.assertEqual(mock_sdk.call_args.kwargs['tools'], [])
        self.assertFalse(mock_sdk.call_args.kwargs['force_first_tool_call'])
        self.assertEqual([event['event'] for event in events], ['entity_recognition', 'done'])
        self.assertFalse(events[0]['data']['is_platform_query'])
        self.assertEqual(events[-1]['data']['terminalStatus'], 'done')
        self.assertEqual(
            events[-1]['data']['content'],
            'Not my patch, but I can inspect Kaira Bot runs and trends.',
        )


if __name__ == '__main__':
    unittest.main()
