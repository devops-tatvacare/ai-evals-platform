import asyncio
import json
import uuid
import unittest
from types import SimpleNamespace
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic import ValidationError

from app.auth import AuthContext
from app.routes import report_builder
from app.services.report_builder import chat_handler
from app.services.report_builder.scratchpad_state import default_scratchpad
from app.services.report_builder.runtime_store import SherlockRuntimeSession, SherlockSessionNotFoundError
from app.services.report_builder.schemas import BuilderChatRequest


def _auth_context() -> AuthContext:
    return AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email='user@example.com',
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset(),
        app_access=frozenset({'kaira-bot'}),
    )


class ReportBuilderV2ContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_chat_request_requires_turn_id_for_new_turns(self):
        with self.assertRaises(ValidationError):
            BuilderChatRequest.model_validate({
                'appId': 'kaira-bot',
                'sessionId': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
                'operation': 'send',
                'message': 'show pass rate',
                'provider': 'openai',
                'model': 'gpt-5.4',
            })

    async def test_resume_request_cannot_resubmit_message_body(self):
        with self.assertRaises(ValidationError):
            BuilderChatRequest.model_validate({
                'appId': 'kaira-bot',
                'sessionId': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
                'turnId': 'turn_123',
                'operation': 'resume',
                'resumeFromSeq': 9,
                'message': 'show pass rate',
                'provider': 'openai',
                'model': 'gpt-5.4',
            })

    async def test_chat_stream_v2_returns_completed_marker_for_resume_requests(self):
        runtime_session = SherlockRuntimeSession(
            chat_session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            app_id='kaira-bot',
            tenant_id='tenant-1',
            user_id='user-1',
            provider='openai',
            model='gpt-5.4-mini',
            message_state=[],
            scratchpad=default_scratchpad(),
            next_event_seq=5,
        )
        body = BuilderChatRequest(
            app_id='kaira-bot',
            session_id=runtime_session.chat_session_id,
            turn_id='turn_123',
            operation='resume',
            resume_from_seq=2,
            model='gpt-5.4-mini',
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
            'app.routes.report_builder.get_sherlock_runtime_session_snapshot',
            new=AsyncMock(return_value={
                'session_id': runtime_session.chat_session_id,
                'provider': runtime_session.provider,
                'model': runtime_session.model,
                'messages': [
                    {
                        'id': 'assistant-1',
                        'role': 'assistant',
                        'content': 'Persisted result',
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
            response = await report_builder.chat_stream_v2(body, auth=_auth_context(), db=AsyncMock())
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)

        self.assertIn('event: session', chunks[0])
        session_payload = json.loads(chunks[0].split('data: ', 1)[1].strip())
        self.assertEqual(session_payload['provider'], 'openai')
        self.assertEqual(session_payload['model'], 'gpt-5.4-mini')
        self.assertIn('event: done', chunks[1])
        done_payload = json.loads(chunks[1].split('data: ', 1)[1].strip())
        self.assertEqual(done_payload['terminalStatus'], 'done')
        self.assertEqual(done_payload['content'], 'Persisted result')

    async def test_chat_stream_v2_returns_404_session_not_found(self):
        body = BuilderChatRequest(
            app_id='kaira-bot',
            session_id='missing-session',
            turn_id='turn_123',
            operation='send',
            message='show me trends',
            provider='openai',
            model='gpt-5.4-mini',
        )

        with patch(
            'app.routes.report_builder.resolve_sherlock_runtime_session',
            new=AsyncMock(side_effect=SherlockSessionNotFoundError('session_not_found')),
        ):
            response = await report_builder.chat_stream_v2(body, auth=_auth_context(), db=AsyncMock())

        self.assertEqual(response.status_code, 404)
        self.assertEqual(json.loads(response.body), {'error': 'session_not_found'})

    async def test_get_builder_session_v2_returns_snapshot_metadata(self):
        now = datetime.now(timezone.utc)
        with patch(
            'app.routes.report_builder.get_sherlock_runtime_session_snapshot',
            new=AsyncMock(return_value={
                'session_id': 'session-1',
                'provider': 'openai',
                'model': 'gpt-5.4-mini',
                'last_event_seq': 7,
                'active_turn_id': 'turn_123',
                'current_turn_status': 'degraded',
                'messages': [
                    {
                        'id': 'message-1',
                        'role': 'assistant',
                        'content': 'Done',
                        'status': 'complete',
                        'error_message': None,
                        'metadata': {'terminalStatus': 'degraded'},
                        'created_at': now,
                    },
                ],
            }),
        ):
            response = await report_builder.get_builder_session_v2(
                'session-1',
                'kaira-bot',
                auth=_auth_context(),
                db=AsyncMock(),
            )

        dumped = response.model_dump(by_alias=True, mode='json')
        self.assertEqual(dumped['activeTurnId'], 'turn_123')
        self.assertEqual(dumped['lastEventSeq'], 7)
        self.assertEqual(dumped['currentTurnStatus'], 'degraded')
        self.assertEqual(dumped['messages'][0]['metadata'], {'terminalStatus': 'degraded'})

    async def test_run_chat_turn_streaming_marks_partial_tool_failures_as_degraded(self):
        detail = chat_handler._build_tool_call_detail(
            'data_query',
            json.dumps({'status': 'error', 'error': 'database unavailable'}),
            execution_ms=8.0,
        )

        async def fake_sdk_stream(*_args, **kwargs):
            kwargs['sherlock_context'].tool_call_log.append({
                'tool_call_id': 'tc_1',
                'name': 'data_query',
                'summary': 'query failed',
                'detail': detail,
                'duration_ms': 8.0,
            })
            kwargs['sherlock_context'].warnings.append('data_query: database unavailable')
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
                    'summary': 'query failed',
                    'detail': detail.model_dump(by_alias=True, mode='json'),
                    'durationMs': 8.0,
                },
            }
            yield {
                'event': '_internal_turn_complete',
                'data': {'last_response_id': 'resp_123', 'final_output': 'Partial answer'},
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
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ):
            events = []
            async for event in chat_handler.run_chat_turn_streaming(
                session,
                'show me rows',
                provider='openai',
                model='gpt-5.4-mini',
                db=AsyncMock(),
                auth=AsyncMock(),
            ):
                events.append(event)

        self.assertEqual(events[0]['event'], 'entity_recognition')
        self.assertEqual(events[1]['event'], 'tool_call_start')
        self.assertEqual(events[2]['event'], 'tool_call_end')
        self.assertEqual(events[1]['data']['toolCallId'], events[2]['data']['toolCallId'])
        self.assertEqual(events[-1]['event'], 'done')
        self.assertEqual(events[-1]['data']['terminalStatus'], 'degraded')
        self.assertEqual(events[-1]['data']['toolCalls'][0]['toolCallId'], events[1]['data']['toolCallId'])
        self.assertEqual(events[-1]['data']['warnings'], ['data_query: database unavailable'])

    async def test_execute_chat_turn_persists_interrupted_terminal_state_on_cancellation(self):
        async def fake_sdk_stream(*_args, **_kwargs):
            raise asyncio.CancelledError('client disconnected')
            yield  # pragma: no cover

        session = {
            'chat_session_id': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            'scratchpad': default_scratchpad(),
            'last_response_id': None,
        }
        save_runtime_state = AsyncMock()
        finalize_assistant_message = AsyncMock()
        append_runtime_event = AsyncMock(side_effect=range(1, 20))

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
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=save_runtime_state,
        ), patch(
            'app.services.report_builder.chat_handler.finalize_assistant_message',
            new=finalize_assistant_message,
        ), patch(
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=append_runtime_event,
        ), patch(
            'app.services.report_builder.chat_handler.update_last_response_id',
            new=AsyncMock(),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await chat_handler._execute_chat_turn(
                    session,
                    'show me rows',
                    provider='openai',
                    model='gpt-5.4-mini',
                    db=AsyncMock(),
                    auth=AsyncMock(),
                )

        self.assertEqual(save_runtime_state.await_args.kwargs['status'], 'interrupted')
        self.assertEqual(finalize_assistant_message.await_args.kwargs['metadata']['terminalStatus'], 'interrupted')
        self.assertEqual(append_runtime_event.await_args_list[-1].kwargs['event_type'], 'error')
        self.assertEqual(append_runtime_event.await_args_list[-1].kwargs['payload']['terminalStatus'], 'interrupted')

    async def test_execute_chat_turn_marks_runtime_session_active_before_completion(self):
        async def fake_sdk_stream(*_args, **_kwargs):
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
        save_runtime_state = AsyncMock()

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
            'app.services.report_builder.chat_handler.mark_turn_active',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.mark_turn_terminal',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.finalize_assistant_message',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=save_runtime_state,
        ), patch(
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ), patch(
            'app.services.report_builder.chat_handler.update_last_response_id',
            new=AsyncMock(),
        ):
            await chat_handler._execute_chat_turn(
                session,
                'show me rows',
                provider='openai',
                model='gpt-5.4-mini',
                db=AsyncMock(),
                auth=AsyncMock(),
                turn=SimpleNamespace(id='turn-db-id'),
            )

        self.assertGreaterEqual(save_runtime_state.await_count, 2)
        self.assertEqual(save_runtime_state.await_args_list[0].kwargs['status'], 'active')
        self.assertEqual(save_runtime_state.await_args_list[-1].kwargs['status'], 'done')

    async def test_execute_chat_turn_forces_first_round_tool_choice_when_resolution_needed(self):
        async def fake_sdk_stream(*_args, **_kwargs):
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
            new=AsyncMock(return_value=chat_handler.EntityRecognitionResult(needs_resolution=True)),
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
            'app.services.report_builder.chat_handler.update_last_response_id',
            new=AsyncMock(),
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
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ):
            await chat_handler._execute_chat_turn(
                session,
                'Show me that thread',
                provider='openai',
                model='gpt-5.4-mini',
                db=AsyncMock(),
                auth=AsyncMock(),
            )

        self.assertTrue(mock_sdk.call_args.kwargs['force_first_tool_call'])


if __name__ == '__main__':
    unittest.main()
