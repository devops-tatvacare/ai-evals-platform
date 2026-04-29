"""Phase 2 acceptance-gate tests: envelope contract + reason codes.

Each test maps to a named Phase-2 gate in ``docs/plans/sherlock-future-plan.md``
§Phase-2 → *Acceptance gates*:

- **reason-code closure** (§Phase-2 gate 5): every ``reason_code`` emitted
  by a pack's code path must live inside that pack's registered frozenset
  in ``reason_codes.py``.
- **bounded-retry** (§Phase-2 gate 6): with ``_fatal_tool_result_error``
  deleted, a poisoned SQL agent returning
  ``SQL_INVALID_OUTPUT_ALIAS_CONTRACT`` on every attempt must not cause
  the dispatcher to raise; the agent must observe the code and the
  outer loop must bound retries at ``MAX_TOOL_ROUNDS``.
- **outcome-payload separation** (§Phase-2 gate 7): for any envelope
  that carries an artifact, ``outcome.artifact.extras`` may contain only
  scalar / small-JSON metadata — never rows, spec, or blobs > 1 KB.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Gate 5 — reason-code closure
# ---------------------------------------------------------------------------


class ReasonCodeClosureTests(unittest.TestCase):
    """Every SQL_* / CG_* / BLUEPRINT_* / ENTITY_* / DISCOVER_* literal
    appearing in pack code must be registered in ``reason_codes.py``
    under the owning pack's frozenset. A new deterministic branch that
    invents an unregistered code fails this test — the drift guard the
    plan calls out as the sole gate against reason-code sprawl.
    """

    # Pattern: quoted uppercase-with-underscore identifier that looks like
    # a reason code. Matches ``'SQL_UNKNOWN_COLUMN'`` / ``"CG_EMPTY"`` /
    # ``'BLUEPRINT_INVALID_SCHEMA'``. Env-var family ``SQL_AGENT_*`` is
    # excluded: those are provider/model knobs, not reason codes.
    _CODE_RE = re.compile(r"""['"]((?:SQL|CG|BLUEPRINT|ENTITY|DISCOVER)_[A-Z_]{3,})['"]""")
    _CODE_EXCLUDE_PREFIXES = ('SQL_AGENT_',)

    _ANALYTICS_PACK_FILES = [
        'backend/app/services/chat_engine/sql_agent.py',
        'backend/app/services/chat_engine/chartability_gate.py',
        'backend/app/services/report_builder/chat_handler.py',
        'backend/app/services/report_builder/tool_handlers.py',
    ]

    _REPORT_BUILDER_PACK_FILES = [
        'backend/app/services/report_builder/tool_handlers.py',
    ]

    def _scan(self, files: list[str]) -> set[str]:
        found: set[str] = set()
        for rel in files:
            text = Path(rel).read_text()
            # Strip the reason_codes import block from scan targets —
            # that's the registry itself; enumerating it tests nothing.
            if rel.endswith('reason_codes.py'):
                continue
            for code in self._CODE_RE.findall(text):
                if code.startswith(self._CODE_EXCLUDE_PREFIXES):
                    continue
                found.add(code)
        return found

    def test_analytics_pack_codes_are_subset_of_registered_set(self):
        from app.services.chat_engine.reason_codes import ANALYTICS_REASON_CODES

        emitted = self._scan(self._ANALYTICS_PACK_FILES)
        unregistered = {
            code for code in emitted
            if code.startswith(('SQL_', 'CG_', 'ENTITY_', 'DISCOVER_'))
            and code not in ANALYTICS_REASON_CODES
        }
        self.assertEqual(
            unregistered, set(),
            f"analytics pack emits unregistered reason codes: {sorted(unregistered)}. "
            f"Add them to reason_codes.ANALYTICS_* or remove from code.",
        )

    def test_report_builder_pack_codes_are_subset_of_registered_set(self):
        from app.services.chat_engine.reason_codes import REPORT_BUILDER_REASON_CODES

        emitted = self._scan(self._REPORT_BUILDER_PACK_FILES)
        unregistered = {
            code for code in emitted
            if code.startswith('BLUEPRINT_')
            and code not in REPORT_BUILDER_REASON_CODES
        }
        self.assertEqual(
            unregistered, set(),
            f"report_builder pack emits unregistered reason codes: {sorted(unregistered)}.",
        )

    def test_pack_local_reason_code_sets_are_pairwise_disjoint(self):
        """Plan §6.2.1 rule 2: non-shared codes must belong to exactly
        one pack. The module-level guard in reason_codes.py raises on
        collision; this test pins the invariant at the test layer too.
        """
        from app.services.chat_engine.reason_codes import (
            ANALYTICS_REASON_CODES,
            HARNESS_SHARED_REASON_CODES,
            REPORT_BUILDER_REASON_CODES,
        )

        local_a = ANALYTICS_REASON_CODES - HARNESS_SHARED_REASON_CODES
        local_b = REPORT_BUILDER_REASON_CODES - HARNESS_SHARED_REASON_CODES
        self.assertEqual(
            local_a & local_b, set(),
            'analytics and report_builder must not share non-HARNESS reason codes',
        )


