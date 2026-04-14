from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services.report_builder.tool_handlers import (
    handle_analyze,
    handle_get_surface_records,
    handle_query_eval_runs,
    handle_render_chart,
    handle_resolve_entity,
)


@pytest.mark.asyncio
async def test_query_eval_runs_returns_canonical_and_display_ids():
    run_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        eval_type='batch_thread',
        status='completed',
        created_at=datetime(2026, 4, 12, 17, 0, tzinfo=timezone.utc),
        batch_metadata={'name': 'Smoke'},
        summary={'total_evaluated': 12},
    )
    result_proxy = Mock()
    result_proxy.scalars.return_value.all.return_value = [run]
    db = AsyncMock()
    db.execute.return_value = result_proxy
    auth = SimpleNamespace(is_owner=True, app_access=frozenset({'kaira-bot'}))

    with patch('app.services.access_control.readable_scope_clause', return_value=True):
        payload = await handle_query_eval_runs(
            limit=10,
            db=db,
            auth=auth,
            app_id='kaira-bot',
        )

    assert payload['runs'][0]['id'] == str(run_id)
    assert payload['runs'][0]['display_id'] == str(run_id)[:8]


@pytest.mark.asyncio
async def test_handle_analyze_forwards_followup_context_from_session():
    db = AsyncMock()
    auth = SimpleNamespace()
    session = {
        'scratchpad': {
            'last_analysis': {
                'question': 'Which rules were most frequently violated across recent evaluations?',
                'row_count': 23,
                'columns': ['rule_id', 'violated'],
                'preview_rows': [{'rule_id': 'single_item_one_table', 'violated': 35}],
                'focus': {'rule_id': 'single_item_one_table', 'violated': 35},
            },
            'analysis_history': [
                {
                    'question': 'List the 5 most recent runs with date, eval type, and pass rate.',
                    'row_count': 5,
                    'columns': ['run_date', 'eval_type', 'run_name', 'pass_rate'],
                    'preview_rows': [{'run_name': 'test 1', 'pass_rate': 60.0}],
                    'focus': {'run_name': 'test 1', 'pass_rate': 60.0},
                },
            ],
            'resolved_entities': {
                'thread_id': {
                    'search': 'thrd-50adbf9f-c',
                    'matches': [{'value': 'thrd-50adbf9f-cc1b-4919-ad31-513deaee6d31'}],
                },
            },
        },
    }

    with patch(
        'app.services.chat_engine.sql_agent.analyze',
        new=AsyncMock(return_value={'status': 'ok'}),
    ) as analyze_mock:
        await handle_analyze(
            question='Which thread had the most rule violations in the latest run?',
            db=db,
            auth=auth,
            app_id='kaira-bot',
            provider='openai',
            session=session,
        )

    kwargs = analyze_mock.await_args.kwargs
    assert kwargs['question'] == 'Which thread had the most rule violations in the latest run?'
    assert kwargs['question_context'] is not None
    assert 'test 1' in kwargs['question_context']
    assert 'thrd-50adbf9f-cc1b-4919-ad31-513deaee6d31' in kwargs['question_context']


@pytest.mark.asyncio
async def test_handle_resolve_entity_uses_shared_resolver():
    db = AsyncMock()
    auth = SimpleNamespace()

    with patch(
        'app.services.chat_engine.entity_resolution.resolve_entity_matches',
        new=AsyncMock(return_value={'status': 'ok', 'entity_type': 'thread_id', 'matches': [{'value': 'thrd-123'}]}),
    ) as resolve_mock:
        payload = await handle_resolve_entity(
            entity_type='thread_id',
            search='thrd-123',
            db=db,
            auth=auth,
            app_id='kaira-bot',
        )

    assert payload['status'] == 'ok'
    assert payload['matches'][0]['value'] == 'thrd-123'
    assert resolve_mock.await_args.kwargs['entity_type'] == 'thread_id'


