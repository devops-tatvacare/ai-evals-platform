"""Strict tool-contract enforcement: enum injection + dispatch-boundary validation."""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services.report_builder.tool_handlers import (
    _validate_bounded_arguments,
    dispatch_tool_call,
)


# ── Fixtures ─────────────────────────────────────────────────────────


@pytest.fixture
def fake_app_id():
    return 'kaira-bot'


@pytest.fixture(autouse=True)
def _load_manifests():
    from app.services.chat_engine.manifest import (
        _clear_manifest_cache_for_tests,
        load_all_manifests,
    )
    _clear_manifest_cache_for_tests()
    load_all_manifests()


@pytest.fixture
def patch_vocab_sources():
    """Stub DB-bound semantic-model/app-config loaders so the vocabulary
    layer can be built without a live Postgres session."""
    from app.services.chat_engine.sql_agent import load_semantic_model
    # semantic_model is a pure YAML load keyed by app_id — fine to call.
    real_sm = load_semantic_model('kaira-bot', app_config={})
    with patch(
        'app.services.chat_engine.sql_agent.load_app_config',
        new=AsyncMock(return_value={}),
    ), patch(
        'app.services.chat_engine.sql_agent.load_semantic_model',
        return_value=real_sm,
    ):
        yield


# ── _validate_bounded_arguments ──────────────────────────────────────


@pytest.mark.asyncio
async def test_validator_returns_none_when_no_bounded_args(patch_vocab_sources, fake_app_id):
    db = AsyncMock()
    result = await _validate_bounded_arguments(
        'data_query', {'question': 'hi'}, db=db, app_id=fake_app_id,
    )
    assert result is None


@pytest.mark.asyncio
async def test_validator_rejects_unknown_dimension(patch_vocab_sources, fake_app_id):
    db = AsyncMock()
    result = await _validate_bounded_arguments(
        'lookup', {'dimension': 'not_a_dim'}, db=db, app_id=fake_app_id,
    )
    assert result is not None
    assert result['status'] == 'error'
    assert result['reason'] == 'unknown_dimension'


@pytest.mark.asyncio
async def test_validator_accepts_manifest_synonym_dimension(patch_vocab_sources, fake_app_id):
    """``verdict`` is a declared synonym for ``result_status`` — the
    boundary validator must treat it as a valid dimension, letting the
    handler do the canonical resolution."""
    db = AsyncMock()
    result = await _validate_bounded_arguments(
        'lookup', {'dimension': 'verdict'}, db=db, app_id=fake_app_id,
    )
    assert result is None


@pytest.mark.asyncio
async def test_validator_rejects_unknown_surface_key(patch_vocab_sources, fake_app_id):
    db = AsyncMock()
    result = await _validate_bounded_arguments(
        'get_surface_records', {'surface_key': 'no-such-surface'}, db=db, app_id=fake_app_id,
    )
    assert result is not None
    assert result['reason'] == 'unknown_surface'


@pytest.mark.asyncio
async def test_validator_rejects_entity_type_on_wrong_surface(patch_vocab_sources, fake_app_id):
    """``run_id`` is a valid entity_type on the ``runs`` surface but
    not on every surface. Providing ``surface_key`` scopes the check."""
    db = AsyncMock()
    from app.services.chat_engine.tool_vocabulary import build_tool_vocabulary
    from app.services.chat_engine.sql_agent import load_semantic_model
    sm = load_semantic_model('kaira-bot', app_config={})
    vocab = build_tool_vocabulary('kaira-bot', sm)

    # Find a (surface, entity_type) pair where the entity_type is NOT in the surface's allowed list.
    probe = None
    for surface in vocab.surfaces.values():
        for global_et in sorted(vocab.entity_types):
            if global_et not in surface.entity_types:
                probe = (surface.key, global_et)
                break
        if probe:
            break
    assert probe is not None, 'fixture needs a mismatched (surface, entity_type) pair'

    result = await _validate_bounded_arguments(
        'get_surface_records',
        {'surface_key': probe[0], 'entity_type': probe[1]},
        db=db, app_id=fake_app_id,
    )
    assert result is not None
    assert result['reason'] == 'invalid_entity_type_for_surface'
    assert result['surface_key'] == probe[0]


@pytest.mark.asyncio
async def test_validator_rejects_unknown_entity_type_globally(patch_vocab_sources, fake_app_id):
    db = AsyncMock()
    result = await _validate_bounded_arguments(
        'resolve_entity', {'entity_type': 'bogus'}, db=db, app_id=fake_app_id,
    )
    assert result is not None
    assert result['reason'] == 'unknown_entity_type'


