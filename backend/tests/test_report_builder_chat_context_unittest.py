import os
import sys
import json
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services.report_builder import chat_handler, session_store
from app.services.chat_engine.prompts import app_context as app_context_prompt
from app.services.chat_engine.prompts import scratchpad as scratchpad_prompt
from app.services.chat_engine.prompts import user_context as user_context_prompt


class ReportBuilderChatContextTests(unittest.IsolatedAsyncioTestCase):
    def test_create_session_initializes_context_and_scratchpad_state(self):
        session_id, session = session_store.create_session(
            app_id='kaira-bot',
            tenant_id='tenant-1',
            user_id='user-1',
            provider='openai',
            model='gpt-4o',
        )

        self.assertTrue(session_id)
        self.assertIn('scratchpad', session)
        self.assertIn('_app_context', session)
        self.assertIn('_user_context', session)
        self.assertEqual(session['scratchpad'], {
            'findings': [],
            'composed_report': None,
            'errors': [],
        })
        self.assertIsNone(session['_app_context'])
        self.assertIsNone(session['_user_context'])

    def test_scratchpad_render_handles_empty_and_populated_state(self):
        self.assertEqual(scratchpad_prompt.render({}), '')
        self.assertEqual(
            scratchpad_prompt.render({
                'scratchpad': {
                    'findings': [],
                    'composed_report': None,
                    'errors': [],
                },
            }),
            '',
        )

        rendered = scratchpad_prompt.render({
            'scratchpad': {
                'findings': ['pass rate by app (4 rows)'],
                'composed_report': {'name': 'Weekly Review', 'sections': ['summary_cards', 'compliance_table']},
                'errors': ['analyze: database unavailable'],
            },
        })

        self.assertIn('SESSION STATE:', rendered)
        self.assertIn('- pass rate by app (4 rows)', rendered)
        self.assertIn('Current composed report: "Weekly Review" (summary_cards, compliance_table)', rendered)
        self.assertIn('- analyze: database unavailable', rendered)

    def test_update_scratchpad_tracks_successes_and_errors(self):
        session = {
            '_user_context': 'STALE USER CONTEXT',
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
            },
        }

        chat_handler._update_scratchpad(
            session,
            'analyze',
            json.dumps({
                'status': 'ok',
                'question': 'pass rate by app',
                'row_count': 4,
            }),
        )
        chat_handler._update_scratchpad(
            session,
            'compose_report',
            json.dumps({
                'status': 'ok',
                'report_name': 'Weekly Review',
                'sections': [
                    {'type': 'summary_cards'},
                    {'type': 'compliance_table'},
                ],
            }),
        )
        chat_handler._update_scratchpad(
            session,
            'save_template',
            json.dumps({
                'status': 'saved',
                'report_name': 'Weekly Review',
            }),
        )
        chat_handler._update_scratchpad(
            session,
            'compose_report',
            json.dumps({
                'status': 'error',
                'errors': ['Unknown section type: heatmap'],
            }),
        )

        self.assertEqual(
            session['scratchpad']['findings'],
            ['pass rate by app (4 rows)', 'Saved template: Weekly Review'],
        )
        self.assertEqual(
            session['scratchpad']['composed_report'],
            {
                'name': 'Weekly Review',
                'sections': ['summary_cards', 'compliance_table'],
            },
        )
        self.assertEqual(session['scratchpad']['errors'], ['compose_report: Unknown section type: heatmap'])
        self.assertIsNone(session['_user_context'])

    async def test_assemble_context_combines_all_layers(self):
        session = {
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
            },
        }

        with patch('app.services.chat_engine.prompts.base.render', return_value='BASE'), patch(
            'app.services.chat_engine.prompts.app_context.render',
            new=AsyncMock(return_value='APP CONTEXT'),
        ), patch(
            'app.services.chat_engine.prompts.user_context.render',
            new=AsyncMock(return_value='USER CONTEXT'),
        ), patch(
            'app.services.chat_engine.prompts.scratchpad.render',
            return_value='SCRATCHPAD',
        ):
            assembled = await chat_handler.assemble_context(session, AsyncMock())

        self.assertEqual(assembled, 'BASE\n\nAPP CONTEXT\n\nUSER CONTEXT\n\nSCRATCHPAD')

    async def test_app_context_render_returns_cached_value(self):
        session = {
            '_app_context': 'CACHED APP CONTEXT',
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
        }

        db = AsyncMock()
        rendered = await app_context_prompt.render(session, db)

        self.assertEqual(rendered, 'CACHED APP CONTEXT')
        db.execute.assert_not_called()

    async def test_user_context_render_returns_cached_value(self):
        session = {
            '_user_context': 'CACHED USER CONTEXT',
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
        }

        db = AsyncMock()
        rendered = await user_context_prompt.render(session, db)

        self.assertEqual(rendered, 'CACHED USER CONTEXT')
        db.execute.assert_not_called()

    async def test_run_chat_turn_does_not_mutate_save_state_before_commit(self):
        class FakeAdapter:
            @staticmethod
            def build_user_message(text: str) -> dict[str, str]:
                return {'role': 'user', 'content': text}

        async def fake_run_tool_loop(**kwargs):
            await kwargs['dispatch_fn'](
                'save_template',
                {
                    'report_name': 'Weekly Review',
                    'sections': [],
                },
            )
            return 'done', kwargs['messages']

        session = {
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            '_user_context': 'CACHED USER CONTEXT',
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
            },
        }
        db = AsyncMock()
        db.commit.side_effect = RuntimeError('commit failed')

        with patch('app.services.report_builder.chat_handler._resolve_tools_for_app', new=AsyncMock(return_value=[])), patch(
            'app.services.report_builder.chat_handler.create_adapter',
            new=AsyncMock(return_value=FakeAdapter()),
        ), patch(
            'app.services.report_builder.chat_handler.run_tool_loop',
            new=AsyncMock(side_effect=fake_run_tool_loop),
        ), patch(
            'app.services.report_builder.chat_handler.dispatch_tool_call',
            new=AsyncMock(return_value=json.dumps({
                'status': 'saved',
                'report_name': 'Weekly Review',
            })),
        ), patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='SYSTEM'),
        ):
            with self.assertRaisesRegex(RuntimeError, 'commit failed'):
                await chat_handler.run_chat_turn(
                    session,
                    'save this',
                    provider='openai',
                    model='gpt-4o',
                    db=db,
                    auth=AsyncMock(),
                )

        self.assertEqual(session['scratchpad']['findings'], [])
        self.assertEqual(session['_user_context'], 'CACHED USER CONTEXT')


if __name__ == '__main__':
    unittest.main()