@pytest.mark.asyncio
async def test_handle_get_surface_records_reuses_resolved_entity_from_scratchpad():
    db = AsyncMock()
    auth = SimpleNamespace()

    with patch(
        'app.services.chat_engine.sql_agent.load_app_config',
        new=AsyncMock(return_value={
            'chat': {
                'dataSurfaces': [
                    {
                        'key': 'logs',
                        'description': 'Raw logs',
                        'source': 'api_logs',
                        'entityFieldMap': {'thread_id': 'thread_id'},
                    },
                ],
            },
        }),
    ), patch(
        'app.services.chat_engine.data_surfaces.fetch_surface_records',
        new=AsyncMock(return_value={'surface': 'logs', 'source': 'api_logs', 'record_count': 2, 'records': [{'thread_id': 'thrd-123'}]}),
    ) as fetch_mock:
        payload = await handle_get_surface_records(
            surface_key='logs',
            entity_type='thread_id',
            db=db,
            auth=auth,
            app_id='kaira-bot',
            session={
                'scratchpad': {
                    'resolved_entities': {
                        'thread_id': {
                            'matches': [{'value': 'thrd-123'}],
                        },
                    },
                },
            },
        )

    assert payload['status'] == 'ok'
    assert payload['entity_value'] == 'thrd-123'
    assert fetch_mock.await_args.kwargs['entity_value'] == 'thrd-123'


@pytest.mark.asyncio
async def test_handle_render_chart_validates_latest_analysis_columns():
    payload = await handle_render_chart(
        chart_type='pie',
        title='Top Violated Rules',
        x_key='rule_name',
        y_key='violated_count',
        session={
            'scratchpad': {
                'last_analysis': {
                    'columns': ['rule_name', 'violated_count'],
                },
            },
        },
    )

    assert payload['status'] == 'ok'
    assert payload['chart_spec']['xKey'] == 'rule_name'

    error_payload = await handle_render_chart(
        chart_type='pie',
        title='Top Violated Rules',
        x_key='rule_name',
        y_key='missing_metric',
        session={
            'scratchpad': {
                'last_analysis': {
                    'columns': ['rule_name', 'violated_count'],
                },
            },
        },
    )

    assert error_payload['status'] == 'error'
    assert 'missing_metric' in error_payload['error']


