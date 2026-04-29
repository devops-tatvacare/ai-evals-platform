"""Runtime alignment: fail-loud surface filter, deterministic orchestration,
and structured contract-violation logging."""
from __future__ import annotations

import contextlib
import json
import logging
import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services.chat_engine.data_surfaces import _apply_entity_filter
from app.services.chat_engine.openai_agents_adapter import build_sherlock_agent
from app.services.chat_engine.sql_agent import load_semantic_model
from app.services.report_builder.chat_handler import (
    _execute_chat_turn,
    _question_contract_hints,
)
from app.services.report_builder.scratchpad_state import default_scratchpad
from app.services.report_builder.tool_handlers import dispatch_tool_call
from app.services.sherlock import RecognitionEvent


@pytest.fixture(autouse=True)
def _load_manifests():
    from app.services.chat_engine.manifest import (
        _clear_manifest_cache_for_tests,
        load_all_manifests,
    )
    _clear_manifest_cache_for_tests()
    load_all_manifests()


# ── _apply_entity_filter fail-loud ──────────────────────────────────


def test_apply_entity_filter_raises_for_unmapped_entity_type():
    """Previously this silently returned the unfiltered query — producing
    plausible-but-wrong evidence. Now it must raise so the caller surfaces
    a structured error."""
    query = Mock()
    with pytest.raises(ValueError, match='does not declare a filter column'):
        _apply_entity_filter(
            query,
            source='evaluation_run_api_call_logs',
            entity_field_map={'thread_id': 'thread_id'},
            entity_type='bogus_entity_type',
            entity_value='x',
        )


def test_apply_entity_filter_passes_through_when_value_missing():
    """Both entity_type and entity_value must be set for filtering to
    apply — missing value is a no-op, not an error."""
    query = Mock()
    result = _apply_entity_filter(
        query,
        source='evaluation_run_api_call_logs',
        entity_field_map={'thread_id': 'thread_id'},
        entity_type='thread_id',
        entity_value=None,
    )
    assert result is query


# ── Outer agent orchestration ──────────────────────────────────────
# Phase 5 §691: ``tool_choice`` is ``'auto'`` always. The prior forced-tool
# tests were removed when the coercion paths were deleted.


def test_build_sherlock_agent_tool_choice_is_auto():
    agent = build_sherlock_agent(
        instructions='sys',
        tools=[],
        model='gpt-5',
        client=Mock(),
    )
    assert agent.model_settings.tool_choice == 'auto'


def test_question_contract_hints_map_rule_id_to_canonical_column():
    hints = _question_contract_hints(
        question='Show pass rate grouped by rule_id.',
        app_id='kaira-bot',
        semantic_model=load_semantic_model('kaira-bot'),
    )
    assert hints['needs_discovery'] is False
    assert 'criterion_id' in hints['context']


def test_question_contract_hints_force_discovery_for_unknown_schema_term():
    hints = _question_contract_hints(
        question='Break results down by run_status.',
        app_id='kaira-bot',
        semantic_model=load_semantic_model('kaira-bot'),
    )
    assert hints['needs_discovery'] is True
    assert 'run_status' in hints['context']


def test_question_contract_hints_force_discovery_for_ambiguous_score():
    hints = _question_contract_hints(
        question='Show me the score',
        app_id='kaira-bot',
        semantic_model=load_semantic_model('kaira-bot'),
    )
    assert hints['needs_discovery'] is True
    assert '`score` is ambiguous' in hints['context']


@pytest.mark.asyncio
async def test_execute_chat_turn_emits_terminal_error_when_scope_resolution_fails():
    """M2: the old recognition-fails path covered the entity pre-pass, which is gone.

    Scope/bundle assembly now runs at turn start; if ``resolve_turn_scope_and_bundle``
    raises, the harness must still emit a terminal ``error`` event through the
    same runtime path.
    """
    tenant_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    turn_id = str(uuid.uuid4())
    emit = AsyncMock()
    db = AsyncMock()
    runtime_event = AsyncMock(return_value={'event': 'error', 'data': {'seq': 9}})

    with patch(
        'app.services.report_builder.chat_handler.resolve_turn_scope_and_bundle',
        new=AsyncMock(side_effect=RuntimeError('scope resolution failed')),
    ), patch(
        'app.services.report_builder.chat_handler.save_runtime_state',
        new=AsyncMock(),
    ), patch(
        'app.services.report_builder.chat_handler._emit_runtime_event',
        new=runtime_event,
    ), patch(
        'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
        new=AsyncMock(),
    ), patch(
        'app.services.report_builder.chat_handler.mark_turn_terminal',
        new=AsyncMock(),
    ):
        with pytest.raises(RuntimeError, match='scope resolution failed'):
            await _execute_chat_turn(
                {
                    'chat_session_id': 'session-1',
                    'app_id': 'kaira-bot',
                    'tenant_id': tenant_id,
                    'user_id': user_id,
                    'messages': [],
                    'scratchpad': {},
                },
                'Show me the score',
                provider='openai',
                model='gpt-4.1-mini',
                db=db,
                auth=SimpleNamespace(),
                emit=emit,
                turn=SimpleNamespace(id=turn_id),
                entity_recognition=None,
            )

    assert runtime_event.await_args.args[1] == 'error'


