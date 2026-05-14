"""Unit tests for the signal derivation framework (Phase 11A/11B).

Covers all three strategy plugins — ``rule`` (and the seeded ``mql``
definition, which replaces the deleted ``compute_mql_score``),
``llm_transcript``, and ``llm_profile``.
"""
from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services.analytics.signal_derivation.base import StrategyContext
from app.services.analytics.signal_derivation.definition_seed import (
    MQL_DEFINITION_BODY,
)
from app.services.analytics.signal_derivation.llm_profile_strategy import (
    LlmProfileStrategy,
)
from app.services.analytics.signal_derivation.llm_transcript_strategy import (
    LlmTranscriptStrategy,
)
from app.services.analytics.signal_derivation.registry import get_strategy
from app.services.analytics.signal_derivation.rule_strategy import RuleStrategy

_TS = datetime(2026, 5, 14, tzinfo=timezone.utc)


def _lead(**attrs_first_seen) -> dict:
    """A dim_lead-shaped source row. ``city`` is a top-level identity
    column; the MQL-input keys live in ``attributes_at_first_seen``."""
    city = attrs_first_seen.pop("city", None)
    return {
        "lead_id": "L-1",
        "first_seen_at": _TS,
        "city": city,
        "attributes_at_first_seen": dict(attrs_first_seen),
    }


async def _derive(row: dict) -> dict[str, str | None]:
    strategy = get_strategy("rule")
    ctx = StrategyContext(tenant_id=uuid.uuid4(), app_id="inside-sales")
    signals = await strategy.derive(
        definition=MQL_DEFINITION_BODY, source_rows=[row], ctx=ctx
    )
    return {s.signal_type: s.signal_value for s in signals}


class RuleStrategyValidationTests(unittest.TestCase):
    def test_mql_seed_body_validates(self) -> None:
        # The shipped seed must always satisfy the strategy it targets.
        get_strategy("rule").validate(MQL_DEFINITION_BODY)

    def test_rejects_empty_signals(self) -> None:
        with self.assertRaises(Exception):
            RuleStrategy().validate({"signals": []})

    def test_rejects_unknown_predicate(self) -> None:
        with self.assertRaises(Exception):
            RuleStrategy().validate(
                {"signals": [{"signal_type": "x", "field": "city",
                              "predicate": "regex_match", "args": {}}]}
            )

    def test_rejects_duplicate_signal_type(self) -> None:
        with self.assertRaises(Exception):
            RuleStrategy().validate(
                {"signals": [
                    {"signal_type": "x", "field": "city",
                     "predicate": "in_set", "args": {"values": []}},
                    {"signal_type": "x", "field": "city",
                     "predicate": "in_set", "args": {"values": []}},
                ]}
            )

    def test_rejects_deep_field_path(self) -> None:
        with self.assertRaises(Exception):
            RuleStrategy().validate(
                {"signals": [{"signal_type": "x",
                              "field": "a.b.c", "predicate": "in_set",
                              "args": {"values": []}}]}
            )


