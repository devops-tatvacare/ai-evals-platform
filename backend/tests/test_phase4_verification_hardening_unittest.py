"""Phase 4 — verification, hardening, and documentation of Phases 1-3.

This file closes the verification gaps the Phase 4 spec pins:

- durable carry-forward of current-turn explicit constraints into the
  next turn's SQL-safety view (``grounded_literal_set`` sees confirmed
  constraints emitted by a prior turn's tool envelope)
- Owner with a *truly empty* ``app_access`` grant set still resolves to
  every active app after the Phase 3 auth/seed fix
- ``data_check`` bad-filter shape guard covers every non-dict shape
  (string / list / int / None), not just strings
- bundle projection observability — ``bundle.assembled`` payload
  carries the pack projection summary any future pack can consume
- harness-core non-regression — pack-discovery, async-job scaffolding,
  and SSE event ordering remain intact after the Phase 2 envelope adds
- F1 attribution — the structured ``sherlock_sql_attribution`` log
  captures (original user message, rewritten question, generated SQL)
  so bad ``run_name`` leakage can be traced without assumption

These tests deliberately overlap a tiny amount with Phase 1-3 suites at
their *seams* — the point is to exercise multi-turn / multi-call flow
rather than single-call contracts.
"""
from __future__ import annotations

import logging
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# 1. Durable carry-forward of current-turn explicit constraints
# ---------------------------------------------------------------------------


class DurableConstraintCarryForward(unittest.TestCase):
    """Turn N emits ``state_delta.confirmed_constraints``; Turn N+1 must
    see those values as grounded literals so the SQL validator accepts
    predicates against explicit-only columns without re-asking."""

    def test_confirmed_constraint_emitted_in_turn_n_visible_to_turn_n_plus_1(self):
        from app.services.chat_engine.artifact import build_envelope
        from app.services.report_builder.scratchpad_state import (
            apply_state_delta,
            default_scratchpad,
            grounded_literal_set,
        )

        pad = default_scratchpad()

        # Turn N — resolve_entity-style envelope lands a grounded value.
        turn_n_envelope = build_envelope(
            status='ok',
            summary='resolved',
            kind='resolution',
            capability='analytics',
            state_delta={
                'confirmed_constraints': [
                    {
                        'key': 'run_name',
                        'value': 'Alpha-2026-04',
                        'provenance': 'resolver_derived',
                        'source_tool': 'resolve_entity',
                        'source_turn_id': 'turn-1',
                    },
                ],
                'grounded_refs': [
                    {
                        'kind': 'run_name',
                        'key': 'run_name',
                        'value': 'Alpha-2026-04',
                        'provenance': 'resolver_derived',
                        'source_tool': 'resolve_entity',
                    },
                ],
            },
        )
        envelope_dict = turn_n_envelope.as_dict()
        state_delta = envelope_dict.get('state_delta')
        assert state_delta is not None
        apply_state_delta(pad, dict(state_delta))

        # Turn N+1 — SQL agent re-reads the scratchpad. The validator's
        # ``grounded_literals`` view must contain the prior turn's value.
        grounded = grounded_literal_set(pad)
        self.assertIn('alpha-2026-04', grounded)

        # And the per-key constraint view survives as well, so the outer
        # agent prompt can render "already known" entries without reasking.
        from app.services.report_builder.scratchpad_state import (
            confirmed_constraint_values,
        )
        self.assertEqual(
            confirmed_constraint_values(pad).get('run_name'),
            'Alpha-2026-04',
        )

    def test_current_turn_filter_argument_merges_with_prior_constraints(self):
        """Plan §148: the validator sees *both* durable prior-turn state
        AND the current turn's filter argument, so a user-supplied literal
        on the same turn does not need to sit on the scratchpad first."""
        from app.services.report_builder.scratchpad_state import (
            apply_state_delta,
            default_scratchpad,
            grounded_literal_set,
        )

        pad = default_scratchpad()
        apply_state_delta(
            pad,
            {
                'confirmed_constraints': [
                    {
                        'key': 'status',
                        'value': 'VIOLATED',
                        'provenance': 'user_explicit',
                        'source_tool': 'data_check',
                        'source_turn_id': 'turn-1',
                    },
                ],
            },
        )

        # Current turn's outer agent passes its own filter argument; the
        # validator merges both views before checking the SQL text.
        grounded = grounded_literal_set(
            pad, current_filters={'run_name': 'Alpha-2026-04'},
        )
        self.assertIn('violated', grounded)
        self.assertIn('alpha-2026-04', grounded)


