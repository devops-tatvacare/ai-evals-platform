"""Phase 1A — manifest projection narrows the data_specialist's schema.

Plan §Tests (Phase 1):
- aggregate intent + voice-rx manifest yields a schema that does NOT
  contain transactional ``platform.evaluation_runs``;
- detail/identity intent does contain it.

These tests run against the real shipped manifests so a future tag
edit (or a missing ``layer:``) surfaces here.
"""
from __future__ import annotations

import unittest

from app.services.chat_engine.manifest import (
    _clear_manifest_cache_for_tests,
    get_manifest,
)
from app.services.chat_engine.sql_agent import (
    _allowed_tables,
    _build_schema_context,
    _column_role_hints,
    load_semantic_model,
)
from app.services.sherlock_v3.intent_classifier import classify_intent
from app.services.sherlock_v3.manifest_projection import project_for_intent


def _grounding_for(app_id: str, question: str):
    _clear_manifest_cache_for_tests()
    sm = load_semantic_model(app_id)
    sc = _build_schema_context(sm, None)
    at = sorted(_allowed_tables(sm))
    hints = _column_role_hints(sc, app_id=app_id)
    mf = get_manifest(app_id)
    return project_for_intent(
        app_id=app_id,
        user_message=question,
        intent_class=classify_intent(question),
        manifest=mf,
        schema_context=sc,
        full_allowed_tables=at,
        full_role_hints=hints,
    )


class AggregateIntentExcludesTransactionalTests(unittest.TestCase):
    def test_voice_rx_aggregate_does_not_expose_evaluation_runs(self) -> None:
        g = _grounding_for('voice-rx', 'Show evaluation runs by status as a chart')
        self.assertEqual(g.intent_class, 'aggregate')
        self.assertNotIn('evaluation_runs', g.allowed_tables_hint)
        self.assertNotIn('evaluation_runs', g.projected_tables)
        self.assertIn('agg_evaluation_run', g.allowed_tables_hint)


class DetailAndIdentityIntentIncludeTransactionalTests(unittest.TestCase):
    def test_voice_rx_detail_intent_exposes_evaluation_runs(self) -> None:
        g = _grounding_for('voice-rx', 'Find the most recent failed run')
        self.assertEqual(g.intent_class, 'detail')
        self.assertIn('evaluation_runs', g.allowed_tables_hint)
        # Detail intent must NOT pull in fact tables.
        self.assertNotIn('fact_evaluation', g.allowed_tables_hint)
        self.assertNotIn('agg_evaluation_run', g.allowed_tables_hint)

    def test_inside_sales_identity_intent_keeps_identity_layers_only(self) -> None:
        # Pure identity question — no negative usage, no aggregation.
        # Phase 1A guarantees the projection trims AGGREGATE / FACT
        # layers; whether ``platform.evaluators`` actually shows up in
        # the rendered hint depends on the per-app semantic_model
        # exposing it (a Phase 2 / Phase 3 concern). The contract here:
        # whatever the manifest tagged identity/transactional survives,
        # everything else is gone.
        g = _grounding_for('inside-sales', 'List all evaluators')
        self.assertEqual(g.intent_class, 'identity')
        self.assertEqual(
            g.allowed_layers, frozenset({'identity', 'transactional'}),
        )
        self.assertNotIn('fact_evaluation', g.allowed_tables_hint)
        self.assertNotIn('fact_evaluation_criterion', g.allowed_tables_hint)
        self.assertNotIn('agg_evaluation_run', g.allowed_tables_hint)
        # Transactional table must be reachable.
        self.assertIn('evaluation_runs', g.allowed_tables_hint)


class FactGrainIntentExposesFactTables(unittest.TestCase):
    def test_fact_grain_keeps_fact_drops_aggregate(self) -> None:
        g = _grounding_for('voice-rx', 'Pass/fail by evaluator')
        self.assertEqual(g.intent_class, 'fact_grain')
        self.assertIn('fact_evaluation', g.allowed_tables_hint)
        self.assertNotIn('agg_evaluation_run', g.allowed_tables_hint)
        self.assertNotIn('evaluation_runs', g.allowed_tables_hint)


class MixedIntentReturnsUnion(unittest.TestCase):
    def test_mixed_keeps_both_identity_and_fact_layers(self) -> None:
        g = _grounding_for('voice-rx', 'Show evaluators not used this month')
        self.assertEqual(g.intent_class, 'mixed')
        # Mixed = full union; nothing is hidden.
        self.assertIn('evaluation_runs', g.allowed_tables_hint)
        self.assertIn('fact_evaluation', g.allowed_tables_hint)
        self.assertIn('agg_evaluation_run', g.allowed_tables_hint)


class TelemetryShapeTests(unittest.TestCase):
    def test_grounding_telemetry_dict_has_required_keys(self) -> None:
        g = _grounding_for('voice-rx', 'Pass rate trend by week')
        td = g.telemetry_dict()
        self.assertEqual(td['intent_class'], 'aggregate')
        self.assertIn('analytics_aggregate', td['allowed_layers'])
        self.assertIn('projected_tables', td)
        self.assertGreater(td['original_table_count'], 0)
        self.assertGreaterEqual(td['original_table_count'], td['projected_table_count'])


if __name__ == '__main__':
    unittest.main()