@pytest.mark.asyncio
async def test_execute_chat_turn_two_turn_reproducer_persists_final_pie_outcome():
    """Phase-2 reproducer at the real turn layer.

    Turn 1 asks ``count runs per status`` and lands a bar-chart artifact.
    Turn 2 asks ``show as pie`` and the outer loop makes two ``data_query``
    calls in the same turn: first the repeated count phrasing (bar), then a
    percent-of-total phrasing (pie). The persisted runtime events, assistant
    metadata, and live chart projection must all reflect the final pie result.
    """
    from app.services.chat_engine.openai_agents_adapter import _sherlock_tool_handler
    from app.services.sherlock import ScopeContext, ScopedBundle
    from app.services.sherlock.turn_assembly import TurnAssembly

    tenant_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    auth = SimpleNamespace(tenant_id=tenant_id, user_id=user_id)
    db = AsyncMock()
    emit = AsyncMock()
    session = {
        'chat_session_id': 'session-1',
        'app_id': 'kaira-bot',
        'tenant_id': tenant_id,
        'user_id': user_id,
        'messages': [],
        'scratchpad': default_scratchpad(),
    }

    bar_envelope = json.dumps({
        'status': 'ok',
        'summary': '4 rows',
        'outcome': {
            'kind': 'artifact',
            'capability': 'analytics',
            'reason_code': None,
            'warnings': [],
            'counts': {'rows': 4, 'records': 0, 'affected': 0},
            'artifact': {
                'type': 'chart',
                'contract': 'analytics.chart.v1',
                'extras': {'rendered_as': 'bar', 'top_n': None},
            },
        },
        'payload': {
            'row_count': 4,
            'data': [
                {'status': 'completed', 'n': 120},
                {'status': 'failed', 'n': 7},
                {'status': 'cancelled', 'n': 3},
                {'status': 'running', 'n': 1},
            ],
            'chart': {
                'kind': 'chart',
                'spec': {'mark': 'bar'},
                'title': 'Count runs per status',
                'data': [],
            },
        },
    })
    pie_envelope = json.dumps({
        'status': 'ok',
        'summary': '4 rows',
        'outcome': {
            'kind': 'artifact',
            'capability': 'analytics',
            'reason_code': None,
            'warnings': [],
            'counts': {'rows': 4, 'records': 0, 'affected': 0},
            'artifact': {
                'type': 'chart',
                'contract': 'analytics.chart.v1',
                'extras': {'rendered_as': 'pie', 'top_n': None},
            },
        },
        'payload': {
            'row_count': 4,
            'data': [
                {'status': 'completed', 'pct': 91.6},
                {'status': 'failed', 'pct': 5.3},
                {'status': 'cancelled', 'pct': 2.3},
                {'status': 'running', 'pct': 0.8},
            ],
            'chart': {
                'kind': 'chart',
                'spec': {'mark': 'pie'},
                'title': 'Runs per status (%)',
                'data': [],
            },
        },
    })

    runtime_events: list[tuple[str, dict]] = []
    finalized_metadata: list[dict] = []
    previous_response_ids: list[str | None] = []
    assistant_ids = iter(['assistant-1', 'assistant-2'])

    class _SessionCtx:
        def __init__(self, session_db):
            self._session_db = session_db

        async def __aenter__(self):
            return self._session_db

        async def __aexit__(self, exc_type, exc, tb):
            return False

    async def fake_emit_runtime_event(runtime_session, event_type, payload, emit_fn, _db):
        seq = len(runtime_events) + 1
        event = {'event': event_type, 'data': {'seq': seq, **payload}}
        runtime_events.append((event_type, event['data']))
        if emit_fn is not None:
            await emit_fn(event)
        return event

    async def fake_finalize_assistant_message(*, metadata, **_kwargs):
        finalized_metadata.append(metadata)

    async def fake_dispatch_tool_call(tool_name, arguments, **_kwargs):
        assert tool_name == 'data_query'
        question = arguments['question']
        if question == 'count runs per status':
            return bar_envelope
        if question == 'show runs per status as percent of total':
            return pie_envelope
        raise AssertionError(f'unexpected tool question: {question!r}')

    async def fake_run_sherlock_sdk_turn(
        *,
        user_message,
        sherlock_context,
        previous_response_id=None,
        **_kwargs,
    ):
        previous_response_ids.append(previous_response_id)
        buffered_events: list[dict] = []

        async def capture(event: dict[str, Any]) -> None:
            buffered_events.append(event)

        sherlock_context.emit = capture

        if user_message == 'count runs per status':
            tool_questions = ['count runs per status']
            final_output = 'Counts by status ready.'
            next_response_id = 'resp-turn-1'
        else:
            outcomes = sherlock_context.working_session['scratchpad']['outcomes']
            assert any(
                entry.get('tool') == 'data_query' and entry.get('artifact_type') == 'chart'
                for entry in outcomes
            )
            tool_questions = [
                'count runs per status',
                'show runs per status as percent of total',
            ]
            final_output = 'Here it is as a pie chart.'
            next_response_id = 'resp-turn-2'

        for index, question in enumerate(tool_questions, start=1):
            await _sherlock_tool_handler(
                SimpleNamespace(
                    context=sherlock_context,
                    tool_name='data_query',
                    tool_call_id=f'{user_message}-tc-{index}',
                ),
                json.dumps({'question': question}),
            )
            while buffered_events:
                yield buffered_events.pop(0)

        yield {
            'event': '_internal_turn_complete',
            'data': {
                'last_response_id': next_response_id,
                'final_output': final_output,
            },
        }

    fake_scope = ScopeContext(
        tenant_id=uuid.UUID(tenant_id),
        user_id=uuid.UUID(user_id),
        allowed_app_ids=('kaira-bot',),
        requested_app_ids=('kaira-bot',),
        effective_app_id='kaira-bot',
        effective_pack_ids=('analytics', 'report_builder'),
    )
    fake_bundle = ScopedBundle(
        scope=fake_scope,
        ontology_classes=(),
        entity_types=(),
        resolvers=(),
        pack_projections=(),
        tool_specs=(),
        tool_schema_enums={},
        question_hints='',
        cache_key=(str(fake_scope.tenant_id), 'kaira-bot', 0, frozenset()),
        ontology_version=0,
    )

    with contextlib.ExitStack() as stack:
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.resolve_turn_scope_and_bundle',
            new=AsyncMock(return_value=TurnAssembly(scope=fake_scope, bundle=fake_bundle)),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler._build_tools_from_bundle',
            return_value=[],
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.load_app_config',
            new=AsyncMock(return_value={}),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler._question_contract_hints',
            return_value={'context': '', 'needs_discovery': False},
        ))
        stack.enter_context(patch(
            'app.services.evaluators.settings_helper.get_llm_settings_from_db',
            new=AsyncMock(return_value={'api_key': 'test-key'}),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.create_openai_client',
            return_value=Mock(),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(return_value='You are Sherlock.'),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.record_user_message',
            new=AsyncMock(),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.create_assistant_message',
            new=AsyncMock(side_effect=lambda **_kwargs: next(assistant_ids)),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.mark_turn_active',
            new=AsyncMock(),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=AsyncMock(),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.update_last_response_id',
            new=AsyncMock(),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.touch_sherlock_chat_session',
            new=AsyncMock(),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.mark_turn_terminal',
            new=AsyncMock(),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.aggregate_turn_usage',
            new=AsyncMock(return_value=None),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.finalize_assistant_message',
            new=AsyncMock(side_effect=fake_finalize_assistant_message),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler._emit_runtime_event',
            new=AsyncMock(side_effect=fake_emit_runtime_event),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.run_sherlock_sdk_turn',
            new=fake_run_sherlock_sdk_turn,
        ))
        stack.enter_context(patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=AsyncMock(side_effect=fake_dispatch_tool_call),
        ))
        stack.enter_context(patch(
            'app.database.async_session',
            return_value=_SessionCtx(AsyncMock()),
        ))
        await _execute_chat_turn(
            session,
            'count runs per status',
            provider='openai',
            model='gpt-4.1-mini',
            db=db,
            auth=auth,
            emit=emit,
            turn=SimpleNamespace(id=str(uuid.uuid4())),
            entity_recognition=None,
        )
        first_turn_event_count = len(runtime_events)

        await _execute_chat_turn(
            session,
            'show as pie',
            provider='openai',
            model='gpt-4.1-mini',
            db=db,
            auth=auth,
            emit=emit,
            turn=SimpleNamespace(id=str(uuid.uuid4())),
            entity_recognition=None,
        )

    assert previous_response_ids == [None, 'resp-turn-1']

    second_turn_events = runtime_events[first_turn_event_count:]
    second_turn_tool_ends = [
        data for event_type, data in second_turn_events
        if event_type == 'tool_call_end'
    ]
    assert len(second_turn_tool_ends) == 2
    assert [
        event['outcome']['artifact']['extras']['rendered_as']
        for event in second_turn_tool_ends
    ] == ['bar', 'pie']

    second_turn_chart = next(
        data for event_type, data in second_turn_events
        if event_type == 'chart'
    )
    assert second_turn_chart['spec']['mark'] == 'pie'

    second_turn_metadata = finalized_metadata[-1]
    assert [
        item['outcome']['artifact']['extras']['rendered_as']
        for item in second_turn_metadata['toolCalls']
    ] == ['bar', 'pie']
    assert second_turn_metadata['artifacts'][-1]['payload']['spec']['mark'] == 'pie'