# ---------------------------------------------------------------------------
# 2. Owner with previously empty app_access still resolves allowed app
# ---------------------------------------------------------------------------


class OwnerEmptyAppAccessRegression(unittest.IsolatedAsyncioTestCase):
    """Phase 3 exit criterion: an Owner whose ``role_app_access`` table
    is empty (common pre-seed-fix state) must still see every active app
    after ``load_role_permissions`` runs. The previous Owner-expansion
    test case started from a non-empty grant set; this regression
    explicitly verifies the empty-grant path."""

    class _ScalarOneOrNoneResult:
        def __init__(self, value):
            self._value = value

        def scalar_one_or_none(self):
            return self._value

    class _ScalarsAllResult:
        def __init__(self, values):
            self._values = list(values)

        def scalars(self):
            return self

        def all(self):
            return list(self._values)

    async def test_owner_with_truly_empty_app_access_sees_every_active_app(self):
        from app.auth.permissions import load_role_permissions

        role_id = uuid.uuid4()
        owner_role = SimpleNamespace(
            id=role_id,
            name='Owner',
            is_system=True,
            permissions=[],
            # Empty grant set — the pre-seed-fix hazard the plan flags.
            app_access=[],
        )

        db = AsyncMock()
        db.execute.side_effect = [
            self._ScalarOneOrNoneResult(owner_role),
            self._ScalarsAllResult(['kaira-bot', 'voice-rx', 'inside-sales']),
        ]

        role, perms, app_slugs = await load_role_permissions(db, role_id)

        self.assertIs(role, owner_role)
        self.assertEqual(perms, [])
        # Owner with empty role_app_access STILL sees every active app
        # because the expansion is load-time, not grant-time.
        self.assertEqual(
            sorted(app_slugs),
            ['inside-sales', 'kaira-bot', 'voice-rx'],
        )

    async def test_owner_with_empty_app_access_resolves_allowed_app_via_scope_gate(self):
        """End-to-end flavour: once ``load_role_permissions`` expands the
        Owner's ``app_access``, the scope gate's
        ``ensure_registered_app_access`` check must pass for an app the
        expansion surfaced. The gate is auth-driven only — no Owner
        bypass at the gate layer, per Phase 3 plan."""
        from app.auth.app_scope import ensure_registered_app_access

        auth = SimpleNamespace(
            tenant_id='tenant-1',
            user_id='user-1',
            app_access={'kaira-bot', 'voice-rx', 'inside-sales'},
        )
        db = AsyncMock()
        with patch(
            'app.auth.app_scope.validate_registered_app_slug',
            new=AsyncMock(side_effect=lambda _db, slug, **_kw: slug),
        ):
            # Should NOT raise — the expansion has already populated
            # ``app_access``; the gate is satisfied by membership alone.
            resolved = await ensure_registered_app_access(db, auth, 'kaira-bot')  # type: ignore[arg-type]
        self.assertEqual(resolved, 'kaira-bot')

    async def test_scope_gate_still_rejects_unlisted_app_even_for_owner(self):
        """Safety rail: an app slug that resolves to *active* but is not
        on the Owner's expanded app_access (e.g. racy mid-session app
        insertion) still hits 403. The gate is the single source of
        truth — no Owner bypass at the gate layer."""
        from fastapi import HTTPException

        from app.auth.app_scope import ensure_registered_app_access

        auth = SimpleNamespace(
            tenant_id='tenant-1',
            user_id='user-1',
            app_access={'kaira-bot'},
        )
        db = AsyncMock()
        with patch(
            'app.auth.app_scope.validate_registered_app_slug',
            new=AsyncMock(side_effect=lambda _db, slug, **_kw: slug),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await ensure_registered_app_access(db, auth, 'inside-sales')  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.status_code, 403)