class RenderChartEligibilityTests(unittest.IsolatedAsyncioTestCase):

    async def test_render_chart_accepts_eligible_type(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['stage', 'count'],
                    'column_types': {'stage': 'ordered_categorical', 'count': 'numeric'},
                    'eligible_charts': ['funnel', 'bar', 'pie'],
                    'data': [{'stage': 'new', 'count': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='funnel',
            title='Stage Progression',
            x_key='stage',
            y_key='count',
            session=session,
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['chart_spec']['type'], 'funnel')

    async def test_render_chart_rejects_ineligible_type(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['agent', 'revenue'],
                    'column_types': {'agent': 'categorical', 'revenue': 'numeric'},
                    'eligible_charts': ['bar', 'horizontal_bar', 'pie'],
                    'data': [{'agent': 'A', 'revenue': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='funnel',
            title='Test',
            x_key='agent',
            y_key='revenue',
            session=session,
        )
        self.assertEqual(result['status'], 'error')
        self.assertIn('not eligible', result['error'])

    async def test_render_chart_passes_through_alternatives(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['agent', 'revenue'],
                    'column_types': {'agent': 'categorical', 'revenue': 'numeric'},
                    'eligible_charts': ['bar', 'horizontal_bar', 'pie'],
                    'data': [{'agent': 'A', 'revenue': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='bar',
            title='Revenue',
            x_key='agent',
            y_key='revenue',
            alternatives=['horizontal_bar', 'pie'],
            session=session,
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['chart_spec']['alternatives'], ['horizontal_bar', 'pie'])

    async def test_render_chart_fallback_to_registry_when_no_eligible(self):
        """Backward compat: if scratchpad has no eligible_charts, accept any registry type."""
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['agent', 'revenue'],
                    'data': [{'agent': 'A', 'revenue': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='bar',
            title='Revenue',
            x_key='agent',
            y_key='revenue',
            session=session,
        )
        self.assertEqual(result['status'], 'ok')

    async def test_render_chart_series_field_for_composed(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['month', 'revenue', 'cost'],
                    'column_types': {'month': 'temporal', 'revenue': 'numeric', 'cost': 'numeric'},
                    'eligible_charts': ['composed', 'line', 'stacked_area'],
                    'data': [{'month': '2026-01', 'revenue': 100, 'cost': 50}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='composed',
            title='Revenue vs Cost',
            x_key='month',
            series=[
                {'data_key': 'revenue', 'type': 'bar'},
                {'data_key': 'cost', 'type': 'line'},
            ],
            session=session,
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(len(result['chart_spec']['series']), 2)

    async def test_render_chart_rejects_unknown_type_in_registry_fallback(self):
        """When no eligible_charts, unknown types rejected against registry."""
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['a', 'b'],
                    'data': [{'a': 1, 'b': 2}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='nonexistent_chart',
            title='Test',
            x_key='a',
            y_key='b',
            session=session,
        )
        self.assertEqual(result['status'], 'error')
        self.assertIn('Unknown chart type', result['error'])

    async def test_render_chart_missing_analysis_returns_error(self):
        session = {'scratchpad': {}}
        result = await handle_render_chart(
            chart_type='bar',
            title='Test',
            x_key='x',
            session=session,
        )
        self.assertEqual(result['status'], 'error')
        self.assertIn('No analysis result', result['error'])

    async def test_render_chart_validates_series_data_keys(self):
        """series[].data_key must exist in analysis columns."""
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['month', 'revenue'],
                    'eligible_charts': ['composed'],
                    'data': [{'month': '2026-01', 'revenue': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='composed',
            title='Test',
            x_key='month',
            series=[
                {'data_key': 'revenue', 'type': 'bar'},
                {'data_key': 'nonexistent', 'type': 'line'},
            ],
            session=session,
        )
        self.assertEqual(result['status'], 'error')
        self.assertIn('nonexistent', str(result['error']))

    async def test_render_chart_alternatives_capped_at_three(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['x', 'y'],
                    'eligible_charts': ['bar', 'pie', 'line', 'area', 'scatter'],
                    'data': [{'x': 'a', 'y': 1}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='bar',
            title='Test',
            x_key='x',
            y_key='y',
            alternatives=['pie', 'line', 'area', 'scatter'],
            session=session,
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(len(result['chart_spec']['alternatives']), 3)

    async def test_render_chart_none_session(self):
        result = await handle_render_chart(
            chart_type='bar',
            title='Test',
            x_key='x',
            session=None,
        )
        self.assertEqual(result['status'], 'error')

    async def test_render_chart_series_with_non_dict_items(self):
        """series array with non-dict items should not crash."""
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['month', 'revenue'],
                    'eligible_charts': ['composed'],
                    'data': [{'month': '2026-01', 'revenue': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='composed',
            title='Test',
            x_key='month',
            series=[
                {'data_key': 'revenue', 'type': 'bar'},
                'not-a-dict',
                None,
            ],
            session=session,
        )
        # Should succeed — non-dicts filtered out
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(len(result['chart_spec']['series']), 1)

    async def test_render_chart_empty_eligible_list_falls_back_to_registry(self):
        """Empty eligible_charts list (not missing, but []) should fall back to registry."""
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['x', 'y'],
                    'eligible_charts': [],
                    'data': [{'x': 'a', 'y': 1}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='bar',
            title='Test',
            x_key='x',
            y_key='y',
            session=session,
        )
        # Empty list is falsy, so falls back to registry check
        self.assertEqual(result['status'], 'ok')

    async def test_render_chart_alternatives_filters_invalid_types(self):
        """alternatives with unknown chart types are silently filtered."""
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['x', 'y'],
                    'eligible_charts': ['bar', 'pie'],
                    'data': [{'x': 'a', 'y': 1}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='bar',
            title='Test',
            x_key='x',
            y_key='y',
            alternatives=['pie', 'not_a_real_chart', 'also_fake'],
            session=session,
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['chart_spec']['alternatives'], ['pie'])

    async def test_render_chart_legend_position_passed_through(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['x', 'y'],
                    'eligible_charts': ['bar'],
                    'data': [{'x': 'a', 'y': 1}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='bar',
            title='Test',
            x_key='x',
            y_key='y',
            legend_position='right',
            session=session,
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['chart_spec']['legendPosition'], 'right')
