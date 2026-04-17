import asyncio
import json
import uuid
import unittest
from unittest.mock import AsyncMock, patch

from app.auth import AuthContext
from app.routes import report_builder
from app.services.report_builder import chat_handler
from app.services.report_builder.schemas import BuilderChatRequest, LegacyBuilderChatRequest
from app.services.report_builder.runtime_store import SherlockRuntimeSession


class ReportBuilderRuntimeStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_resume_stream_replays_active_turn_without_invoking_new_chat_turn(self):
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

        async def fake_replay(*_args, **_kwargs):
            return {
                'session_id': runtime_session.chat_session_id,
                'last_event_seq': 12,
                'events': [],
            }

        with patch(
            'app.routes.report_builder.resolve_sherlock_runtime_session',
            new=AsyncMock(return_value=runtime_session),
        ), patch(
            'app.routes.report_builder.list_sherlock_runtime_events',
            new=AsyncMock(side_effect=fake_replay),
        ), patch(
            'app.routes.report_builder.run_chat_turn_streaming',
            new=AsyncMock(),
        ) as run_turn:
            response = await report_builder.chat_stream_v2(
                BuilderChatRequest(
                    app_id='kaira-bot',
                    session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
                    turn_id='turn_123',
                    operation='resume',
                    resume_from_seq=12,
                    provider='openai',
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
                break

        run_turn.assert_not_awaited()

    async def test_chat_stream_uses_runtime_provider_and_session_identity(self):
        runtime_session = SherlockRuntimeSession(
            chat_session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            app_id='kaira-bot',
            tenant_id='tenant-1',
            user_id='user-1',
            provider='gemini',
            model='gemini-3-flash-preview',
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
        self.assertEqual(kwargs['provider'], 'gemini')
        self.assertEqual(kwargs['model'], 'gemini-3-flash-preview')

        session_chunk = chunks[0]
        self.assertIn('event: session', session_chunk)
        payload = json.loads(session_chunk.split('data: ', 1)[1].strip())
        self.assertEqual(
            payload,
            {
                'sessionId': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
                'provider': 'gemini',
                'model': 'gemini-3-flash-preview',
            },
        )

    async def test_run_chat_turn_streaming_emits_tool_start_before_runner_finishes(self):
        class FakeAdapter:
            @staticmethod
            def build_user_message(text: str) -> dict[str, str]:
                return {'role': 'user', 'content': text}

        release_runner = asyncio.Event()

        async def fake_run_tool_loop(**kwargs):
            await kwargs['dispatch_fn']('analyze', {'question': 'show me rows'})
            await release_runner.wait()
            return 'done', kwargs['messages']

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
            'app.services.report_builder.chat_handler.create_adapter',
            new=AsyncMock(return_value=FakeAdapter()),
        ), patch(
            'app.services.report_builder.chat_handler.run_tool_loop',
            new=AsyncMock(side_effect=fake_run_tool_loop),
        ), patch(
            'app.services.report_builder.chat_handler.dispatch_tool_call',
            new=AsyncMock(return_value=json.dumps({
                'status': 'ok',
                'question': 'show me rows',
                'row_count': 7,
                'sql_used': 'select * from eval_runs',
            })),
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
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
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
        class FakeAdapter:
            @staticmethod
            def build_user_message(text: str) -> dict[str, str]:
                return {'role': 'user', 'content': text}

            @staticmethod
            def deserialize(data):
                return list(data)

            @staticmethod
            def serialize(data):
                return list(data)

            async def send_stream(self, *_args, **_kwargs):
                yield {'type': 'text_delta', 'delta': 'Hello'}
                yield {'type': 'response', 'response': {'message': {'role': 'assistant', 'content': 'Hello'}, 'tool_calls': []}}

            async def send(self, *_args, **_kwargs):
                raise AssertionError('send should not be called when send_stream is available')

            @staticmethod
            def extract_response_message(response):
                return response['message']

            @staticmethod
            def extract_tool_calls(response):
                return response['tool_calls']

            @staticmethod
            def extract_text(response):
                return response['message']['content']

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
            'app.services.report_builder.chat_handler.create_adapter',
            new=AsyncMock(return_value=FakeAdapter()),
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
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ), patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
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
        class FakeAdapter:
            @staticmethod
            def build_user_message(text: str) -> dict[str, str]:
                return {'role': 'user', 'content': text}

        async def fake_run_tool_loop(**kwargs):
            return 'Final answer', kwargs['messages']

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
            'app.services.report_builder.chat_handler.create_adapter',
            new=AsyncMock(return_value=FakeAdapter()),
        ), patch(
            'app.services.report_builder.chat_handler.run_tool_loop',
            new=AsyncMock(side_effect=fake_run_tool_loop),
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
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ), patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
        ):
            events = []
            async for event in chat_handler.run_chat_turn_streaming(
                session,
                'hello',
                provider='gemini',
                model='gemini-3-flash-preview',
                db=AsyncMock(),
                auth=AsyncMock(),
            ):
                events.append(event)

        self.assertEqual(events[-1]['event'], 'done')
        self.assertEqual(events[-1]['data']['content'], 'Final answer')

    async def test_run_chat_turn_streaming_short_circuits_off_topic_questions(self):
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
            'app.services.report_builder.chat_handler.create_adapter',
            new=AsyncMock(side_effect=AssertionError('adapter should not be created')),
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

        self.assertEqual([event['event'] for event in events], ['entity_recognition', 'done'])
        self.assertFalse(events[0]['data']['is_platform_query'])
        self.assertEqual(events[-1]['data']['terminalStatus'], 'done')


if __name__ == '__main__':
    unittest.main()