# ---------------------------------------------------------------------------
# 3. data_check bad-filter shape guard — exhaustive non-dict input coverage
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    'bad_filters',
    [
        'run_id=RUN-01',     # string
        ['run_id', 'RUN-01'],  # list
        42,                  # int
        True,                # bool
    ],
)
async def test_handle_data_check_rejects_every_non_dict_filter_shape(bad_filters):
    """Plan §2.4 expansion: any non-dict filter shape returns a typed
    ``SQL_INVALID_FILTERS_SHAPE`` envelope without raising.

    ``None`` is *not* a bad shape — it means "no filters" and the
    handler legitimately runs the underlying query without predicates.
    So it's excluded from this guard.
    """
    from app.services.chat_engine import reason_codes
    from app.services.report_builder.tool_handlers import handle_data_check

    with patch(
        'app.services.chat_engine.sql_agent.data_check',
        new=AsyncMock(),
    ) as data_check_mock:
        result = await handle_data_check(
            table='evaluation_runs',
            filters=bad_filters,
            db=AsyncMock(),
            auth=SimpleNamespace(),
            app_id='kaira-bot',
        )

    assert data_check_mock.await_count == 0, (
        'boundary guard must short-circuit before sql_agent.data_check'
    )
    envelope: dict = dict(result.as_dict())
    assert envelope.get('status') == 'error'
    outcome = envelope.get('outcome') or {}
    assert outcome.get('reason_code') == reason_codes.SQL_INVALID_FILTERS_SHAPE


# ---------------------------------------------------------------------------
# 4. Bundle projection observability — summary visible in runtime events
# ---------------------------------------------------------------------------


class BundleProjectionObservability(unittest.TestCase):
    """The ``bundle.assembled`` payload that flows into runtime events
    carries the per-pack projection summary (pack_id, pack_version,
    projected_classes[*].ontology_class). Any future pack author can
    observe the bundle state without adding a bespoke debug log."""

    def test_bundle_event_payload_lists_every_pack_projection(self):
        from app.services.report_builder.chat_handler import _bundle_event_payload

        def _proj(pack_id, version, *classes):
            p = MagicMock()
            p.pack_id = pack_id
            p.pack_version = version
            projected = []
            for ontology_class, storage, identifier in classes:
                c = MagicMock()
                c.ontology_class = ontology_class
                c.storage = storage
                c.identifier_field = identifier
                c.contract_id = None
                c.field_safety = {}
                projected.append(c)
            p.projected_classes = tuple(projected)
            return p

        scope = MagicMock()
        scope.tenant_id = 'tenant-x'
        scope.effective_app_id = 'kaira-bot'
        scope.effective_pack_ids = ['analytics', 'stub_vector']

        bundle = MagicMock()
        bundle.scope = scope
        bundle.ontology_version = 1
        bundle.pack_projections = (
            _proj('analytics', '2026.04.24', ('Evaluation.Run', 'evaluation_runs', 'run_id')),
            _proj('stub_vector', '0.0.1', ('Artifact.Embedding', 'embeddings', 'id')),
        )
        bundle.tool_specs = ()
        bundle.tool_schema_enums = {}
        bundle.safety_by_entity.return_value = {}
        bundle.resolvers = ()

        payload = _bundle_event_payload(bundle)

        pack_ids = {p['pack_id'] for p in payload['pack_projections']}
        self.assertEqual(pack_ids, {'analytics', 'stub_vector'})

        for entry in payload['pack_projections']:
            # Pack id / version surface so an operator can read what
            # version produced the projection.
            self.assertIn('pack_version', entry)
            classes = entry['projected_classes']
            # Each class entry names its ontology class and storage —
            # the minimum observability contract.
            for cls in classes:
                self.assertIn('ontology_class', cls)
                self.assertIn('storage', cls)

    def test_bundle_event_payload_has_stable_top_level_shape(self):
        """Event consumers downstream (dashboards, regression snapshots)
        rely on a stable top-level shape; pin it so an accidental rename
        is caught by the Phase 4 gate."""
        from app.services.report_builder.chat_handler import _bundle_event_payload

        scope = MagicMock()
        scope.tenant_id = 'tenant-x'
        scope.effective_app_id = 'kaira-bot'
        scope.effective_pack_ids = ['analytics']

        bundle = MagicMock()
        bundle.scope = scope
        bundle.ontology_version = 1
        bundle.pack_projections = ()
        bundle.tool_specs = ()
        bundle.tool_schema_enums = {}
        bundle.safety_by_entity.return_value = {}
        bundle.resolvers = ()

        payload = _bundle_event_payload(bundle)
        for key in (
            'effective_app_id',
            'effective_pack_ids',
            'ontology_version',
            'pack_versions',
            'pack_projections',
            'safety_by_entity',
            'resolver_keys',
            'cache_key',
        ):
            self.assertIn(key, payload)