@pytest.mark.asyncio
async def test_validator_rejects_unknown_block_type(patch_vocab_sources, fake_app_id):
    db = AsyncMock()
    result = await _validate_bounded_arguments(
        'blueprint_blocks', {'block_type': 'nope'}, db=db, app_id=fake_app_id,
    )
    assert result is not None
    assert result['reason'] == 'unknown_block_type'


@pytest.mark.asyncio
async def test_validator_accepts_known_block_type(patch_vocab_sources, fake_app_id):
    db = AsyncMock()
    result = await _validate_bounded_arguments(
        'blueprint_blocks', {'block_type': 'summary_cards'}, db=db, app_id=fake_app_id,
    )
    assert result is None


# ── dispatch_tool_call integration ───────────────────────────────────


@pytest.mark.asyncio
async def test_dispatch_short_circuits_on_invalid_bounded_arg(patch_vocab_sources, fake_app_id):
    """dispatch_tool_call must NOT invoke the handler when the boundary
    validator rejects the request. Verifies strict enforcement at the edge."""
    db = AsyncMock()
    auth = SimpleNamespace()

    handler_mock = AsyncMock()
    with patch.dict(
        'app.services.report_builder.tool_handlers.TOOL_HANDLER_MAP',
        {'lookup': handler_mock},
    ), patch(
        'app.services.report_builder.tool_handlers._log_tool_call',
        new=AsyncMock(),
    ):
        raw = await dispatch_tool_call(
            'lookup',
            {'dimension': 'not_a_real_dimension'},
            db=db, auth=auth, app_id=fake_app_id,
        )

    payload = json.loads(raw)
    assert payload['status'] == 'error'
    assert payload['reason'] == 'unknown_dimension'
    handler_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_dispatch_calls_handler_on_valid_bounded_arg(patch_vocab_sources, fake_app_id):
    db = AsyncMock()
    auth = SimpleNamespace()

    handler_mock = AsyncMock(return_value={'status': 'ok', 'values': []})
    with patch.dict(
        'app.services.report_builder.tool_handlers.TOOL_HANDLER_MAP',
        {'lookup': handler_mock},
    ), patch(
        'app.services.report_builder.tool_handlers._log_tool_call',
        new=AsyncMock(),
    ):
        raw = await dispatch_tool_call(
            'lookup',
            {'dimension': 'result_status'},
            db=db, auth=auth, app_id=fake_app_id,
        )

    payload = json.loads(raw)
    assert payload['status'] == 'ok'
    handler_mock.assert_awaited_once()


# ── Enum injection into tool schemas ─────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_tools_injects_vocabulary_enums(fake_app_id):
    from app.services.chat_engine.sql_agent import load_semantic_model
    from app.services.report_builder.chat_handler import _resolve_tools_for_app

    sm = load_semantic_model('kaira-bot', app_config={})

    execute_result = Mock()
    execute_result.scalar_one_or_none.return_value = {
        'displayName': 'Kaira',
        'icon': 'chat',
        'description': 'Kaira test',
    }
    db = AsyncMock()
    db.execute = AsyncMock(return_value=execute_result)

    with patch(
        'app.services.chat_engine.sql_agent.load_semantic_model',
        return_value=sm,
    ):
        tools = await _resolve_tools_for_app(fake_app_id, db)

    by_name = {t['name']: t for t in tools}

    lookup_props = by_name['lookup']['inputSchema']['properties']
    assert 'enum' in lookup_props['dimension']
    # Canonical names present
    assert 'result_status' in lookup_props['dimension']['enum']
    # Synonyms also present so the model can call the tool with a user-facing term
    assert 'verdict' in lookup_props['dimension']['enum']

    resolve_props = by_name['resolve_entity']['inputSchema']['properties']
    assert 'enum' in resolve_props['entity_type']
    # entity_type enum includes both surface-declared types and semantic dimensions
    assert 'run_id' in resolve_props['entity_type']['enum']

    surface_props = by_name['get_surface_records']['inputSchema']['properties']
    assert 'enum' in surface_props['surface_key']

    block_props = by_name['blueprint_blocks']['inputSchema']['properties']
    assert 'enum' in block_props['block_type']
    assert 'summary_cards' in block_props['block_type']['enum']

    # Nested: blueprint_compose.sections[*].type should carry the block_type enum too
    compose_items = by_name['blueprint_compose']['inputSchema']['properties']['sections']['items']
    assert 'enum' in compose_items['properties']['type']
    assert 'summary_cards' in compose_items['properties']['type']['enum']

    # Table enum still injected
    data_check_props = by_name['data_check']['inputSchema']['properties']
    assert 'enum' in data_check_props['table']
