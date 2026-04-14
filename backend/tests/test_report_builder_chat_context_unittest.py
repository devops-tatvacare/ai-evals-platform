import json
import unittest
from unittest.mock import AsyncMock, patch

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
            'discovery': None,
            'lookups': {},
            'resolved_entities': {},
            'last_analysis': None,
            'analysis_history': [],
            'last_evidence': None,
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
                    'discovery': None,
                    'lookups': {},
                    'resolved_entities': {},
                    'last_analysis': None,
                    'analysis_history': [],
                    'last_evidence': None,
                },
            }),
            '',
        )

        rendered = scratchpad_prompt.render({
            'scratchpad': {
                'findings': ['pass rate by app (4 rows)'],
                'composed_report': {'name': 'Weekly Review', 'sections': ['summary_cards', 'compliance_table']},
                'errors': ['analyze: database unavailable'],
                'resolved_entities': {'thread_id': {'matches': [{'value': 'thrd-123'}]}},
                'last_analysis': {
                    'question': 'latest run summary',
                    'row_count': 1,
                    'columns': ['run_name', 'pass_rate'],
                    'preview_rows': [{'run_name': 'test 1', 'pass_rate': 60.0}],
                },
                'analysis_history': [],
                'last_evidence': {'surface_key': 'logs', 'record_count': 4, 'entity_type': 'thread_id', 'entity_value': 'thrd-123'},
            },
        })

        self.assertIn('SESSION STATE:', rendered)
        self.assertIn('- pass rate by app (4 rows)', rendered)
        self.assertIn('Current composed report: "Weekly Review" (summary_cards, compliance_table)', rendered)
        self.assertIn('Latest analysis context:', rendered)
        self.assertIn('- Columns: run_name, pass_rate', rendered)
        self.assertIn('- Row: run_name=test 1, pass_rate=60.0', rendered)
        self.assertIn('Resolved entities:', rendered)
        self.assertIn('- thread_id: thrd-123', rendered)
        self.assertIn('Latest evidence context:', rendered)
        self.assertIn('- analyze: database unavailable', rendered)

    def test_update_scratchpad_tracks_successes_and_errors(self):
        session = {
            '_user_context': 'STALE USER CONTEXT',
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

        chat_handler._update_scratchpad(
            session,
            'analyze',
            json.dumps({
                'status': 'ok',
                'question': 'pass rate by app',
                'row_count': 4,
                'sql_used': 'select * from analytics_run_facts',
                'data': [
                    {'run_name': 'test 1', 'pass_rate': 60.0},
                    {'run_name': 'test 2', 'pass_rate': 88.0},
                ],
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
        snapshot = session['scratchpad']['last_analysis']
        self.assertEqual(snapshot['question'], 'pass rate by app')
        self.assertEqual(snapshot['row_count'], 4)
        self.assertEqual(snapshot['sql_used'], 'select * from analytics_run_facts')
        self.assertEqual(snapshot['columns'], ['run_name', 'pass_rate'])
        self.assertEqual(snapshot['data'], [
            {'run_name': 'test 1', 'pass_rate': 60.0},
            {'run_name': 'test 2', 'pass_rate': 88.0},
        ])
        self.assertEqual(snapshot['preview_rows'], [
            {'run_name': 'test 1', 'pass_rate': 60.0},
            {'run_name': 'test 2', 'pass_rate': 88.0},
        ])
        self.assertEqual(snapshot['focus'], {'run_name': 'test 1', 'pass_rate': 60.0})
        # Classifier fields are present
        self.assertIn('column_types', snapshot)
        self.assertIn('eligible_charts', snapshot)
        self.assertEqual(session['scratchpad']['analysis_history'], [session['scratchpad']['last_analysis']])
        self.assertEqual(
            session['scratchpad']['composed_report'],
            {
                'name': 'Weekly Review',
                'sections': ['summary_cards', 'compliance_table'],
            },
        )
        self.assertEqual(session['scratchpad']['errors'], ['compose_report: Unknown section type: heatmap'])
        self.assertIsNone(session['scratchpad']['discovery'])
        self.assertEqual(session['scratchpad']['lookups'], {})
        self.assertEqual(session['scratchpad']['resolved_entities'], {})
        self.assertIsNone(session['scratchpad']['last_evidence'])
        self.assertIsNone(session['_user_context'])

    def test_update_scratchpad_caches_discovery_and_lookup_results(self):
        session = {
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

        chat_handler._update_scratchpad(
            session,
            'discover',
            json.dumps({
                'status': 'ok',
                'app_id': 'inside-sales',
                'dimensions': [{'name': 'agent', 'values': [{'value': 'Pareekshith Bompally', 'count': 7}]}],
                'metrics': [{'name': 'pass_rate', 'description': 'Pass rate'}],
            }),
        )
        chat_handler._update_scratchpad(
            session,
            'lookup',
            json.dumps({
                'status': 'ok',
                'dimension': 'agent',
                'values': [{'value': 'Pareekshith Bompally', 'count': 7}],
            }),
        )

        self.assertEqual(session['scratchpad']['discovery']['app_id'], 'inside-sales')
        self.assertEqual(session['scratchpad']['lookups']['agent']['values'][0]['value'], 'Pareekshith Bompally')
        self.assertEqual(session['scratchpad']['resolved_entities'], {})
        self.assertIsNone(session['scratchpad']['last_analysis'])
        self.assertEqual(session['scratchpad']['analysis_history'], [])

    async def test_assemble_context_combines_all_layers(self):
        session = {
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
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
            'chat_session_id': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            'app_id': 'kaira-bot',
            'tenant_id': 'tenant-1',
            'user_id': 'user-1',
            'messages': [],
            '_user_context': 'CACHED USER CONTEXT',
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
        self.assertIsNone(session['scratchpad']['discovery'])
        self.assertEqual(session['scratchpad']['lookups'], {})
        self.assertIsNone(session['scratchpad']['last_analysis'])
        self.assertEqual(session['scratchpad']['analysis_history'], [])
        self.assertEqual(session['_user_context'], 'CACHED USER CONTEXT')


class ChartPipelineRegressionTests(unittest.TestCase):
    """Regression tests for the chart classifier → scratchpad → prompt pipeline."""

    def test_scratchpad_renders_eligible_chart_types(self):
        """Eligible chart types in last_analysis must appear in rendered scratchpad text."""
        session = {
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'resolved_entities': {},
                'last_analysis': {
                    'question': 'revenue by agent',
                    'row_count': 5,
                    'columns': ['agent', 'revenue'],
                    'column_types': {'agent': 'categorical', 'revenue': 'numeric'},
                    'eligible_charts': ['bar', 'horizontal_bar', 'pie'],
                    'preview_rows': [{'agent': 'Alice', 'revenue': 100}],
                },
                'analysis_history': [],
                'last_evidence': None,
            },
        }
        rendered = scratchpad_prompt.render(session)
        self.assertIn('Chart types for this data:', rendered)
        self.assertIn('bar', rendered)
        self.assertIn('Best fit: bar', rendered)

    def test_scratchpad_omits_chart_line_when_no_eligible(self):
        """No eligible_charts → no chart types line in rendered prompt."""
        session = {
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'resolved_entities': {},
                'last_analysis': {
                    'question': 'something',
                    'row_count': 0,
                    'columns': [],
                    'eligible_charts': [],
                    'preview_rows': [],
                },
                'analysis_history': [],
                'last_evidence': None,
            },
        }
        rendered = scratchpad_prompt.render(session)
        self.assertNotIn('Chart types for this data:', rendered)

    def test_semantic_model_ordering_produces_ordered_categorical(self):
        """inside-sales result_status dimension with ordering → ordered_categorical classification."""
        from app.services.chat_engine.sql_agent import load_semantic_model, _normalize_dimensions
        from app.services.chat_engine.chart_classifier import classify_columns

        model = load_semantic_model('inside-sales')
        dimensions = _normalize_dimensions(model)
        ordered_names = [d['name'] for d in dimensions if d.get('ordering')]
        self.assertIn('result_status', ordered_names)

        rows = [{'result_status': 'PASS', 'count': 10}]
        column_types = classify_columns(['result_status', 'count'], rows, dimensions=dimensions)
        self.assertEqual(column_types['result_status'], 'ordered_categorical')

    def test_render_chart_tool_has_no_enum_on_chart_type(self):
        """Regression: render_chart.chart_type must NOT have an enum constraint."""
        from app.services.report_builder.tool_definitions import ANALYTICS_TOOLS

        render_chart_tool = next(t for t in ANALYTICS_TOOLS if t['name'] == 'render_chart')
        chart_type_prop = render_chart_tool['inputSchema']['properties']['chart_type']
        self.assertNotIn('enum', chart_type_prop, 'chart_type must not have enum — classifier handles eligibility')

    def test_scratchpad_render_handles_non_list_eligible_charts(self):
        """If eligible_charts is somehow corrupted to non-list, render should not crash."""
        session = {
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'resolved_entities': {},
                'last_analysis': {
                    'question': 'test',
                    'row_count': 1,
                    'columns': ['x'],
                    'eligible_charts': 'not-a-list',
                    'preview_rows': [],
                },
                'analysis_history': [],
                'last_evidence': None,
            },
        }
        # Should not crash — just skip the chart types line
        rendered = scratchpad_prompt.render(session)
        self.assertIsInstance(rendered, str)

    def test_build_snapshot_with_malformed_data_field(self):
        """result['data'] is not a list — should gracefully handle."""
        from app.services.report_builder.scratchpad_state import build_analysis_snapshot

        snapshot = build_analysis_snapshot({
            'status': 'ok',
            'question': 'test',
            'row_count': 0,
            'data': 'not-a-list',
        })
        self.assertEqual(snapshot['data'], [])
        self.assertEqual(snapshot['column_types'], {})
        self.assertEqual(snapshot['eligible_charts'], [])

    def test_build_snapshot_with_none_data(self):
        from app.services.report_builder.scratchpad_state import build_analysis_snapshot

        snapshot = build_analysis_snapshot({
            'status': 'ok',
            'question': 'test',
            'data': None,
        })
        self.assertEqual(snapshot['data'], [])
        self.assertIsInstance(snapshot['eligible_charts'], list)

    def test_build_analysis_snapshot_always_includes_classifier_fields(self):
        """Regression: snapshot must always include column_types and eligible_charts."""
        from app.services.report_builder.scratchpad_state import build_analysis_snapshot

        snapshot = build_analysis_snapshot({
            'status': 'ok',
            'question': 'test',
            'row_count': 1,
            'data': [{'x': 'a', 'y': 1}],
        })
        self.assertIn('column_types', snapshot)
        self.assertIn('eligible_charts', snapshot)
        self.assertIsInstance(snapshot['column_types'], dict)
        self.assertIsInstance(snapshot['eligible_charts'], list)


if __name__ == '__main__':
    unittest.main()
