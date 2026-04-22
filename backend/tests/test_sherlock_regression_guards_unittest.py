"""Proof-of-deletion and contract-regression guards for Sherlock.

These tests exist to prevent the hardened contract from quietly eroding.
They fail loudly if anyone re-introduces a legacy route, a deleted tool
alias, a legacy chart field, the removed ``canonicalize_tool_invocation``
function, or the abandoned ``features/reportBuilder/`` module.

Each guard has a single job:
- scope the search to *active* source directories (no tests, no docs)
- match a narrow pattern that only appears in the legacy code path
- include one forward-friendly exception list when needed

Add a new guard whenever a phase deletes or forbids a specific symbol —
don't let the deletion rely on memory.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_APP = REPO_ROOT / 'backend' / 'app'
FRONTEND_SRC = REPO_ROOT / 'src'


def _walk(root: Path, *, suffixes: tuple[str, ...]) -> list[Path]:
    out: list[Path] = []
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        if path.suffix not in suffixes:
            continue
        out.append(path)
    return out


def _grep(pattern: re.Pattern[str], paths: list[Path]) -> list[tuple[Path, int, str]]:
    hits: list[tuple[Path, int, str]] = []
    for path in paths:
        try:
            text = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        for idx, line in enumerate(text.splitlines(), start=1):
            if pattern.search(line):
                hits.append((path, idx, line.strip()))
    return hits


# ── Legacy backend routes ────────────────────────────────────────────


def test_no_legacy_report_builder_routes_in_backend():
    """Phase 2 deleted POST /chat, POST /chat/stream, GET /sessions/{id}
    from the report_builder router. Other routers (e.g. routes/chat.py
    for chat-session storage) are out of scope — the ban is specifically
    on the non-v2 router in routes/report_builder.py."""
    target = BACKEND_APP / 'routes' / 'report_builder.py'
    assert target.exists(), 'report_builder route file missing'
    pattern = re.compile(r"@router\.(get|post)\(")
    hits = _grep(pattern, [target])
    assert not hits, (
        f"Legacy non-v2 decorator reintroduced in report_builder.py:\n{hits}. "
        f"Only @v2_router.* decorators are allowed here."
    )


def test_no_legacy_chat_handler_entry_points():
    """Phase 2 deleted run_chat_turn and run_chat_turn_streaming (the
    generator variant); run_chat_turn_streaming_background is the only
    surviving entry-point."""
    py = _walk(BACKEND_APP, suffixes=('.py',))
    pattern = re.compile(r'\b(async\s+def\s+)?(run_chat_turn|run_chat_turn_streaming)\b(?!_background)')
    hits = _grep(pattern, py)
    assert not hits, f"Legacy chat-handler entry-point reintroduced:\n{hits}"


def test_no_canonicalize_tool_invocation():
    """Phase 2 deleted the alias-rewriting function wholesale."""
    py = _walk(BACKEND_APP, suffixes=('.py',))
    pattern = re.compile(r'\bcanonicalize_tool_invocation\b')
    hits = _grep(pattern, py)
    assert not hits, f"canonicalize_tool_invocation reintroduced:\n{hits}"


# ── Legacy tool aliases ─────────────────────────────────────────────


@pytest.mark.parametrize('alias', [
    'analyze',
    'compose_report',
    'save_template',
    'list_section_types',
    'get_section_detail',
    'list_app_sections',
])
def test_no_legacy_tool_aliases_in_runtime_code(alias):
    """Phase 2 deleted the six model-facing tool aliases. The kept
    handler handle_save_template is used by the non-Sherlock /api/reports
    route — matches on that string are scoped out by path.

    We only check the Sherlock flow directories: report_builder and
    chat_engine services. The prompts/user_context.py file is excluded
    because it runs a backward-compat SQL query that maps HISTORICAL
    agent_tool_logs rows (written before Phase 2) onto their canonical
    names — that read is legitimate and does not forward calls."""
    excluded = {
        BACKEND_APP / 'services' / 'chat_engine' / 'prompts' / 'user_context.py',
    }
    py = [
        path
        for path in (
            _walk(BACKEND_APP / 'services' / 'report_builder', suffixes=('.py',))
            + _walk(BACKEND_APP / 'services' / 'chat_engine', suffixes=('.py',))
        )
        if path not in excluded
    ]
    # Match the alias as a quoted string (how it would appear in tool
    # schemas, TOOL_HANDLER_MAP, or dispatch branches). This excludes
    # handle_save_template function *definition*, which is a bare
    # identifier on the non-Sherlock route.
    pattern = re.compile(rf'["\']\b{re.escape(alias)}\b["\']')
    hits = _grep(pattern, py)
    assert not hits, f"Legacy tool alias {alias!r} reintroduced:\n{hits}"


def test_handle_save_template_still_load_bearing_for_reports_route():
    """Sanity check the counter-example: save_template as a *tool* alias
    is dead, but handle_save_template is still imported by the non-Sherlock
    /api/reports route. If someone deletes the function by mistake, catch it."""
    reports_route = REPO_ROOT / 'backend' / 'app' / 'routes' / 'reports.py'
    assert reports_route.exists(), 'reports route missing'
    assert 'handle_save_template' in reports_route.read_text()


# ── Legacy chart payload shape ──────────────────────────────────────


def test_no_legacy_chart_fields_in_active_backend_code():
    """Phase 2 deleted ChartSpecOut / ChartOut / x_key / y_key / series_keys
    / alternatives. Today these should appear nowhere in active backend code.
    Test fixtures and docs are excluded from scope."""
    py = _walk(BACKEND_APP, suffixes=('.py',))
    pattern = re.compile(r'\b(ChartSpecOut|ChartSeriesItemOut|ChartOut|BuilderChatResponse|BuilderSessionResponse|LegacyBuilderChatRequest)\b')
    hits = _grep(pattern, py)
    assert not hits, f"Legacy chart/response schema reintroduced:\n{hits}"


def test_no_legacy_chart_shape_fields_in_active_frontend_code():
    """ChartSpec / ChartData were fully dropped in the migrate-or-drop
    finish. They must not appear anywhere in active frontend source."""
    ts = _walk(FRONTEND_SRC, suffixes=('.ts', '.tsx'))
    pattern = re.compile(r'\b(ChartSpec|ChartData)\b(?!\w)')
    hits = _grep(pattern, ts)
    assert not hits, f"Legacy chart-payload types reintroduced:\n{hits}"


@pytest.mark.parametrize('tool_name', [
    'query_eval_runs',
    'get_run_summary',
    'compare_runs',
    'query_threads',
    'get_app_stats',
    'get_report_section',
    'get_thread_detail',
    'get_rule_compliance',
    'query_adversarial',
    'get_cross_run_rule_compliance',
])
def test_no_deprecated_sherlock_analytics_tools_in_runtime_code(tool_name):
    """The old Sherlock analytics tools were deleted, not deprecated.
    They must not survive in active runtime code as handler-map keys,
    prompt strings, or summary branches."""
    py = (
        _walk(BACKEND_APP / 'services' / 'report_builder', suffixes=('.py',))
        + _walk(BACKEND_APP / 'services' / 'chat_engine', suffixes=('.py',))
    )
    pattern = re.compile(
        rf'["\']\b{re.escape(tool_name)}\b["\']|\bhandle_{re.escape(tool_name)}\b'
    )
    hits = _grep(pattern, py)
    assert not hits, f"Deprecated Sherlock tool {tool_name!r} reintroduced:\n{hits}"


# ── Dead frontend module ────────────────────────────────────────────


def test_no_references_to_features_reportBuilder():
    """Phase 2 deleted src/features/reportBuilder/ entirely. ComposedReport
    was relocated into chat-widget."""
    ts = _walk(FRONTEND_SRC, suffixes=('.ts', '.tsx'))
    pattern = re.compile(r'features/reportBuilder\b')
    hits = _grep(pattern, ts)
    assert not hits, f"Dead reportBuilder feature referenced:\n{hits}"


def test_reportBuilder_directory_absent():
    assert not (FRONTEND_SRC / 'features' / 'reportBuilder').exists(), \
        'src/features/reportBuilder/ resurrected'


# ── Contract layer invariants ───────────────────────────────────────


def test_every_bounded_param_gets_an_enum_on_real_schemas():
    """Ensures the Phase-4 enum injection still reaches every bounded
    parameter. If a new tool is added with a ``dimension`` / ``entity_type``
    / ``surface_key`` / ``block_type`` param and the injection loop
    doesn't cover it, this test fails."""
    from unittest.mock import AsyncMock, Mock, patch
    import asyncio

    from app.services.chat_engine.manifest import (
        _clear_manifest_cache_for_tests,
        load_all_manifests,
    )
    from app.services.chat_engine.sql_agent import load_semantic_model
    from app.services.report_builder.chat_handler import _resolve_tools_for_app

    _clear_manifest_cache_for_tests()
    load_all_manifests()
    sm = load_semantic_model('kaira-bot', app_config={})

    execute_result = Mock()
    execute_result.scalar_one_or_none.return_value = {
        'displayName': 'Kaira', 'icon': 'chat', 'description': 'kaira test',
    }
    db = AsyncMock()
    db.execute = AsyncMock(return_value=execute_result)

    with patch(
        'app.services.chat_engine.sql_agent.load_semantic_model',
        return_value=sm,
    ):
        tools = asyncio.run(_resolve_tools_for_app('kaira-bot', db))

    bounded = {'dimension', 'entity_type', 'surface_key', 'block_type', 'table'}
    missing: list[str] = []
    for tool in tools:
        props = (tool.get('inputSchema') or {}).get('properties', {}) or {}
        for param_name, schema in props.items():
            if param_name not in bounded:
                continue
            if schema.get('type') != 'string':
                continue
            if 'enum' not in schema:
                missing.append(f"{tool['name']}.{param_name}")
    assert not missing, (
        f"Bounded parameters missing enum injection: {missing!r}. "
        "Every string param named dimension/entity_type/surface_key/"
        "block_type/table must get its enum from _resolve_tools_for_app."
    )


