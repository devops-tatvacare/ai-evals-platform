import json
import uuid
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.auth import AuthContext
from app.routes import report_builder
from app.services.report_builder import chat_handler
from app.services.report_builder.schemas import BuilderChatResponse
from app.services.report_builder.scratchpad_state import default_scratchpad


class ReportBuilderToolCallDetailTests(unittest.IsolatedAsyncioTestCase):
    def test_build_tool_call_detail_includes_analyze_sql_and_execution_metadata(self):
        detail = chat_handler._build_tool_call_detail(
            'data_query',
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
            'data_query',
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
        detail = chat_handler._build_tool_call_detail(
            'data_query',
            json.dumps({
                'status': 'ok',
                'question': 'show me rows',
                'row_count': 7,
                'sql_used': 'select * from eval_runs',
                'cache_hit': True,
            }),
            execution_ms=12.34,
        )

        async def fake_sdk_stream(*_args, **kwargs):
            kwargs['sherlock_context'].tool_call_log.append({
                'tool_call_id': 'tc_1',
                'name': 'data_query',
                'summary': '7 rows',
                'detail': detail,
                'duration_ms': 12.34,
            })
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
            'scratchpad': default_scratchpad(),
            'last_response_id': None,
        }
        db = AsyncMock()
        auth = AsyncMock()

        with patch('app.services.report_builder.chat_handler._resolve_tools_for_app', new=AsyncMock(return_value=[])), patch(
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
            result = await chat_handler.run_chat_turn(
                session,
                'show me rows',
                provider='openai',
                model='gpt-4o',
                db=db,
                auth=auth,
            )

        self.assertEqual(result['tool_calls'][0]['name'], 'data_query')
        self.assertEqual(result['tool_calls'][0]['summary'], '7 rows')
        detail = result['tool_calls'][0]['detail'].model_dump(by_alias=True)
        self.assertEqual(detail['sqlUsed'], 'select * from eval_runs')
        self.assertEqual(detail['rowCount'], 7)
        self.assertEqual(detail['cacheHit'], True)
        self.assertIsNone(detail['error'])
        self.assertGreaterEqual(detail['executionMs'], 0)

    async def test_run_chat_turn_streaming_emits_detail_in_tool_events_and_done_payload(self):
        detail = chat_handler._build_tool_call_detail(
            'data_query',
            json.dumps({
                'status': 'ok',
                'question': 'show me rows',
                'row_count': 7,
                'sql_used': 'select * from eval_runs',
                'cache_hit': False,
            }),
            execution_ms=10.0,
        )

        async def fake_sdk_stream(*_args, **kwargs):
            kwargs['sherlock_context'].tool_call_log.append({
                'tool_call_id': 'tc_1',
                'name': 'data_query',
                'summary': '7 rows',
                'detail': detail,
                'duration_ms': 10.0,
            })
            yield {
                'event': 'tool_call_start',
                'data': {'toolCallId': 'tc_1', 'toolName': 'data_query', 'name': 'data_query'},
            }
            yield {
                'event': 'tool_call_end',
                'data': {
                    'toolCallId': 'tc_1',
                    'toolName': 'data_query',
                    'name': 'data_query',
                    'summary': '7 rows',
                    'detail': detail.model_dump(by_alias=True, mode='json'),
                    'durationMs': 10.0,
                },
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
            'scratchpad': default_scratchpad(),
            'last_response_id': None,
        }
        db = AsyncMock()
        auth = AsyncMock()

        with patch('app.services.report_builder.chat_handler._resolve_tools_for_app', new=AsyncMock(return_value=[])), patch(
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

        self.assertEqual(events[0]['event'], 'entity_recognition')
        self.assertEqual(events[1]['event'], 'tool_call_start')
        tool_end_detail = events[2]['data']['detail']
        self.assertEqual(tool_end_detail['sqlUsed'], 'select * from eval_runs')
        self.assertEqual(tool_end_detail['rowCount'], 7)
        self.assertEqual(tool_end_detail['cacheHit'], False)
        self.assertIsNone(tool_end_detail['error'])
        self.assertGreaterEqual(tool_end_detail['executionMs'], 0)
        done_detail = events[-1]['data']['toolCalls'][0]['detail']
        self.assertEqual(done_detail['sqlUsed'], 'select * from eval_runs')
        self.assertEqual(done_detail['rowCount'], 7)
        self.assertEqual(done_detail['cacheHit'], False)
        self.assertIsNone(done_detail['error'])
        self.assertGreaterEqual(done_detail['executionMs'], 0)

    async def test_chat_route_serializes_tool_call_detail(self):
        session_id = 'session-1'
        runtime_session = chat_handler.SherlockRuntimeSession(
            chat_session_id=session_id,
            app_id='kaira-bot',
            tenant_id='tenant-1',
            user_id='user-1',
            provider='openai',
            model='gpt-4o',
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
        auth = AuthContext(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email='user@example.com',
            role_id=uuid.uuid4(),
            is_owner=False,
            permissions=frozenset(),
            app_access=frozenset({'kaira-bot'}),
        )
        body = report_builder.LegacyBuilderChatRequest(
            app_id='kaira-bot',
            session_id=session_id,
            message='show me rows',
            provider='openai',
            model='gpt-4o',
        )

        with patch('app.routes.report_builder.resolve_sherlock_runtime_session', new=AsyncMock(return_value=runtime_session)), patch(
            'app.routes.report_builder.run_chat_turn',
            new=AsyncMock(return_value={
                'role': 'assistant',
                'content': 'done',
                'tool_calls': [
                    {
                        'name': 'data_query',
                        'summary': '7 rows',
                        'detail': chat_handler._build_tool_call_detail(
                            'data_query',
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
        self.assertEqual(dumped['sessionId'], session_id)
        self.assertEqual(dumped['provider'], 'openai')
        self.assertEqual(dumped['model'], 'gpt-4o')
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

    async def test_run_chat_turn_persists_chart_from_data_query_result(self):
        # Phase 2+3 contract: data_query emits `typed_columns` (JSON-safe)
        # and ``_build_chart_payload`` runs the gate + picker + emitter.
        chart_result = {
            'status': 'ok',
            'question': 'Which rules were most frequently violated?',
            'row_count': 2,
            'sql_used': 'select rule_name, violated_count from analytics_criterion_facts',
            'columns': [
                {'name': 'rule_name', 'role': 'dimension'},
                {'name': 'violated_count', 'role': 'measure'},
            ],
            'typed_columns': [
                {
                    'name': 'rule_name',
                    'role': 'dimension',
                    'data_type': 'nominal',
                    'semantic_type': 'category',
                    'cardinality': 2,
                    'null_frac': 0.0,
                    'is_constant': False,
                },
                {
                    'name': 'violated_count',
                    'role': 'measure',
                    'data_type': 'quantitative',
                    'semantic_type': 'count',
                    'cardinality': 2,
                    'null_frac': 0.0,
                    'is_constant': False,
                },
            ],
            'output_columns': [],
            'data': [
                {'rule_name': 'Meal Isolation Instructions', 'violated_count': 118},
                {'rule_name': 'Time Validation Instructions', 'violated_count': 52},
            ],
        }

        async def fake_sdk_stream(*_args, **kwargs):
            kwargs['sherlock_context'].chart_payload = chat_handler._build_chart_payload(chart_result)
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
            'scratchpad': default_scratchpad(),
            'last_response_id': None,
        }

        with patch('app.services.report_builder.chat_handler._resolve_tools_for_app', new=AsyncMock(return_value=[])), patch(
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
            result = await chat_handler.run_chat_turn(
                session,
                'Which rules were most frequently violated?',
                provider='openai',
                model='gpt-4o',
                db=AsyncMock(),
                auth=AsyncMock(),
            )

        self.assertIsNotNone(result['chart'])
        # Phase 3: payload is a discriminated union keyed by ``kind``. The
        # gate + picker produce a Vega-Lite bar spec (1 nominal + 1 count
        # measure is not part-of-whole → bar, not pie).
        self.assertEqual(result['chart']['kind'], 'chart')
        self.assertEqual(result['chart']['spec']['mark'], 'bar')
        self.assertEqual(result['chart']['spec']['encoding']['x']['field'], 'rule_name')
        self.assertEqual(result['chart']['spec']['encoding']['y']['field'], 'violated_count')
        self.assertEqual(result['chart']['data'][0]['rule_name'], 'Meal Isolation Instructions')
        self.assertEqual(result['chart']['source_question'], 'Which rules were most frequently violated?')


if __name__ == '__main__':
    unittest.main()
