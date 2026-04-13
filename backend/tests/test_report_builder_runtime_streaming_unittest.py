import asyncio
import json
import os
import sys
import uuid
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.auth import AuthContext
from app.routes import report_builder
from app.services.report_builder import chat_handler
from app.services.report_builder.schemas import BuilderChatRequest
from app.services.report_builder.runtime_store import SherlockRuntimeSession


class ReportBuilderRuntimeStreamingTests(unittest.IsolatedAsyncioTestCase):
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
        body = BuilderChatRequest(
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
            },
        }

        with patch(
            'app.services.report_builder.chat_handler._resolve_tools_for_app',
            new=AsyncMock(return_value=[]),
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
            self.assertEqual(first_event['event'], 'tool_call_start')
            self.assertEqual(first_event['data']['name'], 'analyze')
            self.assertGreaterEqual(first_event['data']['seq'], 1)

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
            },
        }

        with patch(
            'app.services.report_builder.chat_handler._resolve_tools_for_app',
            new=AsyncMock(return_value=[]),
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

        self.assertEqual([event['event'] for event in events], ['content_delta', 'done'])
        self.assertEqual(events[0]['data']['delta'], 'Hello')


if __name__ == '__main__':
    unittest.main()
