"""Runtime alignment: fail-loud surface filter, deterministic orchestration,
and structured contract-violation logging."""
from __future__ import annotations

import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services.chat_engine.data_surfaces import _apply_entity_filter
from app.services.chat_engine.openai_agents_adapter import build_sherlock_agent
from app.services.report_builder.tool_handlers import dispatch_tool_call


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
            source='api_logs',
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
        source='api_logs',
        entity_field_map={'thread_id': 'thread_id'},
        entity_type='thread_id',
        entity_value=None,
    )
    assert result is query


# ── Deterministic orchestration (tool-choice selection) ─────────────


def test_build_sherlock_agent_uses_forced_tool_when_available():
    tool_defs: list[dict] = []
    agent = build_sherlock_agent(
        instructions='sys',
        tools=tool_defs,
        model='gpt-5',
        client=Mock(),
        force_first_tool_call=True,
        forced_tool_name='discover',
    )
    assert agent.model_settings.tool_choice == 'discover'


def test_build_sherlock_agent_falls_back_to_required_without_forced_name():
    agent = build_sherlock_agent(
        instructions='sys',
        tools=[],
        model='gpt-5',
        client=Mock(),
        force_first_tool_call=True,
        forced_tool_name=None,
    )
    assert agent.model_settings.tool_choice == 'required'


def test_build_sherlock_agent_auto_when_not_forcing():
    """forced_tool_name is ignored when force_first_tool_call is False —
    we never force a tool on a follow-up turn just because the first turn did."""
    agent = build_sherlock_agent(
        instructions='sys',
        tools=[],
        model='gpt-5',
        client=Mock(),
        force_first_tool_call=False,
        forced_tool_name='discover',
    )
    assert agent.model_settings.tool_choice == 'auto'


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
    assert payload['reason'] == 'unknown_dimension'
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
