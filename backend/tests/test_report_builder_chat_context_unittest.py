import json
import unittest
from unittest.mock import AsyncMock, patch

from app.services.report_builder import chat_handler, session_store
from app.services.report_builder.scratchpad_state import default_scratchpad
from app.services.chat_engine.prompts import base as base_prompt
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
        self.assertEqual(session['scratchpad'], default_scratchpad())
        self.assertIsNone(session['_app_context'])
        self.assertIsNone(session['_user_context'])

    def test_scratchpad_render_handles_empty_and_populated_state(self):
        self.assertEqual(scratchpad_prompt.render({}), '')
        self.assertEqual(
            scratchpad_prompt.render({
                'scratchpad': default_scratchpad(),
            }),
            '',
        )

        rendered = scratchpad_prompt.render({
            'scratchpad': {
                **default_scratchpad(),
                'findings': ['pass rate by app (4 rows)'],
                'composed_report': {'name': 'Weekly Review', 'sections': ['summary_cards', 'compliance_table']},
                'errors': ['data_query: database unavailable'],
                'resolved_entities': {'thread_id': {'matches': [{'value': 'thrd-123'}]}},
                'active_filters': {'run_id': 'run-123'},
                'last_analysis': {
                    'question': 'latest run summary',
                    'row_count': 1,
                    'columns': ['run_name', 'pass_rate'],
                    'columns_metadata': [
                        {'name': 'run_name', 'role': 'dimension'},
                        {'name': 'pass_rate', 'role': 'measure'},
                    ],
                    'preview_rows': [{'run_name': 'test 1', 'pass_rate': 60.0}],
                    'chart_summary': {'kind': 'chart', 'mark': 'bar'},
                    'warnings': [{'code': 'all_null_column'}],
                },
                'last_evidence': {'surface_key': 'logs', 'record_count': 4, 'entity_type': 'thread_id', 'entity_value': 'thrd-123'},
            },
        })

        self.assertIn('SESSION STATE:', rendered)
        self.assertIn('- pass rate by app (4 rows)', rendered)
        self.assertIn('Current composed report: "Weekly Review" (summary_cards, compliance_table)', rendered)
        self.assertIn('Latest analysis context:', rendered)
        self.assertIn('- Columns: run_name, pass_rate', rendered)
        self.assertIn('- Column roles: run_name (dimension), pass_rate (measure)', rendered)
        self.assertIn('- Row: run_name=test 1, pass_rate=60.0', rendered)
        self.assertIn('Active filters to carry forward unless the user changes them:', rendered)
        self.assertIn('- run_id: run-123', rendered)
        self.assertIn('- Result warnings: all_null_column', rendered)
        self.assertIn('Resolved entities:', rendered)
        self.assertIn('- thread_id: thrd-123', rendered)
        self.assertIn('Latest evidence context:', rendered)
        self.assertIn('- data_query: database unavailable', rendered)

    def test_update_scratchpad_tracks_successes_and_errors(self):
        session = {
            '_user_context': 'STALE USER CONTEXT',
            'scratchpad': default_scratchpad(),
        }

        chat_handler._update_scratchpad(
            session,
            'data_query',
            json.dumps({
                'status': 'ok',
                'question': 'pass rate by app',
                'row_count': 4,
                'sql_used': 'select * from analytics_run_facts',
                'columns': [
                    {'name': 'run_name', 'role': 'dimension'},
                    {'name': 'pass_rate', 'role': 'measure'},
                ],
                'typed_columns': [
                    {
                        'name': 'run_name',
                        'role': 'dimension',
                        'data_type': 'nominal',
                        'semantic_type': None,
                        'cardinality': 2,
                        'null_frac': 0.0,
                        'is_constant': False,
                    },
                    {
                        'name': 'pass_rate',
                        'role': 'measure',
                        'data_type': 'quantitative',
                        'semantic_type': 'score',
                        'cardinality': 2,
                        'null_frac': 0.0,
                        'is_constant': False,
                    },
                ],
                'warnings': [{'code': 'possible_missing_group_by'}],
                'applied_filters': {'eval_type': 'custom'},
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
        self.assertEqual(snapshot['columns_metadata'][0]['role'], 'dimension')
        self.assertEqual(snapshot['data'], [
            {'run_name': 'test 1', 'pass_rate': 60.0},
            {'run_name': 'test 2', 'pass_rate': 88.0},
        ])
        self.assertEqual(snapshot['preview_rows'], [
            {'run_name': 'test 1', 'pass_rate': 60.0},
            {'run_name': 'test 2', 'pass_rate': 88.0},
        ])
        self.assertEqual(snapshot['focus'], {'run_name': 'test 1', 'pass_rate': 60.0})
        self.assertEqual(snapshot['applied_filters'], {'eval_type': 'custom'})
        self.assertEqual(snapshot['warnings'], [{'code': 'possible_missing_group_by'}])
        self.assertEqual(session['scratchpad']['active_filters'], {'eval_type': 'custom'})
        # Classifier + chart-contract summary fields are present
        self.assertIn('column_types', snapshot)
        self.assertIn('chart_summary', snapshot)
        self.assertEqual(snapshot['chart_summary'], {'kind': 'chart', 'mark': 'bar'})
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
        session = {'scratchpad': default_scratchpad()}

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
            'scratchpad': default_scratchpad(),
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
        ), patch(
            'app.services.chat_engine.prompt_generator.render_tools_section',
            return_value='TOOLS',
        ):
            assembled = await chat_handler.assemble_context(session, AsyncMock())

        self.assertEqual(assembled, 'BASE\n\nTOOLS\n\nAPP CONTEXT\n\nUSER CONTEXT\n\nSCRATCHPAD')

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
            'app.services.report_builder.chat_handler.load_app_config',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.report_builder.chat_handler.load_entity_registry',
            return_value=[],
        ), patch(
            'app.services.report_builder.chat_handler.recognize_entities',
            new=AsyncMock(return_value=chat_handler.EntityRecognitionResult()),
        ), patch(
            'app.services.report_builder.chat_handler.record_user_message',
            new=AsyncMock(return_value='user-message-1'),
        ), patch(
            'app.services.report_builder.chat_handler.create_assistant_message',
            new=AsyncMock(return_value='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221'),
        ), patch(
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.finalize_assistant_message',
            new=AsyncMock(),
        ), patch(
            'app.services.report_builder.chat_handler.append_runtime_event',
            new=AsyncMock(side_effect=range(1, 20)),
        ), patch(
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
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

    def test_scratchpad_renders_chart_summary_prose(self):
        """Phase 5: kind-discriminated chart_summary renders a concrete prose hint."""
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
                    'chart_summary': {'kind': 'chart', 'mark': 'bar'},
                    'preview_rows': [{'agent': 'Alice', 'revenue': 100}],
                },
                'analysis_history': [],
                'last_evidence': None,
            },
        }
        rendered = scratchpad_prompt.render(session)
        self.assertIn('rendered as a bar chart', rendered)

    def test_scratchpad_renders_table_fallback_with_reason(self):
        session = {
            'scratchpad': {
                'findings': [],
                'composed_report': None,
                'errors': [],
                'discovery': None,
                'lookups': {},
                'resolved_entities': {},
                'last_analysis': {
                    'question': 'failed threads',
                    'row_count': 19,
                    'columns': ['thread_id', 'is_failed'],
                    'column_types': {},
                    'chart_summary': {
                        'kind': 'table',
                        'reason_code': 'CG_DEGENERATE_MEASURE',
                    },
                    'preview_rows': [],
                },
                'analysis_history': [],
                'last_evidence': None,
            },
        }
        rendered = scratchpad_prompt.render(session)
        self.assertIn('rendered as a table', rendered)
        self.assertIn('CG_DEGENERATE_MEASURE', rendered)

    def test_scratchpad_omits_chart_line_when_no_summary(self):
        """No chart_summary → no chart-kind hint line in rendered prompt."""
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
                    'chart_summary': None,
                    'preview_rows': [],
                },
                'analysis_history': [],
                'last_evidence': None,
            },
        }
        rendered = scratchpad_prompt.render(session)
        self.assertNotIn('rendered as a', rendered)

    def test_semantic_model_ordering_produces_ordered_categorical(self):
        """kaira-bot result_status ordering still promotes ordered categorical classification."""
        from app.services.chat_engine.sql_agent import load_semantic_model, _normalize_dimensions
        from app.services.chat_engine.chart_classifier import classify_columns

        model = load_semantic_model('kaira-bot')
        dimensions = _normalize_dimensions(model)
        ordered_names = [d['name'] for d in dimensions if d.get('ordering')]
        self.assertIn('result_status', ordered_names)

        rows = [{'result_status': 'PASS', 'count': 10}]
        column_types = classify_columns(['result_status', 'count'], rows, dimensions=dimensions)
        self.assertEqual(column_types['result_status'], 'ordered_categorical')

    def test_analytics_tools_expose_v2_contract(self):
        """Sherlock v2 should expose data_check + data_query, not render_chart."""
        from app.services.report_builder.tool_definitions import ANALYTICS_TOOLS

        names = [tool['name'] for tool in ANALYTICS_TOOLS]
        self.assertIn('data_check', names)
        self.assertIn('data_query', names)
        self.assertNotIn('render_chart', names)

    def test_report_builder_tools_expose_blueprint_contract(self):
        from app.services.report_builder.tool_definitions import REPORT_BUILDER_TOOLS

        names = [tool['name'] for tool in REPORT_BUILDER_TOOLS]
        self.assertEqual(
            names,
            ['blueprint_blocks', 'blueprint_compose', 'blueprint_save', 'blueprint_list'],
        )

    def test_base_prompt_drops_deprecated_tool_names(self):
        rendered = base_prompt.render()

        for deprecated_name in (
            'analyze(',
            'render_chart',
            'compose_report',
            'save_template',
            'list_section_types',
            'list_app_sections',
            'get_section_detail',
        ):
            self.assertNotIn(deprecated_name, rendered)

    def test_scratchpad_render_handles_non_dict_chart_summary(self):
        """If chart_summary is somehow corrupted to non-dict, render must not crash."""
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
                    'chart_summary': 'not-a-dict',
                    'preview_rows': [],
                },
                'analysis_history': [],
                'last_evidence': None,
            },
        }
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
        self.assertIsNone(snapshot['chart_summary'])

    def test_build_snapshot_with_none_data(self):
        from app.services.report_builder.scratchpad_state import build_analysis_snapshot

        snapshot = build_analysis_snapshot({
            'status': 'ok',
            'question': 'test',
            'data': None,
        })
        self.assertEqual(snapshot['data'], [])
        self.assertIsNone(snapshot['chart_summary'])

    def test_build_analysis_snapshot_derives_chart_summary_from_typed_columns(self):
        """Phase 5: snapshot derives chart_summary by running the chart-contract
        gate + picker on ``typed_columns`` — no more chart_options dependency."""
        from app.services.report_builder.scratchpad_state import build_analysis_snapshot

        snapshot = build_analysis_snapshot({
            'status': 'ok',
            'question': 'pass rate by evaluator',
            'row_count': 2,
            'data': [
                {'evaluator': 'E1', 'pass_rate': 80},
                {'evaluator': 'E2', 'pass_rate': 60},
            ],
            'typed_columns': [
                {
                    'name': 'evaluator',
                    'role': 'dimension',
                    'data_type': 'nominal',
                    'semantic_type': 'category',
                    'cardinality': 2,
                    'null_frac': 0.0,
                    'is_constant': False,
                },
                {
                    'name': 'pass_rate',
                    'role': 'measure',
                    'data_type': 'quantitative',
                    'semantic_type': 'score',
                    'cardinality': 2,
                    'null_frac': 0.0,
                    'is_constant': False,
                },
            ],
        })
        self.assertIn('column_types', snapshot)
        self.assertIsInstance(snapshot['column_types'], dict)
        self.assertIsInstance(snapshot['chart_summary'], dict)
        self.assertEqual(snapshot['chart_summary']['kind'], 'chart')
        self.assertEqual(snapshot['chart_summary']['mark'], 'bar')

    def test_build_analysis_snapshot_degenerate_measure_yields_table_summary(self):
        from app.services.report_builder.scratchpad_state import build_analysis_snapshot

        snapshot = build_analysis_snapshot({
            'status': 'ok',
            'question': 'failed threads',
            'row_count': 3,
            'data': [{'thread_id': f't{i}', 'is_failed': 1} for i in range(3)],
            'typed_columns': [
                {
                    'name': 'thread_id',
                    'role': 'identifier',
                    'data_type': 'nominal',
                    'semantic_type': 'id_hash',
                    'cardinality': 3,
                    'null_frac': 0.0,
                    'is_constant': False,
                },
                {
                    'name': 'is_failed',
                    'role': 'measure',
                    'data_type': 'quantitative',
                    'semantic_type': 'count',
                    'cardinality': 1,
                    'null_frac': 0.0,
                    'is_constant': True,
                },
            ],
        })
        self.assertEqual(snapshot['chart_summary']['kind'], 'table')
        self.assertEqual(snapshot['chart_summary']['reason_code'], 'CG_DEGENERATE_MEASURE')


