from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


class CancelBuilderTurnRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_force_interrupt_branch_publishes_terminal_event_and_closes_stream(self):
        from app.routes import report_builder as route

        runtime_session = SimpleNamespace(
            chat_session_id='session-1',
            app_id='voice-rx',
        )
        initial_turn = SimpleNamespace(
            id='turn-1',
            status='active',
            assistant_message_id='assistant-1',
            last_error=None,
            last_event_seq=0,
        )
        interrupted_turn = SimpleNamespace(
            id='turn-1',
            status='interrupted',
            assistant_message_id='assistant-1',
            last_error='Cancelled by user',
            last_event_seq=1,
        )
        snapshot = {
            'messages': [
                {
                    'id': 'assistant-1',
                    'role': 'assistant',
                    'content': 'Cancelled by user',
                    'metadata': {
                        'terminalStatus': 'interrupted',
                        'lastError': 'Cancelled by user',
                    },
                },
            ],
        }

        with (
            patch.object(route, 'get_sherlock_runtime_session', AsyncMock(return_value=runtime_session)),
            patch.object(route, 'get_turn', AsyncMock(side_effect=[initial_turn, interrupted_turn])),
            patch.object(route, '_has_live_turn_task', return_value=False),
            patch.object(route, '_force_interrupt_turn', AsyncMock()) as force_interrupt,
            patch.object(route, 'get_sherlock_runtime_session_snapshot', AsyncMock(return_value=snapshot)),
            patch.object(route, '_publish_turn_event', AsyncMock()) as publish_event,
            patch.object(route, '_close_turn_stream', AsyncMock()) as close_stream,
        ):
            response = await route.cancel_builder_turn_v2(
                session_id='session-1',
                turn_id='turn-1',
                app_id='voice-rx',
                auth=MagicMock(),
                db=AsyncMock(),
            )

        self.assertEqual(response.result, 'forced_interrupted')
        self.assertEqual(response.turn_status, 'interrupted')
        force_interrupt.assert_awaited_once()
        publish_event.assert_awaited_once()
        close_stream.assert_awaited_once_with('turn-1')
        published_turn_id, published_payload = publish_event.await_args.args
        self.assertEqual(published_turn_id, 'turn-1')
        self.assertEqual(published_payload['event'], 'error_emitted')
        self.assertEqual(published_payload['data']['status'], 'interrupted')
        self.assertEqual(published_payload['data']['message'], 'Cancelled by user')

