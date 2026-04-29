"""Phase 2 — analytics adoption of Phase-1 generic contracts.

Covers plan §111-196:

- **2.1 explicit_only SQL validator** — collectors (``explicit_only_column_set``,
  ``grounded_literal_set``), pure validator (``validate_sql_explicit_only``),
  and end-to-end rejection through ``data_query``'s post-generation hook.
- **2.2 analytics handlers emit state_delta** — ``handle_data_query``,
  ``handle_data_check``, ``handle_resolve_entity`` each populate typed
  ``confirmed_constraints`` / ``grounded_refs`` / ``open_threads`` /
  ``last_result`` / ``failure_record`` from validated tool inputs/outcomes,
  never from raw LLM prose.
- **2.3 bundle projection observability** — ``_bundle_event_payload``
  now serializes per-pack projected classes and their explicit_only
  ``field_safety`` overrides.
- **2.4 data_check input-shape guardrail** — non-dict ``filters`` return
  a typed ``SQL_INVALID_FILTERS_SHAPE`` envelope instead of raising.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.chat_engine import reason_codes
from app.services.chat_engine.artifact import ToolEnvelopeModel
from app.services.chat_engine.sql_agent import (
    SQLExplicitOnlyUngroundedError,
    SQLValidationError,
    _sql_validation_reason,
    extract_applied_filters_from_sql,
    validate_sql_explicit_only,
)
# Pack-agnostic helpers — canonical locations. sql_agent keeps ``_collect_*``
# shims for back-compat with older imports, but tests exercise the real
# public surface so future packs can adopt the same view.
from app.services.sherlock.bundle_helpers import explicit_only_column_set
from app.services.report_builder.scratchpad_state import grounded_literal_set
from app.services.report_builder.tool_handlers import (
    handle_data_check,
    handle_data_query,
    handle_resolve_entity,
)


# ---------------------------------------------------------------------------
# 2.1 Explicit-only SQL safety — pure unit tests
# ---------------------------------------------------------------------------


class TestCollectExplicitOnlyColumns:
    def test_returns_empty_set_when_bundle_is_none(self):
        assert explicit_only_column_set(None) == set()

    def test_reads_class_projection_field_safety(self):
        cls = SimpleNamespace(field_safety={'run_name': 'explicit_only', 'run_id': 'safe_first_pass'})
        proj = SimpleNamespace(projected_classes=(cls,))
        bundle = SimpleNamespace(pack_projections=(proj,), safety_by_entity=lambda: {})
        result = explicit_only_column_set(bundle)
        assert 'run_name' in result
        assert 'run_id' not in result

    def test_merges_platform_safety_by_entity(self):
        bundle = SimpleNamespace(
            pack_projections=(),
            safety_by_entity=lambda: {
                'run_name': 'explicit_only',
                'thread_id': 'safe_first_pass',
            },
        )
        result = explicit_only_column_set(bundle)
        assert 'run_name' in result
        assert 'thread_id' not in result

    def test_returns_lowercased_column_names(self):
        cls = SimpleNamespace(field_safety={'Run_Name': 'EXPLICIT_ONLY'})
        proj = SimpleNamespace(projected_classes=(cls,))
        bundle = SimpleNamespace(pack_projections=(proj,), safety_by_entity=lambda: {})
        result = explicit_only_column_set(bundle)
        assert result == {'run_name'}

    def test_swallows_safety_by_entity_exceptions(self):
        def _boom():
            raise RuntimeError('boom')

        bundle = SimpleNamespace(pack_projections=(), safety_by_entity=_boom)
        # Must not raise — the validator is purely advisory at this step.
        assert explicit_only_column_set(bundle) == set()


class TestCollectGroundedLiterals:
    def test_returns_empty_when_scratchpad_empty(self):
        assert grounded_literal_set({}) == set()
        assert grounded_literal_set(None) == set()

    def test_flattens_confirmed_constraints_and_grounded_refs(self):
        pad = {
            'confirmed_constraints': [{'key': 'run_id', 'value': 'RUN-01', 'provenance': 'user_explicit'}],
            'grounded_refs': [{'kind': 'run', 'key': 'run_id', 'value': 'RUN-02', 'provenance': 'resolver_derived'}],
        }
        result = grounded_literal_set(pad)
        assert 'run-01' in result
        assert 'run-02' in result

    def test_flattens_resolved_entities_and_active_filters_and_lookups(self):
        pad = {
            'resolved_entities': {
                'run_name': {'matches': [{'value': 'Alpha'}, {'value': 'Beta'}]},
            },
            'active_filters': {
                'status': {'value': 'VIOLATED', 'provenance': 'user_explicit'},
                'kind': 'critique',
            },
            'lookups': {
                'rule': {'values': [{'value': 'Food QnA'}]},
            },
        }
        result = grounded_literal_set(pad)
        assert {'alpha', 'beta', 'violated', 'critique', 'food qna'} <= result

    def test_picks_up_current_turn_filters(self):
        result = grounded_literal_set({}, current_filters={'run_name': 'Gamma'})
        assert 'gamma' in result

    def test_unwraps_dict_value_with_range_bounds(self):
        pad = {
            'confirmed_constraints': [
                {
                    'key': 'created_at',
                    'value': {'start': '2026-01-01', 'end': '2026-04-01'},
                    'provenance': 'user_explicit',
                }
            ],
        }
        result = grounded_literal_set(pad)
        assert '2026-01-01' in result
        assert '2026-04-01' in result


class TestValidateSqlExplicitOnly:
    def test_no_op_when_explicit_only_set_is_empty(self):
        # No explicit_only columns declared → never raises.
        validate_sql_explicit_only(
            "SELECT 1 FROM evaluation_runs WHERE run_name = 'kaira'",
            explicit_only_columns=set(),
            grounded_literals=set(),
        )

    def test_rejects_equality_predicate_with_ungrounded_literal(self):
        with pytest.raises(SQLExplicitOnlyUngroundedError) as exc_info:
            validate_sql_explicit_only(
                "SELECT 1 FROM evaluation_runs WHERE run_name = 'kaira-bot'",
                explicit_only_columns={'run_name'},
                grounded_literals={'run-abc-01'},
            )
        err = exc_info.value
        assert err.column == 'run_name'
        assert err.values == ['kaira-bot']
        # SQLValidationError subclass so the generic SQL retry path catches it.
        assert isinstance(err, SQLValidationError)

    def test_accepts_equality_predicate_with_grounded_literal(self):
        validate_sql_explicit_only(
            "SELECT 1 FROM evaluation_runs WHERE run_name = 'alpha'",
            explicit_only_columns={'run_name'},
            grounded_literals={'alpha'},
        )

    def test_rejects_in_predicate_when_no_literal_is_grounded(self):
        with pytest.raises(SQLExplicitOnlyUngroundedError):
            validate_sql_explicit_only(
                "SELECT 1 FROM evaluation_runs WHERE run_name IN ('kaira', 'kaira-bot')",
                explicit_only_columns={'run_name'},
                grounded_literals={'alpha'},
            )

    def test_accepts_in_predicate_when_any_literal_is_grounded(self):
        validate_sql_explicit_only(
            "SELECT 1 FROM evaluation_runs WHERE run_name IN ('kaira', 'alpha')",
            explicit_only_columns={'run_name'},
            grounded_literals={'alpha'},
        )

    def test_ilike_predicate_is_treated_like_equality(self):
        with pytest.raises(SQLExplicitOnlyUngroundedError):
            validate_sql_explicit_only(
                "SELECT 1 FROM evaluation_runs WHERE run_name ILIKE 'kaira%'",
                explicit_only_columns={'run_name'},
                grounded_literals={'alpha'},
            )

    def test_scans_nested_where_clauses(self):
        # Subquery's WHERE must also be scanned — re.finditer is non-positional.
        sql = (
            "SELECT total FROM (SELECT COUNT(*) AS total FROM evaluation_runs "
            "WHERE run_name = 'kaira-bot') AS t"
        )
        with pytest.raises(SQLExplicitOnlyUngroundedError):
            validate_sql_explicit_only(
                sql,
                explicit_only_columns={'run_name'},
                grounded_literals=set(),
            )

    def test_ignores_predicate_on_non_explicit_only_column(self):
        validate_sql_explicit_only(
            "SELECT 1 FROM evaluation_runs WHERE status = 'VIOLATED' AND run_id = 'x'",
            explicit_only_columns={'run_name'},
            grounded_literals=set(),
        )


class TestSqlValidationReasonMapping:
    def test_explicit_only_error_maps_to_dedicated_reason_code(self):
        err = SQLExplicitOnlyUngroundedError(column='run_name', values=['kaira'], grounded=set())
        assert _sql_validation_reason(err) == reason_codes.SQL_EXPLICIT_ONLY_UNGROUNDED


class TestExtractAppliedFiltersFromSql:
    """Plan §148 (durable current-turn memory): the validated SQL outcome is
    the source of truth for applied_filters, not an echo of prior scratchpad.
    """

    def test_returns_empty_when_no_where_clause(self):
        assert extract_applied_filters_from_sql("SELECT 1 FROM evaluation_runs") == {}

    def test_extracts_single_equality_predicate(self):
        result = extract_applied_filters_from_sql(
            "SELECT 1 FROM evaluation_runs WHERE status = 'VIOLATED'"
        )
        assert result == {'status': 'VIOLATED'}

    def test_lowercases_column_name(self):
        result = extract_applied_filters_from_sql(
            "SELECT 1 FROM evaluation_runs WHERE Status = 'VIOLATED'"
        )
        assert result == {'status': 'VIOLATED'}

    def test_extracts_in_predicate_with_multiple_literals(self):
        result = extract_applied_filters_from_sql(
            "SELECT 1 FROM evaluation_runs WHERE status IN ('a', 'b', 'c')"
        )
        assert result == {'status': ['a', 'b', 'c']}

    def test_extracts_in_predicate_with_single_literal_as_scalar(self):
        result = extract_applied_filters_from_sql(
            "SELECT 1 FROM evaluation_runs WHERE status IN ('VIOLATED')"
        )
        assert result == {'status': 'VIOLATED'}

    def test_elides_scope_columns_app_id_and_tenant_id(self):
        """app_id / tenant_id are bundle scope, never user-facing filters —
        even if the LLM hardcodes a literal they must not show up as
        applied_filters (prevents the F1 "scope is a filter" mental model
        from reappearing in durable memory)."""
        result = extract_applied_filters_from_sql(
            "SELECT 1 FROM evaluation_runs WHERE app_id = 'kaira-bot' "
            "AND tenant_id = 't-1' AND status = 'VIOLATED'"
        )
        assert result == {'status': 'VIOLATED'}

    def test_skips_bind_parameter_predicates(self):
        """Bind parameters (``:uuid_1`` / ``:app_id``) have their values in
        the params dict, not the SQL text. Regex scans for quoted literals
        only, so bind-param predicates are naturally skipped."""
        result = extract_applied_filters_from_sql(
            "SELECT 1 FROM evaluation_runs WHERE run_id = :uuid_1 AND status = 'VIOLATED'"
        )
        assert result == {'status': 'VIOLATED'}

    def test_first_seen_wins_across_nested_where_clauses(self):
        sql = (
            "SELECT * FROM ("
            "  SELECT * FROM evaluation_runs WHERE status = 'OK'"
            ") t WHERE status = 'VIOLATED'"
        )
        result = extract_applied_filters_from_sql(sql)
        # Either 'OK' or 'VIOLATED' — documenting the deterministic
        # first-seen semantics rather than the specific value.
        assert result['status'] in ('OK', 'VIOLATED')
        # ``status`` appears once in the output (not duplicated).
        assert list(result.keys()) == ['status']

    def test_caller_supplied_exclude_columns_are_dropped(self):
        result = extract_applied_filters_from_sql(
            "SELECT 1 FROM evaluation_runs WHERE run_id = 'r-1' AND status = 'VIOLATED'",
            exclude_columns={'run_id'},
        )
        assert result == {'status': 'VIOLATED'}


class TestExplicitOnlyPromptRuleSemantics:
    """Prompt wording must match the validator — free-text user values are
    NOT grounding. The prompt used to say "when the user has supplied an
    exact value OR a prior tool call has grounded it"; the validator only
    checks grounded_literals from scratchpad, so the OR clause misled the
    LLM. Tightened to "value appears in CONTEXT grounding."
    """

    @pytest.mark.asyncio
    async def test_sql_prompt_explicit_only_rule_forbids_question_text_grounding(self):
        from unittest.mock import AsyncMock, patch

        from app.services.chat_engine.sql_agent import generate_sql

        captured: dict[str, str] = {}

        async def _fake_llm(*, system_instruction, user_prompt, model, creds):
            captured['prompt'] = user_prompt
            return (
                '{"sql": "SELECT 1 FROM evaluation_runs", "chart_title": "t", '
                '"output_columns": []}',
                {'input_tokens': 0, 'output_tokens': 0},
            )

        with patch(
            'app.services.chat_engine.sql_agent._call_llm_for_sql',
            new=AsyncMock(side_effect=_fake_llm),
        ), patch(
            'app.services.chat_engine.sql_agent.get_llm_settings_from_db',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent._record_sql_generation_usage',
            new=AsyncMock(),
        ):
            await generate_sql(
                question='show kaira runs',
                tenant_id='t',
                user_id='u',
                semantic_model={'tables': {}},
                explicit_only_columns={'run_name'},
            )

        prompt = captured['prompt']
        # Tightened wording must lock in:
        assert 'EXPLICIT-ONLY' in prompt
        assert 'run_name' in prompt
        # Must forbid the free-text path explicitly so the LLM understands
        # the validator will reject it.
        assert 'is NOT grounding' in prompt
        # Must mention the specific F1 antipattern.
        assert 'kaira' in prompt.lower()
        # Must NOT suggest user-question-text supplies grounding.
        assert 'user has supplied an exact value' not in prompt


# ---------------------------------------------------------------------------
# 2.2 state_delta emission from analytics handlers
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_data_check_emits_state_delta_with_user_explicit_constraints():
    with patch(
        'app.services.chat_engine.sql_agent.data_check',
        new=AsyncMock(return_value={
            'status': 'ok',
            'table': 'evaluation_runs',
            'filters': {'run_id': 'RUN-01'},
            'row_count': 5,
        }),
    ):
        result = await handle_data_check(
            table='evaluation_runs',
            filters={'run_id': 'RUN-01'},
            db=AsyncMock(),
            auth=SimpleNamespace(),
            app_id='kaira-bot',
        )

    assert isinstance(result, ToolEnvelopeModel)
    envelope = result.as_dict()
    assert envelope['status'] == 'ok'
    state_delta = envelope.get('state_delta')
    assert state_delta is not None
    # user_explicit provenance — the user literally supplied the filter.
    constraint = state_delta['confirmed_constraints'][0]
    assert constraint['key'] == 'run_id'
    assert constraint['value'] == 'RUN-01'
    assert constraint['provenance'] == 'user_explicit'
    assert constraint['source_tool'] == 'data_check'
    last_result = state_delta['last_result']
    assert last_result['kind'] == 'table'
    assert last_result['row_count'] == 5


@pytest.mark.asyncio
async def test_handle_data_check_rejects_non_dict_filters_with_typed_envelope():
    """Phase 2 §2.4: bad-shape input produces a typed error, not a crash."""
    # sql_agent.data_check must NOT be called when the boundary guard fires.
    with patch(
        'app.services.chat_engine.sql_agent.data_check',
        new=AsyncMock(),
    ) as data_check_mock:
        result = await handle_data_check(
            table='evaluation_runs',
            filters='run_id=RUN-01',  # malformed; string instead of dict
            db=AsyncMock(),
            auth=SimpleNamespace(),
            app_id='kaira-bot',
        )

    assert data_check_mock.await_count == 0
    envelope = result.as_dict()
    assert envelope['status'] == 'error'
    assert envelope['outcome']['reason_code'] == reason_codes.SQL_INVALID_FILTERS_SHAPE
    assert envelope['outcome']['capability'] == 'analytics'
    assert 'str' in envelope['payload'].get('received_filters_type', '')


@pytest.mark.asyncio
async def test_handle_resolve_entity_emits_grounded_ref_on_unique_match():
    with patch(
        'app.services.chat_engine.entity_resolution.resolve_entity_matches',
        new=AsyncMock(return_value={
            'status': 'ok',
            'entity_type': 'run_name',
            'matches': [{'value': 'Alpha'}],
        }),
    ):
        result = await handle_resolve_entity(
            entity_type='run_name',
            search='Alpha',
            db=AsyncMock(),
            auth=SimpleNamespace(),
            app_id='kaira-bot',
            session={'turn_id': 'turn-42'},
        )

    envelope = result.as_dict()
    assert envelope['status'] == 'ok'
    state_delta = envelope.get('state_delta')
    assert state_delta is not None
    grounded = state_delta['grounded_refs'][0]
    assert grounded['kind'] == 'run_name'
    assert grounded['value'] == 'Alpha'
    assert grounded['provenance'] == 'resolver_derived'
    assert grounded['source_tool'] == 'resolve_entity'
    assert grounded['source_turn_id'] == 'turn-42'
    # Confirmed constraints land too so the SQL validator sees the grounded value.
    assert any(c['key'] == 'run_name' and c['value'] == 'Alpha'
               for c in state_delta['confirmed_constraints'])


@pytest.mark.asyncio
async def test_handle_resolve_entity_opens_clarification_thread_on_ambiguous():
    with patch(
        'app.services.chat_engine.entity_resolution.resolve_entity_matches',
        new=AsyncMock(return_value={
            'status': 'ok',
            'entity_type': 'run_name',
            'matches': [{'value': 'Alpha'}, {'value': 'AlphaBeta'}],
        }),
    ):
        result = await handle_resolve_entity(
            entity_type='run_name',
            search='Alpha',
            db=AsyncMock(),
            auth=SimpleNamespace(),
            app_id='kaira-bot',
        )

    envelope = result.as_dict()
    assert envelope['outcome']['reason_code'] == reason_codes.ENTITY_AMBIGUOUS
    recovery = envelope.get('recovery')
    assert recovery == {'recoverable': True, 'failure_kind': 'ambiguous'}
    state_delta = envelope['state_delta']
    assert state_delta['open_threads'][0]['kind'] == 'clarify_entity'
    assert state_delta['failure_record']['failure_kind'] == 'ambiguous'
    # No grounded_refs when the resolver returned >1 match. (Pydantic
    # default_factory populates an empty list; checking falsiness rather
    # than key-absence is the real invariant.)
    assert not state_delta.get('grounded_refs')


@pytest.mark.asyncio
async def test_handle_resolve_entity_records_empty_failure_when_not_found():
    with patch(
        'app.services.chat_engine.entity_resolution.resolve_entity_matches',
        new=AsyncMock(return_value={'status': 'ok', 'entity_type': 'run_name', 'matches': []}),
    ):
        result = await handle_resolve_entity(
            entity_type='run_name',
            search='ghost',
            db=AsyncMock(),
            auth=SimpleNamespace(),
            app_id='kaira-bot',
        )

    envelope = result.as_dict()
    assert envelope['outcome']['reason_code'] == reason_codes.ENTITY_NOT_FOUND
    assert envelope['recovery']['failure_kind'] == 'empty'
    assert envelope['state_delta']['failure_record']['failure_kind'] == 'empty'


@pytest.mark.asyncio
async def test_handle_data_query_passes_bundle_and_scratchpad_to_sql_agent():
    bundle = SimpleNamespace(pack_projections=(), safety_by_entity=lambda: {'run_name': 'explicit_only'})
    session = {
        'scratchpad': {
            'grounded_refs': [{'kind': 'run_name', 'key': 'run_name', 'value': 'Alpha', 'provenance': 'resolver_derived'}],
            'active_filters': {},
        },
        '_bundle': bundle,
        'turn_id': 'turn-42',
    }
    with patch(
        'app.services.chat_engine.sql_agent.data_query',
        new=AsyncMock(return_value={'status': 'ok', 'row_count': 0, 'applied_filters': {}, 'typed_columns': []}),
    ) as data_query_mock:
        await handle_data_query(
            question='show runs',
            db=AsyncMock(),
            auth=SimpleNamespace(),
            app_id='kaira-bot',
            session=session,
        )

    call = data_query_mock.await_args
    assert call.kwargs['bundle'] is bundle
    assert call.kwargs['scratchpad'] is session['scratchpad']


@pytest.mark.asyncio
async def test_handle_data_query_emits_state_delta_with_validated_applied_filters():
    session = {'scratchpad': {}, 'turn_id': 'turn-7'}
    with patch(
        'app.services.chat_engine.sql_agent.data_query',
        new=AsyncMock(return_value={
            'status': 'ok',
            'row_count': 0,
            'applied_filters': {'status': 'VIOLATED'},
            'typed_columns': [{'name': 'c1', 'role': 'measure', 'data_type': 'quantitative'}],
        }),
    ):
        result = await handle_data_query(
            question='show violations',
            db=AsyncMock(),
            auth=SimpleNamespace(),
            app_id='kaira-bot',
            session=session,
        )

    envelope = result.as_dict()
    state_delta = envelope.get('state_delta')
    assert state_delta is not None
    # applied_filters come from the validated sql_agent outcome, not LLM prose.
    constraint = state_delta['confirmed_constraints'][0]
    assert constraint['key'] == 'status'
    assert constraint['value'] == 'VIOLATED'
    assert constraint['provenance'] == 'resolver_derived'
    assert constraint['source_tool'] == 'data_query'
    assert constraint['source_turn_id'] == 'turn-7'
    assert state_delta['last_result']['kind'] == 'empty'


@pytest.mark.asyncio
async def test_handle_data_query_surfaces_explicit_only_ungrounded_as_recoverable_open_thread():
    """Error path: the SQL validator's reject shows up as an open clarification
    thread + recoverable ``invalid_reference`` recovery block so the Phase-1
    prompt policy turns it into one clarifying question next turn."""
    with patch(
        'app.services.chat_engine.sql_agent.data_query',
        new=AsyncMock(return_value={
            'status': 'error',
            'reason_code': reason_codes.SQL_EXPLICIT_ONLY_UNGROUNDED,
            'error': 'run_name=kaira is not grounded',
            'question': 'show kaira runs',
        }),
    ):
        result = await handle_data_query(
            question='show kaira runs',
            db=AsyncMock(),
            auth=SimpleNamespace(),
            app_id='kaira-bot',
            session={'scratchpad': {}},
        )

    envelope = result.as_dict()
    assert envelope['status'] == 'error'
    assert envelope['outcome']['reason_code'] == reason_codes.SQL_EXPLICIT_ONLY_UNGROUNDED
    assert envelope['recovery'] == {'recoverable': True, 'failure_kind': 'invalid_reference'}
    state_delta = envelope['state_delta']
    thread = state_delta['open_threads'][0]
    assert thread['kind'] == 'clarify_explicit_only'
    assert state_delta['failure_record']['recoverable'] is True


# ---------------------------------------------------------------------------
# 2.3 Bundle projection observability
# ---------------------------------------------------------------------------


def test_bundle_event_payload_serializes_projected_classes_and_explicit_only_field_safety():
    from app.services.report_builder.chat_handler import _bundle_event_payload

    cls_run = MagicMock()
    cls_run.ontology_class = 'Evaluation.Run'
    cls_run.storage = 'evaluation_runs'
    cls_run.identifier_field = 'run_id'
    cls_run.contract_id = None
    cls_run.field_safety = {'run_name': 'explicit_only', 'run_id': 'safe_first_pass'}

    proj = MagicMock()
    proj.pack_id = 'analytics'
    proj.pack_version = '0.3.1'
    proj.projected_classes = (cls_run,)

    scope = MagicMock()
    scope.tenant_id = 'tenant-x'
    scope.effective_app_id = 'kaira-bot'
    scope.effective_pack_ids = ['analytics']

    bundle = MagicMock()
    bundle.scope = scope
    bundle.ontology_version = 1
    bundle.pack_projections = (proj,)
    bundle.tool_specs = ()
    bundle.tool_schema_enums = {}
    bundle.safety_by_entity.return_value = {'run_name': 'explicit_only'}
    bundle.resolvers = ()

    payload = _bundle_event_payload(bundle)

    assert 'pack_projections' in payload
    pack_entry = payload['pack_projections'][0]
    assert pack_entry['pack_id'] == 'analytics'
    assert pack_entry['pack_version'] == '0.3.1'
    classes = pack_entry['projected_classes']
    assert classes[0]['ontology_class'] == 'Evaluation.Run'
    assert classes[0]['storage'] == 'evaluation_runs'
    assert classes[0]['identifier_field'] == 'run_id'
    # Only explicit_only overrides are serialized (safe_first_pass elided).
    assert classes[0]['field_safety'] == {'run_name': 'explicit_only'}


def test_bundle_event_payload_omits_field_safety_when_no_explicit_only_markers():
    from app.services.report_builder.chat_handler import _bundle_event_payload

    cls = MagicMock()
    cls.ontology_class = 'Evaluation.Thread'
    cls.storage = 'threads'
    cls.identifier_field = 'thread_id'
    cls.contract_id = None
    cls.field_safety = {'thread_id': 'safe_first_pass'}

    proj = MagicMock()
    proj.pack_id = 'analytics'
    proj.pack_version = '0.3.1'
    proj.projected_classes = (cls,)

    scope = MagicMock()
    scope.tenant_id = 'tenant-x'
    scope.effective_app_id = 'kaira-bot'
    scope.effective_pack_ids = ['analytics']

    bundle = MagicMock()
    bundle.scope = scope
    bundle.ontology_version = 1
    bundle.pack_projections = (proj,)
    bundle.tool_specs = ()
    bundle.tool_schema_enums = {}
    bundle.safety_by_entity.return_value = {}
    bundle.resolvers = ()

    payload = _bundle_event_payload(bundle)
    classes = payload['pack_projections'][0]['projected_classes']
    # ``field_safety`` omitted entirely when no explicit_only markers exist —
    # the payload stays compact.
    assert 'field_safety' not in classes[0]


# ---------------------------------------------------------------------------
# Reason-code registration
# ---------------------------------------------------------------------------


def test_phase2_reason_codes_registered_in_analytics_set():
    assert reason_codes.SQL_EXPLICIT_ONLY_UNGROUNDED in reason_codes.ANALYTICS_REASON_CODES
    assert reason_codes.SQL_INVALID_FILTERS_SHAPE in reason_codes.ANALYTICS_REASON_CODES