class AnalyticsLibraryChartConfigTests(unittest.TestCase):
    """Ensure chart config saved to DB uses camelCase keys matching frontend expectations."""

    def test_chart_config_model_dump_uses_camel_case(self):
        """ChartConfigIn.model_dump(by_alias=True) must normalize to nested camelCase."""
        from app.routes.analytics_library import ChartConfigIn

        config = ChartConfigIn(
            renderer={
                'type': 'bar',
                'x_key': 'agent',
                'y_key': 'revenue',
                'series_keys': ['revenue', 'cost'],
                'x_label': 'Agent Name',
                'y_label': 'Revenue ($)',
                'legend_position': 'right',
                'series': [{'dataKey': 'revenue', 'type': 'bar'}],
            },
            canonical={
                'kind': 'chart',
                'spec': {'mark': 'bar', 'encoding': {'x': {'field': 'agent'}}},
            },
        )
        dumped = config.model_dump(by_alias=True)

        self.assertIn('renderer', dumped)
        self.assertEqual(dumped['renderer']['xKey'], 'agent')
        self.assertEqual(dumped['renderer']['yKey'], 'revenue')
        self.assertEqual(dumped['renderer']['legendPosition'], 'right')
        self.assertEqual(dumped['canonical']['kind'], 'chart')
        self.assertNotIn('x_key', dumped['renderer'])

    def test_chart_config_includes_series_and_legend_position(self):
        """ChartConfigIn must preserve nested renderer fields."""
        from app.routes.analytics_library import ChartConfigIn

        config = ChartConfigIn(
            renderer={
                'type': 'composed',
                'x_key': 'month',
                'series': [
                    {'dataKey': 'revenue', 'type': 'bar'},
                    {'dataKey': 'cost', 'type': 'line'},
                ],
                'legend_position': 'right',
            },
        )
        dumped = config.model_dump(by_alias=True)
        self.assertEqual(len(dumped['renderer']['series']), 2)
        self.assertEqual(dumped['renderer']['legendPosition'], 'right')

    def test_chart_config_roundtrip_matches_frontend_types(self):
        """Config saved then returned must match the nested SavedChart.chartConfig shape."""
        from app.routes.analytics_library import ChartConfigIn

        config = ChartConfigIn(
            renderer={
                'type': 'funnel',
                'x_key': 'stage',
                'y_key': 'count',
                'x_label': 'Stage',
                'y_label': 'Count',
            },
        )
        dumped = config.model_dump(by_alias=True)

        expected_renderer_keys = {'type', 'xKey', 'yKey', 'seriesKeys', 'series', 'title', 'xLabel', 'yLabel', 'legendPosition', 'colorMap'}
        self.assertTrue(
            expected_renderer_keys.issubset(set(dumped['renderer'].keys())),
            f"Missing keys: {expected_renderer_keys - set(dumped['renderer'].keys())}",
        )

    def test_normalize_chart_config_converts_snake_case_to_camel(self):
        """Old flat chart configs must normalize into nested camelCase output."""
        from app.routes.analytics_library import _normalize_chart_config

        old_config = {
            'type': 'bar',
            'x_key': 'agent',
            'y_key': 'revenue',
            'series_keys': ['revenue'],
            'x_label': 'Agent',
            'y_label': 'Revenue',
        }
        normalized = _normalize_chart_config(old_config)
        self.assertEqual(normalized['renderer']['xKey'], 'agent')
        self.assertEqual(normalized['renderer']['yKey'], 'revenue')
        self.assertEqual(normalized['renderer']['seriesKeys'], ['revenue'])
        self.assertEqual(normalized['renderer']['xLabel'], 'Agent')
        self.assertEqual(normalized['renderer']['yLabel'], 'Revenue')
        self.assertNotIn('x_key', normalized['renderer'])

    def test_normalize_chart_config_preserves_camel_case(self):
        """New charts already in camelCase should pass through unchanged."""
        from app.routes.analytics_library import _normalize_chart_config

        new_config = {
            'renderer': {
                'type': 'pie',
                'xKey': 'category',
                'yKey': 'count',
                'seriesKeys': [],
                'xLabel': '',
                'yLabel': '',
            },
        }
        normalized = _normalize_chart_config(new_config)
        self.assertEqual(normalized['renderer']['xKey'], 'category')
        self.assertEqual(normalized['renderer']['yKey'], 'count')

    def test_normalize_chart_config_handles_none_and_empty(self):
        from app.routes.analytics_library import _normalize_chart_config

        self.assertEqual(_normalize_chart_config(None), {})
        self.assertEqual(_normalize_chart_config({}), {})


if __name__ == '__main__':
    unittest.main()