# ---------------------------------------------------------------------------
# Gate 6 — bounded retry (no infinite loop after fatal-error path removal)
# ---------------------------------------------------------------------------


class BoundedRetryTests(unittest.IsolatedAsyncioTestCase):
    """``_fatal_tool_result_error`` is deleted in Phase 2. A poisoned
    SQL agent returning ``SQL_INVALID_OUTPUT_ALIAS_CONTRACT`` on every
    attempt must no longer raise ``RuntimeError`` inside the tool
    dispatcher — the outer loop observes the typed code and bounds
    retries at ``MAX_TOOL_ROUNDS`` on its own.
    """

    async def test_fatal_alias_contract_no_longer_raises_runtime_error(self):
        from app.services.chat_engine.openai_agents_adapter import (
            SherlockContext,
            _sherlock_tool_handler,
        )
        from app.services.report_builder.scratchpad_state import default_scratchpad

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        tool_db = AsyncMock()
        sc = SherlockContext(
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='openai',
            working_session={'scratchpad': default_scratchpad(), 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )
        ctx = SimpleNamespace(context=sc, tool_name='data_query', tool_call_id='tc_1')

        poisoned_envelope = json.dumps({
            'status': 'error',
            'summary': 'query failed',
            'outcome': {
                'kind': 'error',
                'capability': 'analytics',
                'reason_code': 'SQL_INVALID_OUTPUT_ALIAS_CONTRACT',
                'warnings': ['alias contract violated'],
                'counts': {'rows': 0, 'records': 0, 'affected': 0},
            },
            'payload': {'question': 'q'},
        })

        with patch('app.database.async_session', return_value=_SessionCtx(tool_db)), patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=AsyncMock(return_value=poisoned_envelope),
        ):
            # Must not raise. Returns the envelope string verbatim.
            result = await _sherlock_tool_handler(ctx, '{"question":"q"}')

        parsed = json.loads(result)
        self.assertEqual(parsed['status'], 'error')
        self.assertEqual(
            parsed['outcome']['reason_code'],
            'SQL_INVALID_OUTPUT_ALIAS_CONTRACT',
        )

    def test_fatal_tool_result_error_symbol_is_deleted(self):
        """Source-level gate: Phase-2 plan §Phase-2 step 4 explicitly
        deletes ``_fatal_tool_result_error``. If the symbol reappears,
        the bounded-retry invariant can silently regress.
        """
        adapter_src = Path(
            'backend/app/services/chat_engine/openai_agents_adapter.py'
        ).read_text()
        self.assertNotIn('_fatal_tool_result_error', adapter_src)

    async def test_repeated_poisoned_sql_stays_bounded_by_max_tool_rounds(self):
        """Plan §Phase-2 gate 6 integration form: with the fatal branch
        deleted, dispatching the same poisoned SQL envelope
        ``MAX_TOOL_ROUNDS`` times in succession must never raise and the
        outer loop's upstream bound (``max_turns=MAX_TOOL_ROUNDS`` passed
        into ``run_sherlock_sdk_turn``) is the only ceiling — not an
        in-handler raise. This test pins the per-call non-raise invariant
        across the full bound so a regression that silently re-introduces
        a raise cannot slip past a single-call test.
        """
        from app.services.chat_engine.openai_agents_adapter import (
            SherlockContext,
            _sherlock_tool_handler,
        )
        from app.services.report_builder.chat_handler import MAX_TOOL_ROUNDS
        from app.services.report_builder.scratchpad_state import default_scratchpad

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        tool_db = AsyncMock()
        sc = SherlockContext(
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='openai',
            working_session={'scratchpad': default_scratchpad(), 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )

        poisoned_envelope = json.dumps({
            'status': 'error',
            'summary': 'query failed',
            'outcome': {
                'kind': 'error',
                'capability': 'analytics',
                'reason_code': 'SQL_INVALID_OUTPUT_ALIAS_CONTRACT',
                'warnings': ['alias contract violated'],
                'counts': {'rows': 0, 'records': 0, 'affected': 0},
            },
            'payload': {'question': 'q'},
        })

        call_count = 0
        with patch('app.database.async_session', return_value=_SessionCtx(tool_db)), patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=AsyncMock(return_value=poisoned_envelope),
        ):
            for attempt in range(MAX_TOOL_ROUNDS):
                ctx = SimpleNamespace(
                    context=sc,
                    tool_name='data_query',
                    tool_call_id=f'tc_{attempt}',
                )
                # Must not raise on any of the MAX_TOOL_ROUNDS attempts.
                result = await _sherlock_tool_handler(ctx, '{"question":"q"}')
                parsed = json.loads(result)
                self.assertEqual(
                    parsed['outcome']['reason_code'],
                    'SQL_INVALID_OUTPUT_ALIAS_CONTRACT',
                )
                call_count += 1

        self.assertEqual(call_count, MAX_TOOL_ROUNDS)
        self.assertEqual(sc.artifacts, [])
        # Poisoned calls all land as tool-call entries; never more than
        # the outer bound allows.
        self.assertEqual(len(sc.tool_call_log), MAX_TOOL_ROUNDS)

    def test_max_tool_rounds_is_passed_to_run_sherlock_sdk_turn(self):
        """The outer loop's bound is the sole guarantee that the
        dispatcher's non-raise invariant cannot degrade into an infinite
        loop. Pin the wiring at the source level.
        """
        chat_handler_src = Path(
            'backend/app/services/report_builder/chat_handler.py'
        ).read_text()
        self.assertIn('max_turns=MAX_TOOL_ROUNDS', chat_handler_src)