def test_tool_vocabulary_reason_codes_are_stable():
    """The contract-violation reason codes are a public surface — ops
    dashboards and CI alerts grep for them. If a phase renames one,
    this test fails."""
    from app.services.report_builder.analytics.vocabulary import (
        ColumnResolution,
        ColumnTarget,
        DimensionResolution,
        DimensionSpec,
        build_tool_vocabulary,
        column_error_payload,
        dimension_error_payload,
        entity_type_error_payload,
    )
    from app.services.chat_engine.manifest import (
        _clear_manifest_cache_for_tests,
        load_all_manifests,
    )
    from app.services.chat_engine.sql_agent import load_semantic_model

    _clear_manifest_cache_for_tests()
    load_all_manifests()
    sm = load_semantic_model('kaira-bot', app_config={})
    vocab = build_tool_vocabulary('kaira-bot', sm)

    # Unknown / ambiguous dimension
    unknown_dim = dimension_error_payload(
        DimensionResolution(status='unknown', term='x'), vocab,
    )
    assert unknown_dim['reason'] == 'unknown_dimension'

    ambiguous_dim = dimension_error_payload(
        DimensionResolution(
            status='ambiguous',
            term='x',
            candidates=(
                DimensionSpec(name='a', table='t', expression='c'),
                DimensionSpec(name='b', table='t', expression='c'),
            ),
        ),
        vocab,
    )
    assert ambiguous_dim['reason'] == 'ambiguous_dimension'

    # Column error codes
    unknown_col = column_error_payload(
        ColumnResolution(status='unknown', term='x'),
    )
    assert unknown_col['reason'] == 'unknown_column'

    ambiguous_col = column_error_payload(
        ColumnResolution(
            status='ambiguous',
            term='x',
            candidates=(
                ColumnTarget(table='t_a', column='c', role='dimension'),
                ColumnTarget(table='t_b', column='c', role='dimension'),
            ),
        ),
    )
    assert ambiguous_col['reason'] == 'ambiguous_column'

    # Entity-type error codes
    unscoped = entity_type_error_payload('x', vocab)
    assert unscoped['reason'] == 'unknown_entity_type'

    scoped = entity_type_error_payload(
        'x', vocab,
        surface_key=next(iter(vocab.surfaces.keys())),
    )
    assert scoped['reason'] == 'invalid_entity_type_for_surface'