# ---------------------------------------------------------------------------
# 5. Harness-core non-regression — pack discovery + event-type inventory
# ---------------------------------------------------------------------------


class HarnessNoRegression(unittest.TestCase):
    """These tests pin the *pre-existing* harness contract so Phase 1-3
    changes cannot silently drop pack-discovery, async-job-scaffolding,
    or SSE event types."""

    def test_pack_discovery_surfaces_analytics_and_report_builder(self):
        from app.services.chat_engine.capability_pack import (
            CAPABILITY_PACK_REGISTRY,
            ensure_packs_registered,
        )

        ensure_packs_registered()
        # Known packs still register. Stub pack is optional; analytics +
        # report_builder are the two the harness has always shipped.
        self.assertIn('analytics', CAPABILITY_PACK_REGISTRY)
        self.assertIn('report_builder', CAPABILITY_PACK_REGISTRY)

    def test_async_job_type_vocabulary_intact(self):
        """Async-job surface: the job vocabulary pinned in CLAUDE.md
        must still be in the worker's handler registry. We check the
        subset the Sherlock harness relies on (populate-analytics,
        populate-cost-rollup); analytics is the pack most likely to
        push new types in."""
        from app.services.job_worker import JOB_HANDLERS

        for job_type in (
            'populate-analytics',
            'populate-cost-rollup',
            'evaluate-batch',
        ):
            self.assertIn(
                job_type, JOB_HANDLERS, f'job type {job_type!r} missing'
            )

    def test_runtime_event_type_vocabulary_intact(self):
        """Every event type the harness turn-loop emits must remain
        registered; this guards against an accidental rename during
        Phase 2 envelope refactors.

        The harness spreads emission across two files — ``chat_handler``
        owns turn lifecycle events and ``openai_agents_adapter`` owns
        per-tool events — so we search both sources.
        """
        import pathlib

        required_event_types = {
            'user_message_added',
            'scope.resolved',
            'bundle.assembled',
            'entity_recognition',
            'system_prompt',
            'tool_call_start',
            'tool_call_end',
            'chart',
            'done',
            'error',
        }
        candidates = [
            pathlib.Path('backend/app/services/report_builder/chat_handler.py'),
            pathlib.Path('backend/app/services/chat_engine/openai_agents_adapter.py'),
            pathlib.Path('app/services/report_builder/chat_handler.py'),
            pathlib.Path('app/services/chat_engine/openai_agents_adapter.py'),
        ]
        combined = ''
        for path in candidates:
            resolved = path.resolve()
            if resolved.exists():
                combined += resolved.read_text(encoding='utf-8')
        assert combined, 'could not locate harness source files for event lookup'
        for event_type in required_event_types:
            self.assertIn(
                event_type, combined, f'event type {event_type!r} no longer emitted'
            )