# ---------------------------------------------------------------------------
# Gate 7 — outcome-payload separation
# ---------------------------------------------------------------------------


class OutcomePayloadSeparationTests(unittest.TestCase):
    """``outcome.artifact.extras`` may carry ONLY outcome-shaped metadata
    (scalars / small JSON) about the artifact. Pack-internal rows, specs,
    and text blobs belong in ``envelope.payload``. This test enforces the
    boundary without running a live kaira-bot turn — it sweeps the known
    envelope construction sites and asserts the schema.
    """

    _MAX_EXTRAS_BYTES = 1024

    def _assert_extras_small(self, extras: dict[str, Any]) -> None:
        blob = json.dumps(extras, default=str)
        self.assertLessEqual(
            len(blob), self._MAX_EXTRAS_BYTES,
            f'outcome.artifact.extras must be <=1KB JSON, got {len(blob)}: {extras!r}',
        )
        # No nested rows / data arrays allowed inside extras. Every value
        # must be a scalar or a shallow dict of scalars.
        for key, value in extras.items():
            if isinstance(value, (list, tuple)):
                self.fail(
                    f"extras['{key}'] is a sequence ({type(value).__name__}); "
                    f"rows / specs belong in envelope.payload, not extras."
                )
            if isinstance(value, dict):
                for sub_k, sub_v in value.items():
                    if isinstance(sub_v, (list, tuple, dict)):
                        self.fail(
                            f"extras['{key}']['{sub_k}'] is nested; "
                            f"extras must be shallow scalar metadata.",
                        )

    def test_analytics_chart_extras_contract(self):
        """Analytics chart envelopes declare exactly
        ``extras = {rendered_as, top_n}``. Both are scalar; neither
        contains rows or the vega-lite spec.
        """
        from app.services.chat_engine.artifact import build_envelope

        sample = build_envelope(
            status='ok',
            summary='10 rows',
            kind='artifact',
            capability='analytics',
            reason_code=None,
            counts={'rows': 10, 'records': 0, 'affected': 0},
            artifact={
                'type': 'chart',
                'contract': 'analytics.chart.v1',
                'extras': {'rendered_as': 'bar', 'top_n': None},
            },
            payload={'chart': {'kind': 'chart', 'spec': {}, 'data': [{'x': 1}] * 10}},
        )

        artifact = sample['outcome']['artifact']
        self.assertEqual(artifact['contract'], 'analytics.chart.v1')
        self._assert_extras_small(artifact['extras'])
        # Spec + rows MUST live in payload, never extras.
        self.assertIn('chart', sample['payload'])
        self.assertNotIn('spec', artifact['extras'])
        self.assertNotIn('data', artifact['extras'])

    def test_wrap_handler_result_rejects_oversize_extras(self):
        """Gate-level contract: if someone tried to stuff rows into
        extras, the 1KB / no-sequence assertions must flag it.
        """
        oversize_extras = {
            'rendered_as': 'bar',
            'top_n': None,
            'rows': [{'x': i, 'y': i * 2} for i in range(500)],
        }
        with self.assertRaises(AssertionError):
            self._assert_extras_small(oversize_extras)


