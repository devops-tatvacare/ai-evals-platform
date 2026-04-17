from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services.report_builder.tool_handlers import (
    canonicalize_tool_invocation,
    handle_analyze,
    handle_data_check,
    handle_data_query,
    handle_get_surface_records,
    handle_query_eval_runs,
    handle_resolve_entity,
    handle_save_template,
)


def test_canonicalize_tool_invocation_rewrites_legacy_aliases():
    name, args = canonicalize_tool_invocation(
        'save_template',
        {'report_name': 'Weekly Review', 'sections': []},
    )

    assert name == 'blueprint_save'
    assert args == {'name': 'Weekly Review', 'sections': []}


def test_canonicalize_tool_invocation_collapses_section_lookup_aliases():
    name, args = canonicalize_tool_invocation(
        'get_section_detail',
        {'section_type': 'summary_cards', 'app_id': 'kaira-bot'},
    )

    assert name == 'blueprint_blocks'
    assert args == {'block_type': 'summary_cards', 'app_id': 'kaira-bot'}


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
    assert kwargs['question_context']['prior_analysis']['preview_rows'][0]['run_name'] == 'test 1'
    assert kwargs['question_context']['resolved_entities']['thread_id']['matches'][0]['value'] == 'thrd-50adbf9f-cc1b-4919-ad31-513deaee6d31'


@pytest.mark.asyncio
async def test_handle_data_query_carries_active_filters_and_schema_subset():
    db = AsyncMock()
    auth = SimpleNamespace()
    session = {
        'scratchpad': {
            'active_filters': {'eval_type': 'custom'},
            'discovered_schema': {
                'tables_inspected': ['eval_runs'],
                'columns_by_table': {'eval_runs': [{'column_name': 'created_at', 'parsed_comment': {'role': 'temporal'}}]},
                'relations_found': [],
                'json_structures': {},
            },
            'last_analysis': {
                'question': 'show runs',
                'columns': ['created_at', 'total_runs'],
                'preview_rows': [{'created_at': '2026-04-01', 'total_runs': 4}],
                'sql_used': 'select created_at, total_runs from eval_runs',
            },
            'analysis_history': [],
            'resolved_entities': {},
        },
    }

    with patch(
        'app.services.chat_engine.sql_agent.data_query',
        new=AsyncMock(return_value={'status': 'ok'}),
    ) as data_query_mock:
        await handle_data_query(
            question='now show weekly runs',
            db=db,
            auth=auth,
            app_id='kaira-bot',
            provider='openai',
            session=session,
        )

    context = data_query_mock.await_args.kwargs['context']
    assert context['active_filters'] == {'eval_type': 'custom'}
    assert context['discovered_schema']['tables_inspected'] == ['eval_runs']


@pytest.mark.asyncio
async def test_handle_data_check_forwards_table_and_filters():
    db = AsyncMock()
    auth = SimpleNamespace()

    with patch(
        'app.services.chat_engine.sql_agent.data_check',
        new=AsyncMock(return_value={'status': 'ok', 'row_count': 4}),
    ) as data_check_mock:
        result = await handle_data_check(
            table='eval_runs',
            filters={'eval_type': 'custom'},
            db=db,
            auth=auth,
            app_id='kaira-bot',
        )

    assert result['row_count'] == 4
    assert data_check_mock.await_args.kwargs['table'] == 'eval_runs'
    assert data_check_mock.await_args.kwargs['filters'] == {'eval_type': 'custom'}


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
async def test_handle_save_template_persists_source_session_lineage():
    db = AsyncMock()
    db.add = Mock()
    auth = SimpleNamespace(
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
    )

    payload = await handle_save_template(
        report_name='Weekly Review',
        sections=[{'id': 'summary', 'type': 'summary_cards', 'title': 'Summary'}],
        db=db,
        auth=auth,
        app_id='kaira-bot',
        session={'chat_session_id': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221'},
    )

    assert payload['status'] == 'saved'
    saved_config = db.add.call_args.args[0]
    assert str(getattr(saved_config, 'source_session_id', '')) == '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221'