# ---------------------------------------------------------------------------
# 6. F1 attribution — sql_attribution log captures user-msg → rewrite → SQL
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sql_attribution_log_captures_user_message_question_and_sql(caplog):
    """Phase 4 §2: the minimum F1 attribution artifact.

    A structured log record at SQL-generation time carries all three
    values needed to diagnose bad ``run_name`` leakage:
      - ``original_user_message`` (caller-supplied when available)
      - ``rewritten_question`` (the outer-agent tool-call args)
      - ``generated_sql`` (the LLM's output)

    The record is emitted as a single event so greps don't need to
    correlate across turns. The test only asserts the artifact is
    produced — it does not require any routing/logging subsystem.
    """
    from app.services.chat_engine.sql_agent import generate_sql

    async def _fake_llm(*, system_instruction, user_prompt, model, creds):
        return (
            '{"sql": "SELECT 1 FROM evaluation_runs", "chart_title": "t", '
            '"output_columns": []}',
            {'input_tokens': 0, 'output_tokens': 0},
        )

    with caplog.at_level(logging.INFO, logger='app.services.chat_engine.sql_agent'), patch(
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
            question='count eval runs by status',
            tenant_id='t',
            user_id='u',
            semantic_model={'tables': {}},
            original_user_message='show me kaira runs broken down by status',
        )

    records = [
        r for r in caplog.records
        if getattr(r, 'event', None) == 'sherlock_sql_attribution'
    ]
    assert len(records) == 1, (
        'exactly one sherlock_sql_attribution record expected per '
        'generate_sql call; got '
        f'{[getattr(r, "event", None) for r in caplog.records]}'
    )
    record = records[0]
    # All three chain fields present so attribution can be grepped as a
    # single event, not reconstructed across multiple lines.
    assert record.original_user_message == (
        'show me kaira runs broken down by status'
    )
    assert record.rewritten_question == 'count eval runs by status'
    assert 'SELECT 1 FROM evaluation_runs' in record.generated_sql


@pytest.mark.asyncio
async def test_sql_attribution_log_emitted_when_user_message_omitted(caplog):
    """Backwards-compat: the attribution log still fires when the caller
    did not pass ``original_user_message``. Empty string stands in so
    log downstream consumers can rely on the field always existing."""
    from app.services.chat_engine.sql_agent import generate_sql

    async def _fake_llm(*, system_instruction, user_prompt, model, creds):
        return (
            '{"sql": "SELECT 1", "chart_title": null, "output_columns": []}',
            {'input_tokens': 0, 'output_tokens': 0},
        )

    with caplog.at_level(logging.INFO, logger='app.services.chat_engine.sql_agent'), patch(
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
            question='count eval runs by status',
            tenant_id='t',
            user_id='u',
            semantic_model={'tables': {}},
        )

    records = [
        r for r in caplog.records
        if getattr(r, 'event', None) == 'sherlock_sql_attribution'
    ]
    assert len(records) == 1
    assert records[0].original_user_message == ''


def test_build_sql_attribution_artifact_shape():
    """The structured artifact is a plain dict any caller can capture
    (e.g. into a test fixture, a debug endpoint, or an adversarial-harness
    snapshot) without reaching into the logging subsystem."""
    from app.services.chat_engine.sql_agent import build_sql_attribution_artifact

    art = build_sql_attribution_artifact(
        original_user_message='show me kaira runs',
        rewritten_question='count eval runs by status',
        generated_sql='SELECT 1 FROM evaluation_runs',
    )
    assert art == {
        'original_user_message': 'show me kaira runs',
        'rewritten_question': 'count eval runs by status',
        'generated_sql': 'SELECT 1 FROM evaluation_runs',
    }


def test_build_sql_attribution_artifact_truncates_long_values():
    """Truncation keeps the artifact log-friendly even when the user
    pastes a novel into the chat input."""
    from app.services.chat_engine.sql_agent import build_sql_attribution_artifact

    long_msg = 'x' * 5000
    art = build_sql_attribution_artifact(
        original_user_message=long_msg,
        rewritten_question=long_msg,
        generated_sql=long_msg,
    )
    assert len(art['original_user_message']) <= 500
    assert len(art['rewritten_question']) <= 500
    # SQL gets a longer cap so realistic CTE/join stacks survive
    # without losing the predicate we actually care about.
    assert len(art['generated_sql']) <= 1000


if __name__ == '__main__':
    unittest.main()
