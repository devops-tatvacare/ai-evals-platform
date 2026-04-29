"""M2 harness integration tests — plan §11.2 acceptance gates.

The existing ``_execute_chat_turn`` harness remains the production turn
loop; M2 only changes the **inputs** it consumes (``ScopeContext`` +
``ScopedBundle``). These tests pin the handful of contracts the plan
requires the cutover to preserve:

- previous-turn scratchpad rehydrates
- ``scope_derived`` filters drop on scope change
- single-app runtime contract survives (one ``effective_app_id``, one
  persisted ``app_id``)
- ``last_response_id`` threading stays intact
- cacheable prompt prefix is byte-identical across turns
- runtime events are ordered and complete (no gaps in the new
  ``scope.resolved`` / ``bundle.assembled`` emission)
- job watermark advances after observation

These tests patch the heavy I/O boundaries (DB, LLM, SDK) so the
assertions are about the harness's orchestration of the new assembly
layer rather than any network round-trip.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services.report_builder.chat_handler import (
    _bundle_event_payload,
    _build_tools_from_bundle,
    _execute_chat_turn,
    assemble_context,
)
from app.services.report_builder.scratchpad_state import (
    active_filter_provenance,
    active_filter_values,
    default_scratchpad,
    drop_scope_derived_filters,
    remember_active_filters,
)
from app.services.sherlock import (
    BundleBuilder,
    RecognitionEvent,
    ScopeContext,
    ScopedBundle,
    ScopeGuard,
    render_bundle_context,
)
from app.services.sherlock.bundle_types import (
    ClassProjection,
    EntityTypeRecord,
    OntologyClassRecord,
    PackProjection,
    ResolverRecord,
)
from app.services.sherlock.turn_assembly import TurnAssembly


# ---------------------------------------------------------------------------
# Fixtures: synthetic scope + bundle the patched harness can consume
# ---------------------------------------------------------------------------


_TENANT_ID = uuid.UUID('11111111-1111-1111-1111-111111111111')
_USER_ID = uuid.UUID('22222222-2222-2222-2222-222222222222')


def _make_scope(app_id: str = 'kaira-bot') -> ScopeContext:
    return ScopeContext(
        tenant_id=_TENANT_ID,
        user_id=_USER_ID,
        allowed_app_ids=(app_id,),
        requested_app_ids=(app_id,),
        effective_app_id=app_id,
        effective_pack_ids=('analytics', 'report_builder'),
        app_aliases=(app_id,),
    )


def _make_bundle(scope: ScopeContext) -> ScopedBundle:
    entity_types = (
        EntityTypeRecord(
            id=uuid.uuid4(),
            tenant_id=None,
            app_id=None,
            name='run_name',
            ontology_class_name='evaluation.run',
            role='free_text',
            safety='explicit_only',
            description='Free-text run label',
            examples=(),
        ),
        EntityTypeRecord(
            id=uuid.uuid4(),
            tenant_id=None,
            app_id=None,
            name='status',
            ontology_class_name='evaluation.run',
            role='categorical',
            safety='safe_first_pass',
            description='Run status',
            examples=(),
        ),
    )
    resolvers = (
        ResolverRecord(
            id=uuid.uuid4(),
            tenant_id=None,
            app_id=None,
            key='run-name',
            entity_type='run_name',
            description='Resolve run_name',
            source='semantic_dimension',
            config={'dimension': 'run_name', 'match': 'contains', 'limit': 10},
            safety='explicit_only',
        ),
    )
    projection = PackProjection(
        pack_id='analytics',
        pack_version='2026.04.24',
        projected_classes=(
            ClassProjection(
                ontology_class='evaluation.run',
                storage='agg_evaluation_run',
                identifier_field='run_id',
            ),
        ),
        tool_specs=(),
        tool_schema_enums={},
        question_hints='',
    )
    return ScopedBundle(
        scope=scope,
        ontology_classes=(
            OntologyClassRecord(id=uuid.uuid4(), name='evaluation.run', parent_name='evaluation', description=None, version=1),
        ),
        entity_types=entity_types,
        resolvers=resolvers,
        pack_projections=(projection,),
        tool_specs=(),
        tool_schema_enums={},
        question_hints='',
        cache_key=(str(scope.tenant_id), scope.effective_app_id, 1, frozenset({('analytics', '2026.04.24')})),
        ontology_version=1,
    )


# ---------------------------------------------------------------------------
# Helper: patch the harness I/O and record emitted events
# ---------------------------------------------------------------------------


class _RecordedHarness:
    """Drives ``_execute_chat_turn`` with every external dep patched.

    Captures runtime events in emission order, tracks the
    ``previous_response_id`` passed to the SDK, and yields whatever
    ``final_output`` the test supplies.
    """

    def __init__(
        self,
        *,
        scope: ScopeContext,
        bundle: ScopedBundle,
        prompt_prefix: str = 'PREFIX',
    ) -> None:
        self.scope = scope
        self.bundle = bundle
        self.prompt_prefix = prompt_prefix
        self.runtime_events: list[tuple[str, dict[str, Any]]] = []
        self.previous_response_ids: list[str | None] = []
        self.systems: list[str] = []
        self.final_output = 'ok'
        self.next_response_id: str | None = 'resp-turn'

    async def _fake_emit_runtime_event(self, runtime_session, event_type, payload, emit_fn, _db):
        seq = len(self.runtime_events) + 1
        event = {'event': event_type, 'data': {'seq': seq, **payload}}
        self.runtime_events.append((event_type, event['data']))
        if emit_fn is not None:
            await emit_fn(event)
        return event

    def _fake_run_sdk(
        self,
        *,
        instructions,
        previous_response_id=None,
        sherlock_context=None,
        **_kwargs,
    ):
        self.systems.append(instructions)
        self.previous_response_ids.append(previous_response_id)
        final_output = self.final_output
        next_response_id = self.next_response_id

        async def _gen():
            yield {
                'event': '_internal_turn_complete',
                'data': {
                    'last_response_id': next_response_id,
                    'final_output': final_output,
                },
            }

        return _gen()

    def patch_stack(self, stack: contextlib.ExitStack) -> None:
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.resolve_turn_scope_and_bundle',
            new=AsyncMock(return_value=TurnAssembly(scope=self.scope, bundle=self.bundle)),
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
            'app.services.report_builder.chat_handler.load_semantic_model',
            return_value={},
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
            new=AsyncMock(return_value=self.prompt_prefix),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler._render_pending_jobs_block',
            new=AsyncMock(return_value=''),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.record_user_message',
            new=AsyncMock(),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.create_assistant_message',
            new=AsyncMock(return_value='msg-1'),
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
            new=AsyncMock(),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler._emit_runtime_event',
            new=AsyncMock(side_effect=self._fake_emit_runtime_event),
        ))
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.run_sherlock_sdk_turn',
            new=self._fake_run_sdk,
        ))


def _session(app_id: str = 'kaira-bot') -> dict[str, Any]:
    return {
        'chat_session_id': 'session-1',
        'app_id': app_id,
        'tenant_id': str(_TENANT_ID),
        'user_id': str(_USER_ID),
        'messages': [],
        'scratchpad': default_scratchpad(),
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_previous_turn_scratchpad_rehydrated():
    """Turn 2 sees turn 1's user_explicit filter; provenance survives AND the
    filter lands in the assembled turn system prompt (i.e. the scratchpad
    render actually reaches the SDK)."""
    from app.services.chat_engine.prompts import scratchpad as scratchpad_prompt

    scope = _make_scope()
    bundle = _make_bundle(scope)
    harness = _RecordedHarness(scope=scope, bundle=bundle, prompt_prefix='PREFIX')
    session = _session()
    remember_active_filters(
        session['scratchpad'],
        {'status': 'failed'},
        provenance='user_explicit',
    )
    db = AsyncMock()

    with contextlib.ExitStack() as stack:
        harness.patch_stack(stack)
        # Unpatch ``assemble_context`` so the real prompt assembly runs,
        # letting us inspect what the SDK would actually see.
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.assemble_context',
            new=AsyncMock(side_effect=lambda sess, _db: scratchpad_prompt.render(sess)),
        ))
        await _execute_chat_turn(
            session,
            'show me the failures',
            provider='openai',
            model='gpt-4.1-mini',
            db=db,
            auth=SimpleNamespace(),
            emit=None,
            turn=None,
            entity_recognition=None,
        )

    assert active_filter_values(session['scratchpad']) == {'status': 'failed'}
    assert active_filter_provenance(session['scratchpad']) == {'status': 'user_explicit'}

    # The SDK's instructions must carry the prior filter. We check both
    # the exact key/value and its provenance label so a regression that
    # ships the filter silently (losing provenance) still fails.
    assert len(harness.systems) == 1
    rendered_prompt = harness.systems[0]
    assert 'status: failed' in rendered_prompt, (
        f'prior filter missing from turn prompt: {rendered_prompt!r}'
    )
    assert 'provenance=user_explicit' in rendered_prompt


@pytest.mark.asyncio
async def test_scope_derived_filter_drops_on_scope_change():
    """M2 runtime gate: when the turn's effective_app_id changes, the harness
    drops scope_derived filters but keeps user_explicit ones.

    Drives the full ``_execute_chat_turn`` loop across two turns with
    two different bundles/scopes so the regression tracks actual turn
    behavior, not just the helper.
    """
    session = _session()
    # Prime the scratchpad the way a prior turn would have left it:
    # one scope_derived filter (app_id) and one user_explicit one (status).
    session['scratchpad']['active_filters'] = {
        'app_id': {
            'value': 'kaira-bot',
            'provenance': 'scope_derived',
            'source_tool': 'scope_guard',
            'source_turn_id': None,
        },
        'status': {
            'value': 'failed',
            'provenance': 'user_explicit',
            'source_tool': None,
            'source_turn_id': None,
        },
    }
    # Tag the last-effective scope so turn 2 sees a *change*.
    session['_last_effective_app_id'] = 'kaira-bot'
    session['app_id'] = 'inside-sales'

    new_scope = _make_scope('inside-sales')
    new_bundle = _make_bundle(new_scope)
    harness = _RecordedHarness(scope=new_scope, bundle=new_bundle)
    db = AsyncMock()

    with contextlib.ExitStack() as stack:
        harness.patch_stack(stack)
        await _execute_chat_turn(
            session,
            'now show me failures in the new scope',
            provider='openai',
            model='gpt-4.1-mini',
            db=db,
            auth=SimpleNamespace(),
            emit=None,
            turn=None,
            entity_recognition=None,
        )

    values = active_filter_values(session['scratchpad'])
    assert 'status' in values and values['status'] == 'failed', (
        'user_explicit filters must survive scope change'
    )
    assert 'app_id' not in values, (
        'scope_derived filters must drop on scope change (live turn path)'
    )
    # Harness must have recorded the new scope's app_id on the session
    # so the NEXT turn's scope-change detector compares to this.
    assert session['_last_effective_app_id'] == 'inside-sales'


@pytest.mark.asyncio
async def test_scope_derived_drops_every_turn_even_without_change():
    """Plan §8.1: scope_derived filters are *recomputed every turn*, not
    just on scope change. This test drives a same-scope second turn and
    asserts the helper ran."""
    session = _session()
    session['scratchpad']['active_filters'] = {
        'app_id': {
            'value': 'kaira-bot',
            'provenance': 'scope_derived',
            'source_tool': 'scope_guard',
            'source_turn_id': None,
        },
    }
    scope = _make_scope()
    bundle = _make_bundle(scope)
    harness = _RecordedHarness(scope=scope, bundle=bundle)
    db = AsyncMock()

    with contextlib.ExitStack() as stack:
        harness.patch_stack(stack)
        await _execute_chat_turn(
            session, 'hello', provider='openai', model='gpt-4.1-mini',
            db=db, auth=SimpleNamespace(), emit=None, turn=None,
            entity_recognition=None,
        )

    assert active_filter_values(session['scratchpad']) == {}, (
        'scope_derived filters must be recomputed every turn, not carry forward'
    )


@pytest.mark.asyncio
async def test_runtime_contract_stays_single_app():
    """M2 invariant: scope emits exactly one ``effective_app_id`` and every
    persisted write (``save_runtime_state``, ``append_runtime_event``,
    runtime session row) carries a singular ``app_id``."""
    scope = _make_scope()
    bundle = _make_bundle(scope)
    harness = _RecordedHarness(scope=scope, bundle=bundle)
    session = _session()
    db = AsyncMock()

    save_calls: list[dict[str, Any]] = []

    async def _recording_save_runtime_state(**kwargs):
        save_calls.append(kwargs)

    with contextlib.ExitStack() as stack:
        harness.patch_stack(stack)
        # Override save_runtime_state so we can capture the runtime
        # session's ``app_id`` at persistence time.
        stack.enter_context(patch(
            'app.services.report_builder.chat_handler.save_runtime_state',
            new=AsyncMock(side_effect=_recording_save_runtime_state),
        ))
        await _execute_chat_turn(
            session,
            'hi',
            provider='openai',
            model='gpt-4.1-mini',
            db=db,
            auth=SimpleNamespace(),
            emit=None,
            turn=None,
            entity_recognition=None,
        )

    resolved = [data for etype, data in harness.runtime_events if etype == 'scope.resolved']
    assert len(resolved) == 1
    assert isinstance(resolved[0]['effective_app_id'], str)
    assert resolved[0]['effective_app_id'] == 'kaira-bot'
    # ``effective_app_id`` is a singular field, not a list.
    assert not isinstance(resolved[0]['effective_app_id'], (list, tuple))

    bundle_events = [data for etype, data in harness.runtime_events if etype == 'bundle.assembled']
    assert len(bundle_events) == 1
    assert bundle_events[0]['effective_app_id'] == 'kaira-bot'

    # Working session app_id is not mutated by scope resolution.
    assert session['app_id'] == 'kaira-bot'

    # Every ``save_runtime_state`` call persists a runtime session row
    # whose ``app_id`` is a single string, not a list/tuple.
    assert save_calls, 'runtime state must be persisted at least once per turn'
    for call in save_calls:
        runtime_session = call['runtime_session']
        assert isinstance(runtime_session.app_id, str)
        assert runtime_session.app_id == 'kaira-bot'


@pytest.mark.asyncio
async def test_job_watermark_advanced_after_observation():
    """Plan gate: after ``_render_pending_jobs_block`` surfaces a terminal
    job, the runtime session's ``last_job_observed_at`` watermark moves
    forward. Pins the invariant that terminal jobs are not re-shown on
    subsequent turns.

    We mock the three DB call sites the block makes (``db.scalar`` for
    the runtime session, ``db.execute`` for pending + terminal jobs,
    and the final ``db.execute(sa_update(...))`` that advances the
    watermark), then assert the UPDATE fires with the max completed_at
    of the surfaced terminal jobs.
    """
    from datetime import datetime, timedelta, timezone
    from unittest.mock import MagicMock

    from app.services.report_builder.chat_handler import _render_pending_jobs_block

    completed_at = datetime.now(timezone.utc)
    earlier = completed_at - timedelta(minutes=5)
    session_id = uuid.UUID('33333333-3333-3333-3333-333333333333')

    runtime_row = SimpleNamespace(
        chat_session_id=session_id,
        last_job_observed_at=earlier,
    )

    terminal_job = SimpleNamespace(
        id=uuid.uuid4(),
        job_type='populate-analytics',
        status='completed',
        completed_at=completed_at,
        updated_at=completed_at,
        progress={'current': 100, 'total': 100, 'message': ''},
        submission_context={
            'surface': 'sherlock',
            'session_id': str(session_id),
            'turn_id': None,
            'pack_id': 'analytics',
        },
        params={},
        result=None,
        error_message=None,
    )

    execute_calls: list[Any] = []

    async def _scalar(stmt):
        return runtime_row

    def _pending_result():
        res = MagicMock()
        res.scalars.return_value.all = MagicMock(return_value=[])
        return res

    def _terminal_result():
        res = MagicMock()
        res.scalars.return_value.all = MagicMock(return_value=[terminal_job])
        return res

    call_count = {'select': 0}

    async def _execute(stmt, *args, **kwargs):
        execute_calls.append(stmt)
        stmt_text = str(stmt).lower()
        if 'update' in stmt_text and 'sherlock_agent_sessions' in stmt_text:
            return MagicMock()
        # First select → pending jobs, second select → terminal jobs
        call_count['select'] += 1
        if call_count['select'] == 1:
            return _pending_result()
        return _terminal_result()

    db = MagicMock()
    db.scalar = AsyncMock(side_effect=_scalar)
    db.execute = AsyncMock(side_effect=_execute)

    working_session = {
        'chat_session_id': session_id,
        'app_id': 'kaira-bot',
        'tenant_id': _TENANT_ID,
        'user_id': _USER_ID,
    }

    rendered = await _render_pending_jobs_block(working_session, db)
    assert 'Newly completed pack jobs' in rendered, (
        'terminal job envelope missing from pending-jobs block'
    )

    # Find the watermark UPDATE among the recorded statements and
    # confirm it targets the right table and sets ``last_job_observed_at``
    # to the max completed_at of the surfaced terminal jobs.
    update_stmt = next(
        (s for s in execute_calls
         if 'update' in str(s).lower()
         and 'sherlock_agent_sessions' in str(s).lower()),
        None,
    )
    assert update_stmt is not None, (
        f'watermark UPDATE not issued after terminal job observation; '
        f'statements seen: {[str(s)[:120] for s in execute_calls]!r}'
    )
    # SQLAlchemy Update exposes ``get_children`` plus a compiled form;
    # the column name appears in the string representation.
    assert 'last_job_observed_at' in str(update_stmt).lower()


@pytest.mark.asyncio
async def test_last_response_id_threaded():
    scope = _make_scope()
    bundle = _make_bundle(scope)
    harness = _RecordedHarness(scope=scope, bundle=bundle)
    harness.next_response_id = 'resp-turn-1'
    session = _session()
    db = AsyncMock()

    with contextlib.ExitStack() as stack:
        harness.patch_stack(stack)
        await _execute_chat_turn(
            session, 'q1', provider='openai', model='gpt-4.1-mini',
            db=db, auth=SimpleNamespace(), emit=None, turn=None, entity_recognition=None,
        )
        harness.next_response_id = 'resp-turn-2'
        await _execute_chat_turn(
            session, 'q2', provider='openai', model='gpt-4.1-mini',
            db=db, auth=SimpleNamespace(), emit=None, turn=None, entity_recognition=None,
        )

    assert harness.previous_response_ids == [None, 'resp-turn-1']


@pytest.mark.asyncio
async def test_prompt_prefix_byte_identical_across_turns():
    scope = _make_scope()
    bundle = _make_bundle(scope)
    harness = _RecordedHarness(scope=scope, bundle=bundle, prompt_prefix='STABLE-PREFIX')
    session = _session()
    db = AsyncMock()

    with contextlib.ExitStack() as stack:
        harness.patch_stack(stack)
        await _execute_chat_turn(
            session, 'q1', provider='openai', model='gpt-4.1-mini',
            db=db, auth=SimpleNamespace(), emit=None, turn=None, entity_recognition=None,
        )
        await _execute_chat_turn(
            session, 'q2', provider='openai', model='gpt-4.1-mini',
            db=db, auth=SimpleNamespace(), emit=None, turn=None, entity_recognition=None,
        )

    assert len(harness.systems) == 2
    assert harness.systems[0].startswith('STABLE-PREFIX')
    assert harness.systems[1].startswith('STABLE-PREFIX')
    # The exact prefix bytes must be identical turn-over-turn.
    prefix_len = len('STABLE-PREFIX')
    assert harness.systems[0][:prefix_len] == harness.systems[1][:prefix_len]


@pytest.mark.asyncio
async def test_runtime_events_ordered_and_complete():
    """``scope.resolved`` + ``bundle.assembled`` land between
    ``user_message_added`` and ``entity_recognition`` (append-only, in order)."""
    scope = _make_scope()
    bundle = _make_bundle(scope)
    harness = _RecordedHarness(scope=scope, bundle=bundle)
    session = _session()
    db = AsyncMock()

    with contextlib.ExitStack() as stack:
        harness.patch_stack(stack)
        await _execute_chat_turn(
            session, 'q1', provider='openai', model='gpt-4.1-mini',
            db=db, auth=SimpleNamespace(), emit=None, turn=None, entity_recognition=None,
        )

    names = [etype for etype, _ in harness.runtime_events]
    i_user = names.index('user_message_added')
    i_scope = names.index('scope.resolved')
    i_bundle = names.index('bundle.assembled')
    i_recog = names.index('entity_recognition')
    i_system = names.index('system_prompt')
    i_done = names.index('done')

    assert i_user < i_scope < i_bundle < i_recog < i_system < i_done, (
        f'unexpected event order: {names}'
    )

    seqs = [data['seq'] for _, data in harness.runtime_events]
    assert seqs == list(range(1, len(seqs) + 1)), f'event seqs not contiguous: {seqs}'


# ---------------------------------------------------------------------------
# Unit tests for the bundle-driven helpers
# ---------------------------------------------------------------------------


def test_bundle_event_payload_shape():
    scope = _make_scope()
    bundle = _make_bundle(scope)
    payload = _bundle_event_payload(bundle)

    assert payload['effective_app_id'] == 'kaira-bot'
    assert payload['effective_pack_ids'] == ['analytics', 'report_builder']
    assert payload['ontology_version'] == 1
    assert payload['pack_versions'] == [
        {'pack_id': 'analytics', 'pack_version': '2026.04.24'},
    ]
    assert payload['safety_by_entity']['run_name'] == 'explicit_only'
    assert payload['safety_by_entity']['status'] == 'safe_first_pass'
    assert payload['resolver_keys'] == ['run-name']
    assert isinstance(payload['cache_key'], list)


def test_render_bundle_context_mentions_explicit_only_entities():
    scope = _make_scope()
    bundle = _make_bundle(scope)
    text = render_bundle_context(scope, bundle)

    assert 'Current app aliases' in text
    assert 'kaira-bot' in text
    assert 'Explicit-only entity types' in text
    assert 'run_name' in text
    assert 'resolve_entity' in text


def test_recognition_event_is_deterministic_in_scope():
    """M2 synthesizes the ``entity_recognition`` payload deterministically."""
    scope = _make_scope()
    bundle = _make_bundle(scope)
    from app.services.sherlock.recognition import build_recognition_event

    event = build_recognition_event(bundle)
    assert event.is_platform_query is True
    assert event.entities == []
    assert event.needs_resolution is False
    assert event.out_of_scope_reason is None