class MqlBehaviourTests(unittest.IsolatedAsyncioTestCase):
    """The behaviour the old compute_mql_score guaranteed, asserted via
    the rule strategy + the seeded mql definition."""

    async def test_all_five_signals_fire(self) -> None:
        out = await _derive(_lead(
            age_group="31-40",
            city="Mumbai",
            condition="Type 2 Diabetes",
            hba1c_band="6.5 - 8.0",
            intent_to_pay="yes, interested",
        ))
        for st in ("mql_age", "mql_city", "mql_condition",
                   "mql_hba1c", "mql_intent"):
            self.assertEqual(out[st], "true", st)
        self.assertEqual(out["mql_score"], "5")

    async def test_nothing_fires_on_empty_lead(self) -> None:
        out = await _derive(_lead())
        for st in ("mql_age", "mql_city", "mql_condition",
                   "mql_hba1c", "mql_intent"):
            self.assertEqual(out[st], "false", st)
        self.assertEqual(out["mql_score"], "0")

    async def test_age_band_out_of_range(self) -> None:
        out = await _derive(_lead(age_group="18-30"))
        self.assertEqual(out["mql_age"], "false")

    async def test_city_case_insensitive(self) -> None:
        out = await _derive(_lead(city="PUNE"))
        self.assertEqual(out["mql_city"], "true")

    async def test_city_not_in_target_list(self) -> None:
        out = await _derive(_lead(city="Tumkur"))
        self.assertEqual(out["mql_city"], "false")

    async def test_condition_substring_match(self) -> None:
        out = await _derive(_lead(condition="diagnosed with PCOS last year"))
        self.assertEqual(out["mql_condition"], "true")

    async def test_hba1c_below_threshold(self) -> None:
        out = await _derive(_lead(hba1c_band="5.0 - 5.6 (normal)"))
        self.assertEqual(out["mql_hba1c"], "false")

    async def test_hba1c_at_threshold(self) -> None:
        out = await _derive(_lead(hba1c_band="5.7 - 6.4 (pre-diabetes)"))
        self.assertEqual(out["mql_hba1c"], "true")

    async def test_intent_negative_does_not_fire(self) -> None:
        out = await _derive(_lead(intent_to_pay="no, not right now"))
        self.assertEqual(out["mql_intent"], "false")

    async def test_intent_present_and_positive_fires(self) -> None:
        out = await _derive(_lead(intent_to_pay="maybe later"))
        self.assertEqual(out["mql_intent"], "true")

    async def test_partial_score(self) -> None:
        out = await _derive(_lead(city="Mumbai", age_group="31-40"))
        self.assertEqual(out["mql_score"], "2")

    async def test_signal_value_numeric_mirrors_boolean(self) -> None:
        strategy = get_strategy("rule")
        ctx = StrategyContext(tenant_id=uuid.uuid4(), app_id="inside-sales")
        signals = await strategy.derive(
            definition=MQL_DEFINITION_BODY,
            source_rows=[_lead(city="Mumbai")],
            ctx=ctx,
        )
        by_type = {s.signal_type: s for s in signals}
        self.assertEqual(by_type["mql_city"].signal_value_numeric, Decimal(1))
        self.assertEqual(by_type["mql_age"].signal_value_numeric, Decimal(0))
        self.assertEqual(by_type["mql_score"].signal_value_numeric, Decimal(1))
        # detected_at is the source row's first_seen_at — stable across reruns.
        self.assertEqual(by_type["mql_city"].detected_at, _TS)

    async def test_row_without_lead_identity_is_skipped(self) -> None:
        strategy = get_strategy("rule")
        ctx = StrategyContext(tenant_id=uuid.uuid4(), app_id="inside-sales")
        signals = await strategy.derive(
            definition=MQL_DEFINITION_BODY,
            source_rows=[{"lead_id": None, "first_seen_at": _TS,
                          "attributes_at_first_seen": {}}],
            ctx=ctx,
        )
        self.assertEqual(signals, [])


class LlmTranscriptStrategyTests(unittest.IsolatedAsyncioTestCase):
    """Pure projection of eval-run ``result.signals`` into DerivedSignals."""

    def _run(self):
        return SimpleNamespace(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            app_id="inside-sales",
            completed_at=_TS,
            created_at=_TS,
        )

    def _thread(self, signals):
        return SimpleNamespace(
            id=42,
            thread_id="ACT-1",
            result={"signals": signals, "call_metadata": {"lead_id": "L-9"}},
        )

    async def test_projects_signals_with_lineage(self) -> None:
        run = self._run()
        thread = self._thread([
            {"signal_type": "purchase_intent", "signal_value": "high",
             "confidence": 0.9},
            {"signal_type": "purchase_intent", "signal_value": "medium"},
        ])
        ctx = StrategyContext(
            tenant_id=run.tenant_id, app_id="inside-sales", eval_run=run
        )
        out = await get_strategy("llm_transcript").derive(
            definition={}, source_rows=[thread], ctx=ctx
        )
        # Two signals of the SAME signal_type survive — distinct ordinals.
        self.assertEqual(len(out), 2)
        self.assertEqual({s.ordinal for s in out}, {0, 1})
        self.assertTrue(all(s.lead_id == "L-9" for s in out))
        self.assertTrue(all(s.eval_run_id == run.id for s in out))
        self.assertTrue(all(s.thread_evaluation_id == 42 for s in out))
        self.assertTrue(all(s.detected_at == _TS for s in out))

    async def test_requires_eval_run_in_ctx(self) -> None:
        ctx = StrategyContext(tenant_id=uuid.uuid4(), app_id="inside-sales")
        with self.assertRaises(Exception):
            await LlmTranscriptStrategy().derive(
                definition={}, source_rows=[], ctx=ctx
            )