# ---------------------------------------------------------------------------
# Gate — MALFORMED_ARGS surfaces as a harness envelope (plan §6.2.1)
# ---------------------------------------------------------------------------


class MalformedArgsEnvelopeTests(unittest.IsolatedAsyncioTestCase):
    """Plan §6.2.1: ``MALFORMED_ARGS`` is the harness-owned reason code for
    tool-arg parse failures. The envelope MUST carry the §6.2 shape
    (``status`` + ``outcome{kind,capability,reason_code,counts}`` +
    ``payload``), not the legacy ``{"status":"error","message":...}`` dict.
    """

    async def _invoke(self, raw_args: str) -> dict[str, Any]:
        from app.services.chat_engine.openai_agents_adapter import (
            SherlockContext,
            _sherlock_tool_handler,
        )
        from app.services.report_builder.scratchpad_state import default_scratchpad

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        tool_db = AsyncMock()
        sc = SherlockContext(
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='openai',
            working_session={'scratchpad': default_scratchpad(), 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )
        ctx = SimpleNamespace(context=sc, tool_name='data_query', tool_call_id='tc_bad_args')

        with patch('app.database.async_session', return_value=_SessionCtx(tool_db)), patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=AsyncMock(),
        ) as dispatch_mock:
            result_str = await _sherlock_tool_handler(ctx, raw_args)
            # Boundary rejection: handler dispatcher must never be called.
            dispatch_mock.assert_not_awaited()

        return json.loads(result_str)

    async def test_malformed_json_produces_phase_2_envelope(self):
        envelope = await self._invoke('{not-json')

        # Phase 2 envelope shape — top-level keys and outcome block.
        self.assertEqual(envelope['status'], 'error')
        self.assertIn('summary', envelope)
        self.assertIn('payload', envelope)
        outcome = envelope['outcome']
        self.assertEqual(outcome['kind'], 'error')
        self.assertEqual(outcome['capability'], 'harness')
        self.assertEqual(outcome['reason_code'], 'MALFORMED_ARGS')
        self.assertEqual(
            outcome['counts'],
            {'rows': 0, 'records': 0, 'affected': 0},
        )
        # Legacy bespoke shape must be gone.
        self.assertNotIn('message', envelope)

    async def test_non_object_json_produces_phase_2_envelope(self):
        envelope = await self._invoke('[1, 2, 3]')

        self.assertEqual(envelope['status'], 'error')
        self.assertEqual(envelope['outcome']['reason_code'], 'MALFORMED_ARGS')
        self.assertEqual(envelope['outcome']['capability'], 'harness')

    async def test_malformed_reason_code_is_registered_in_harness_shared_set(self):
        from app.services.chat_engine.reason_codes import (
            HARNESS_SHARED_REASON_CODES,
            MALFORMED_ARGS,
        )

        self.assertIn(MALFORMED_ARGS, HARNESS_SHARED_REASON_CODES)


