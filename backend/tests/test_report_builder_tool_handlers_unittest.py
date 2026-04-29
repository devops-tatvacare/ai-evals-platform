from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services.chat_engine.artifact import ToolEnvelopeModel
from app.services.report_builder.tool_handlers import (
    handle_data_check,
    handle_data_query,
    handle_get_surface_records,
    handle_resolve_entity,
    handle_save_template,
)

@pytest.mark.asyncio
async def test_handle_data_query_carries_active_filters_and_schema_subset():
    db = AsyncMock()
    auth = SimpleNamespace()
    session = {
        'scratchpad': {
            'active_filters': {'eval_type': 'custom'},
            'discovered_schema': {
                'tables_inspected': ['evaluation_runs'],
                'columns_by_table': {'evaluation_runs': [{'column_name': 'created_at', 'parsed_comment': {'role': 'temporal'}}]},
                'relations_found': [],
                'json_structures': {},
            },
            'last_analysis': {
                'question': 'show runs',
                'columns': ['created_at', 'total_runs'],
                'preview_rows': [{'created_at': '2026-04-01', 'total_runs': 4}],
                'sql_used': 'select created_at, total_runs from evaluation_runs',
            },
            'analysis_history': [],
            'resolved_entities': {},
        },
    }

    with patch(
        'app.services.chat_engine.sql_agent.data_query',
        new=AsyncMock(return_value={'status': 'ok'}),
    ) as data_query_mock:
        result = await handle_data_query(
            question='now show weekly runs',
            db=db,
            auth=auth,
            app_id='kaira-bot',
            provider='openai',
            session=session,
        )

    assert isinstance(result, ToolEnvelopeModel)
    assert result['status'] == 'ok'
    context = data_query_mock.await_args.kwargs['context']
    assert context['active_filters'] == {'eval_type': 'custom'}
    assert context['discovered_schema']['tables_inspected'] == ['evaluation_runs']


@pytest.mark.asyncio
async def test_handle_data_check_forwards_table_and_filters():
    db = AsyncMock()
    auth = SimpleNamespace()

    with patch(
        'app.services.chat_engine.sql_agent.data_check',
        new=AsyncMock(return_value={'status': 'ok', 'row_count': 4}),
    ) as data_check_mock:
        result = await handle_data_check(
            table='evaluation_runs',
            filters={'eval_type': 'custom'},
            db=db,
            auth=auth,
            app_id='kaira-bot',
        )

    assert isinstance(result, ToolEnvelopeModel)
    # Phase 2: handler returns a §6.2 envelope; data_check raw fields
    # live under ``envelope.payload``.
    assert result['status'] == 'ok'
    assert result['payload']['row_count'] == 4
    assert data_check_mock.await_args.kwargs['table'] == 'evaluation_runs'
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

    assert isinstance(payload, ToolEnvelopeModel)
    # Phase 2: envelope shape — matches live under ``envelope.payload``.
    assert payload['status'] == 'ok'
    assert payload['payload']['matches'][0]['value'] == 'thrd-123'
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
                        'source': 'evaluation_run_api_call_logs',
                        'entityFieldMap': {'thread_id': 'thread_id'},
                    },
                ],
            },
        }),
    ), patch(
        'app.services.chat_engine.data_surfaces.fetch_surface_records',
        new=AsyncMock(return_value={'surface': 'logs', 'source': 'evaluation_run_api_call_logs', 'record_count': 2, 'records': [{'thread_id': 'thrd-123'}]}),
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

    assert isinstance(payload, ToolEnvelopeModel)
    # Phase 2: envelope shape — per-tool fields live under ``envelope.payload``.
    assert payload['status'] == 'ok'
    assert payload['payload']['entity_value'] == 'thrd-123'
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

    assert isinstance(payload, ToolEnvelopeModel)
    # Phase 2: envelope-native handler — ``'saved'`` flag sits in payload.
    assert payload['status'] == 'ok'
    assert payload['payload']['status'] == 'saved'
    saved_config = db.add.call_args.args[0]
    assert str(getattr(saved_config, 'source_session_id', '')) == '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221'