class LlmProfileStrategyTests(unittest.IsolatedAsyncioTestCase):
    """Per-lead LLM extraction over the normalized dim_lead surface."""

    def _lead(self, **attrs):
        return {
            "lead_id": attrs.pop("lead_id", "L-1"),
            "updated_at": _TS,
            "first_seen_at": _TS,
            "city": attrs.pop("city", "Mumbai"),
            "latest_stage_observed": attrs.pop("stage", "QL"),
            "assigned_rep_label": None,
            "attributes_at_first_seen": attrs.pop("afs", {"condition": "diabetes"}),
            "attributes": {},
        }

    def _provider(self, signals):
        return SimpleNamespace(
            generate_json=AsyncMock(return_value={"signals": signals})
        )

    async def test_requires_llm_provider(self) -> None:
        ctx = StrategyContext(tenant_id=uuid.uuid4(), app_id="inside-sales")
        with self.assertRaises(Exception):
            await LlmProfileStrategy().derive(
                definition={}, source_rows=[self._lead()], ctx=ctx
            )

    async def test_derives_and_stamps_sync_run_id(self) -> None:
        sync_run_id = uuid.uuid4()
        provider = self._provider([
            {"signal_type": "purchase_intent", "signal_value": "high",
             "confidence": 0.8},
        ])
        ctx = StrategyContext(
            tenant_id=uuid.uuid4(), app_id="inside-sales",
            llm_provider=provider, sync_run_id=sync_run_id,
        )
        out = await get_strategy("llm_profile").derive(
            definition={}, source_rows=[self._lead()], ctx=ctx
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].signal_type, "purchase_intent")
        self.assertEqual(out[0].sync_run_id, sync_run_id)
        self.assertEqual(out[0].detected_at, _TS)  # source-state-derived

    async def test_skips_lead_with_no_payload(self) -> None:
        provider = self._provider([])
        ctx = StrategyContext(
            tenant_id=uuid.uuid4(), app_id="inside-sales",
            llm_provider=provider, sync_run_id=uuid.uuid4(),
        )
        empty_lead = self._lead(city=None, stage=None, afs={})
        out = await get_strategy("llm_profile").derive(
            definition={}, source_rows=[empty_lead], ctx=ctx
        )
        self.assertEqual(out, [])
        provider.generate_json.assert_not_awaited()  # short-circuited

    async def test_one_bad_lead_does_not_sink_the_batch(self) -> None:
        good = self._lead(lead_id="L-good")
        bad = self._lead(lead_id="L-bad")
        provider = SimpleNamespace(
            generate_json=AsyncMock(side_effect=[
                RuntimeError("LLM exploded"),
                {"signals": [{"signal_type": "purchase_intent"}]},
            ])
        )
        ctx = StrategyContext(
            tenant_id=uuid.uuid4(), app_id="inside-sales",
            llm_provider=provider, sync_run_id=uuid.uuid4(),
        )
        out = await get_strategy("llm_profile").derive(
            definition={}, source_rows=[bad, good], ctx=ctx
        )
        # The bad lead is logged + skipped; the good one still produces a row.
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].lead_id, "L-good")


if __name__ == "__main__":
    unittest.main()