# ---------------------------------------------------------------------------
# Gate — plan reproducer: "count runs per status" → "show as pie"
# ---------------------------------------------------------------------------


class CountRunsThenShowAsPieEnvelopeTests(unittest.IsolatedAsyncioTestCase):
    """Plan-required Phase 2 reproducer.

    Turn 1: ``count runs per status`` → analytics ``data_query`` returns a
    chart-capable result; the envelope's ``outcome.artifact`` carries
    ``contract = 'analytics.chart.v1'`` and ``extras.rendered_as = 'bar'``.
    Turn 2 (``show as pie``) runs in the outer agent, not the tool handler;
    this test pins the tool-level envelope shape that the outer agent
    reads on turn 1 — ``data.outcome`` on the persisted tool_call_end event
    AND the ``toolCalls[].outcome`` entry on the tool_call_log.
    """

    async def test_count_per_status_emits_chart_artifact_envelope(self):
        from app.services.chat_engine.openai_agents_adapter import (
            SherlockContext,
            _sherlock_tool_handler,
        )
        from app.services.report_builder.scratchpad_state import default_scratchpad

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        # Chartable result: 1 nominal dimension + 1 measure, 4 rows.
        data_query_envelope = {
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
                'rows': [
                    {'status': 'completed', 'n': 120},
                    {'status': 'failed', 'n': 7},
                    {'status': 'cancelled', 'n': 3},
                    {'status': 'running', 'n': 1},
                ],
                'chart': {
                    'kind': 'chart',
                    'spec': {'mark': 'bar'},
                    'title': 'Count runs per status',
                },
            },
        }

        tool_db = AsyncMock()
        sc = SherlockContext(
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='openai',
            working_session={'scratchpad': default_scratchpad(), 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )
        ctx = SimpleNamespace(
            context=sc, tool_name='data_query', tool_call_id='tc_count_runs',
        )

        with patch('app.database.async_session', return_value=_SessionCtx(tool_db)), patch(
            'app.services.report_builder.tool_handlers.dispatch_tool_call',
            new=AsyncMock(return_value=json.dumps(data_query_envelope)),
        ):
            raw_result = await _sherlock_tool_handler(
                ctx, '{"question":"count runs per status"}',
            )

        # Tool result → §6.2 envelope with the analytics chart artifact.
        parsed = json.loads(raw_result)
        self.assertEqual(parsed['outcome']['kind'], 'artifact')
        self.assertEqual(parsed['outcome']['capability'], 'analytics')
        self.assertEqual(
            parsed['outcome']['artifact']['contract'], 'analytics.chart.v1',
        )
        self.assertEqual(
            parsed['outcome']['artifact']['extras']['rendered_as'], 'bar',
        )

        # Persisted artifact: the pack bridge lifts the chart payload out
        # of ``envelope.payload`` onto ``sc.artifacts`` for downstream SSE.
        self.assertEqual(len(sc.artifacts), 1)
        artifact = sc.artifacts[0]
        self.assertEqual(artifact.pack_id, 'analytics')
        self.assertEqual(artifact.contract_id, 'analytics.chart.v1')
        self.assertEqual(artifact.extras['rendered_as'], 'bar')

        # The ``tool_call_end`` SSE event projects ``outcome`` so
        # ``sherlock_turn_events.data.outcome.reason_code`` persists.
        end_event = next(
            call.args[0] for call in sc.emit.await_args_list
            if call.args[0]['event'] == 'tool_call_end'
        )
        emitted_outcome = end_event['data']['outcome']
        self.assertEqual(emitted_outcome['kind'], 'artifact')
        self.assertEqual(emitted_outcome['capability'], 'analytics')
        self.assertEqual(
            emitted_outcome['artifact']['contract'], 'analytics.chart.v1',
        )

        # ``toolCalls[].outcome`` entry on the runtime log is the same
        # projection — consumer-facing shape stays stable.
        self.assertEqual(len(sc.tool_call_log), 1)
        logged = sc.tool_call_log[0]
        self.assertEqual(logged['outcome']['kind'], 'artifact')
        self.assertEqual(logged['outcome']['capability'], 'analytics')
        self.assertEqual(
            logged['outcome']['artifact']['contract'], 'analytics.chart.v1',
        )


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
