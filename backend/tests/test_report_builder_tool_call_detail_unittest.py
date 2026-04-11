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
from app.services.report_builder.schemas import BuilderChatResponse


class ReportBuilderToolCallDetailTests(unittest.IsolatedAsyncioTestCase):
    def test_build_tool_call_detail_includes_analyze_sql_and_execution_metadata(self):
        detail = chat_handler._build_tool_call_detail(
            'analyze',
            json.dumps({
                'status': 'ok',
                'row_count': 7,
                'sql_used': 'select * from eval_runs',
                'cache_hit': True,
            }),
            execution_ms=12.34,
        )

        self.assertEqual(
            detail.model_dump(by_alias=True),
            {
                'sqlUsed': 'select * from eval_runs',
                'executionMs': 12.34,
                'rowCount': 7,
                'cacheHit': True,
                'error': None,
            },
        )

    def test_build_tool_call_detail_includes_analyze_error_metadata(self):
        detail = chat_handler._build_tool_call_detail(
            'analyze',
            json.dumps({
                'status': 'error',
                'error': 'database unavailable',
            }),
            execution_ms=8.0,
        )

        self.assertEqual(
            detail.model_dump(by_alias=True),
            {
                'sqlUsed': None,
                'executionMs': 8.0,
                'rowCount': None,
                'cacheHit': False,
                'error': 'database unavailable',
            },
        )

    async def test_run_chat_turn_returns_tool_calls_with_detail(self):
        class FakeAdapter:
            @staticmethod
            def build_user_message(text: str) -> dict[str, str]:
                return {'role': 'user', 'content': text}

        async def fake_run_tool_loop(**kwargs):
            await kwargs['dispatch_fn']('analyze', {'question': 'show me rows'})
            return 'done', kwargs['messages']

        session = {
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
            },
        }
        db = AsyncMock()
        auth = AsyncMock()

        with patch('app.services.report_builder.chat_handler._resolve_tools_for_app', new=AsyncMock(return_value=[])), patch(
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
                'cache_hit': True,
            })),
        ), patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
        ), patch(
            'app.services.report_builder.chat_handler.time.monotonic',
            side_effect=[1.0, 1.25],
        ):
            result = await chat_handler.run_chat_turn(
                session,
                'show me rows',
                provider='openai',
                model='gpt-4o',
                db=db,
                auth=auth,
            )

        self.assertEqual(result['tool_calls'][0]['name'], 'analyze')
        self.assertEqual(result['tool_calls'][0]['summary'], '7 rows')
        self.assertEqual(
            result['tool_calls'][0]['detail'].model_dump(by_alias=True),
            {
                'sqlUsed': 'select * from eval_runs',
                'executionMs': 250.0,
                'rowCount': 7,
                'cacheHit': True,
                'error': None,
            },
        )

    async def test_run_chat_turn_streaming_emits_detail_in_tool_events_and_done_payload(self):
        class FakeAdapter:
            @staticmethod
            def build_user_message(text: str) -> dict[str, str]:
                return {'role': 'user', 'content': text}

        async def fake_run_tool_loop(**kwargs):
            await kwargs['dispatch_fn']('analyze', {'question': 'show me rows'})
            return 'done', kwargs['messages']

        session = {
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
            },
        }
        db = AsyncMock()
        auth = AsyncMock()

        with patch('app.services.report_builder.chat_handler._resolve_tools_for_app', new=AsyncMock(return_value=[])), patch(
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
                'cache_hit': False,
            })),
        ), patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
        ), patch(
            'app.services.report_builder.chat_handler.time.monotonic',
            side_effect=[1.0, 1.1],
        ):
            events = []
            async for event in chat_handler.run_chat_turn_streaming(
                session,
                'show me rows',
                provider='openai',
                model='gpt-4o',
                db=db,
                auth=auth,
            ):
                events.append(event)

        self.assertEqual(events[0]['event'], 'tool_call_start')
        self.assertEqual(
            events[1]['data']['detail'].model_dump(by_alias=True),
            {
                'sqlUsed': 'select * from eval_runs',
                'executionMs': 100.0,
                'rowCount': 7,
                'cacheHit': False,
                'error': None,
            },
        )
        self.assertEqual(
            events[-1]['data']['toolCalls'][0]['detail'].model_dump(by_alias=True),
            {
                'sqlUsed': 'select * from eval_runs',
                'executionMs': 100.0,
                'rowCount': 7,
                'cacheHit': False,
                'error': None,
            },
        )

    async def test_chat_route_serializes_tool_call_detail(self):
        session_id = 'session-1'
        session = {
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
            },
        }
        auth = AuthContext(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email='user@example.com',
            role_id=uuid.uuid4(),
            is_owner=False,
            permissions=frozenset(),
            app_access=frozenset({'kaira-bot'}),
        )
        body = report_builder.BuilderChatRequest(
            app_id='kaira-bot',
            session_id=session_id,
            message='show me rows',
            provider='openai',
            model='gpt-4o',
        )

        with patch('app.routes.report_builder.get_session', return_value=session), patch(
            'app.routes.report_builder.run_chat_turn',
            new=AsyncMock(return_value={
                'role': 'assistant',
                'content': 'done',
                'tool_calls': [
                    {
                        'name': 'analyze',
                        'summary': '7 rows',
                        'detail': chat_handler._build_tool_call_detail(
                            'analyze',
                            json.dumps({
                                'status': 'ok',
                                'row_count': 7,
                                'sql_used': 'select * from eval_runs',
                                'cache_hit': True,
                            }),
                            execution_ms=12.34,
                        ),
                    },
                ],
                'composed_report': None,
            }),
        ):
            response = await report_builder.chat(body, auth=auth, db=AsyncMock())

        self.assertIsInstance(response, BuilderChatResponse)
        dumped = response.model_dump(by_alias=True, mode='json')
        self.assertEqual(
            dumped['toolCalls'][0]['detail'],
            {
                'sqlUsed': 'select * from eval_runs',
                'executionMs': 12.34,
                'rowCount': 7,
                'cacheHit': True,
                'error': None,
            },
        )


if __name__ == '__main__':
    unittest.main()