# ── Observability: tool log shape ───────────────────────────────────


def test_agent_tool_log_receives_invalid_argument_status():
    """Phase 5's contract-violation path logs to agent_tool_logs with
    status='invalid_argument'. Test confirms the dispatch wiring stays
    intact so ops dashboards can filter by status."""
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, patch
    import asyncio

    from app.services.chat_engine.sql_agent import load_semantic_model
    from app.services.chat_engine.manifest import (
        _clear_manifest_cache_for_tests,
        load_all_manifests,
    )
    from app.services.report_builder.tool_handlers import dispatch_tool_call

    _clear_manifest_cache_for_tests()
    load_all_manifests()
    sm = load_semantic_model('kaira-bot', app_config={})

    log_capture = AsyncMock()
    handler_mock = AsyncMock()
    db = AsyncMock()
    auth = SimpleNamespace(tenant_id='t', user_id='u')

    with patch(
        'app.services.chat_engine.sql_agent.load_app_config',
        new=AsyncMock(return_value={}),
    ), patch(
        'app.services.chat_engine.sql_agent.load_semantic_model',
        return_value=sm,
    ), patch.dict(
        'app.services.report_builder.tool_handlers.TOOL_HANDLER_MAP',
        {'lookup': handler_mock},
    ), patch(
        'app.services.report_builder.tool_handlers._log_tool_call',
        new=log_capture,
    ):
        asyncio.run(
            dispatch_tool_call(
                'lookup',
                {'dimension': 'never_existed'},
                db=db, auth=auth, app_id='kaira-bot',
            )
        )

    handler_mock.assert_not_awaited()
    log_capture.assert_awaited_once()
    kwargs = log_capture.await_args.kwargs
    assert kwargs.get('status') == 'invalid_argument'
    assert kwargs.get('result', {}).get('reason') == 'unknown_dimension'