# ── Contract-violation logging ───────────────────────────────────────


@pytest.fixture
def patch_vocab_sources():
    from app.services.chat_engine.sql_agent import load_semantic_model
    real_sm = load_semantic_model('kaira-bot', app_config={})
    with patch(
        'app.services.chat_engine.sql_agent.load_app_config',
        new=AsyncMock(return_value={}),
    ), patch(
        'app.services.chat_engine.sql_agent.load_semantic_model',
        return_value=real_sm,
    ):
        yield


@pytest.mark.asyncio
async def test_dispatch_emits_structured_contract_violation_log(
    patch_vocab_sources, caplog,
):
    db = AsyncMock()
    auth = SimpleNamespace(tenant_id='tenant-123')
    handler_mock = AsyncMock()

    with patch.dict(
        'app.services.report_builder.tool_handlers.TOOL_HANDLER_MAP',
        {'lookup': handler_mock},
    ), patch(
        'app.services.report_builder.tool_handlers._log_tool_call',
        new=AsyncMock(),
    ), caplog.at_level(logging.WARNING, logger='app.services.report_builder.tool_handlers'):
        raw = await dispatch_tool_call(
            'lookup',
            {'dimension': 'totally_not_a_dimension'},
            db=db, auth=auth, app_id='kaira-bot',
        )

    payload = json.loads(raw)
    # Phase 2: the dispatcher now wraps boundary errors in the §6.2
    # envelope. The legacy ``reason`` field moves to
    # ``outcome.reason_code``; ``unknown_dimension`` maps to the
    # pack-registered ``ENTITY_NOT_FOUND`` code.
    assert payload['status'] == 'error'
    assert payload['outcome']['reason_code'] == 'ENTITY_NOT_FOUND'
    handler_mock.assert_not_awaited()

    # Structured log must carry the reason code, tool name, and tenant id
    # so the field is auditable without parsing the error string.
    records = [
        r for r in caplog.records
        if getattr(r, 'event', None) == 'sherlock_contract_violation'
    ]
    assert len(records) == 1, 'expected exactly one contract-violation log record'
    record = records[0]
    assert record.tool_name == 'lookup'
    assert record.reason == 'unknown_dimension'
    assert record.app_id == 'kaira-bot'
    assert record.tenant_id == 'tenant-123'


@pytest.mark.asyncio
async def test_dispatch_does_not_log_violation_for_valid_arguments(
    patch_vocab_sources, caplog,
):
    db = AsyncMock()
    auth = SimpleNamespace(tenant_id='tenant-123')
    handler_mock = AsyncMock(return_value={'status': 'ok', 'values': []})

    with patch.dict(
        'app.services.report_builder.tool_handlers.TOOL_HANDLER_MAP',
        {'lookup': handler_mock},
    ), patch(
        'app.services.report_builder.tool_handlers._log_tool_call',
        new=AsyncMock(),
    ), caplog.at_level(logging.WARNING, logger='app.services.report_builder.tool_handlers'):
        await dispatch_tool_call(
            'lookup',
            {'dimension': 'result_status'},
            db=db, auth=auth, app_id='kaira-bot',
        )

    violations = [
        r for r in caplog.records
        if getattr(r, 'event', None) == 'sherlock_contract_violation'
    ]
    assert violations == []
