"""Multi-evaluator aggregation unit tests for InsideSalesAggregator.

Covers:
- isMainMetric (camelCase) is honored to discover the primary field.
- aggregate_multi_evaluator produces one perEvaluator entry per evaluator_id.
- Each evaluator's aggregate pulls the correct thread output (keyed by evaluator_id),
  not just evaluations[0].
"""
from __future__ import annotations

import unittest

from app.services.reports.inside_sales_aggregator import (
    InsideSalesAggregator,
    aggregate_multi_evaluator,
)


def _thread(call_id: str, goodflip_output: dict, feelsy_output: dict) -> dict:
    return {
        "thread_id": call_id,
        "success_status": True,
        "result": {
            "evaluations": [
                {"evaluator_id": "gf", "evaluator_name": "GoodFlip QA", "output": goodflip_output},
                {"evaluator_id": "fe", "evaluator_name": "Feelsy", "output": feelsy_output},
            ],
            "call_metadata": {"agent_id": "agent-1"},
        },
    }


GOODFLIP_SCHEMA = [
    {"key": "overall_score", "type": "number", "isMainMetric": True},
    {"key": "greeting_score", "type": "number"},
]

FEELSY_SCHEMA = [
    {"key": "emotional_intelligence_score", "type": "number", "isMainMetric": True},
    {"key": "warmth", "type": "number"},
]


class InsideSalesAggregatorMultiEvaluatorTests(unittest.TestCase):
    def test_single_evaluator_picks_up_isMainMetric_key(self):
        threads = [
            _thread("c1", {"overall_score": 40, "greeting_score": 8},
                    {"emotional_intelligence_score": 60, "warmth": 70}),
        ]
        agg = InsideSalesAggregator(
            threads, GOODFLIP_SCHEMA, {"agent-1": "Agent One"}, evaluator_id="gf",
        ).aggregate()
        self.assertEqual(agg["runSummary"]["avgQaScore"], 40.0)
        self.assertIn("greeting_score", agg["dimensionBreakdown"])

    def test_isMainMetric_default_falls_back_to_overall_score(self):
        """When no field has isMainMetric set, overall_score is the safe default."""
        schema_without_main = [
            {"key": "overall_score", "type": "number"},
            {"key": "greeting_score", "type": "number"},
        ]
        threads = [
            _thread("c1", {"overall_score": 55, "greeting_score": 9},
                    {"emotional_intelligence_score": 60, "warmth": 70}),
        ]
        agg = InsideSalesAggregator(
            threads, schema_without_main, {"agent-1": "Agent One"}, evaluator_id="gf",
        ).aggregate()
        self.assertEqual(agg["runSummary"]["avgQaScore"], 55.0)

    def test_multi_evaluator_aggregate_produces_per_evaluator_entries(self):
        threads = [
            _thread("c1", {"overall_score": 40, "greeting_score": 8},
                    {"emotional_intelligence_score": 60, "warmth": 70}),
            _thread("c2", {"overall_score": 30, "greeting_score": 6},
                    {"emotional_intelligence_score": 70, "warmth": 80}),
        ]
        result = aggregate_multi_evaluator(
            threads,
            output_schemas={"gf": GOODFLIP_SCHEMA, "fe": FEELSY_SCHEMA},
            agent_names={"agent-1": "Agent One"},
            evaluator_names={"gf": "GoodFlip QA", "fe": "Feelsy"},
        )
        self.assertIn("perEvaluator", result)
        self.assertIn("combined", result)
        self.assertEqual(set(result["perEvaluator"].keys()), {"gf", "fe"})

        goodflip = result["perEvaluator"]["gf"]
        feelsy = result["perEvaluator"]["fe"]

        self.assertEqual(goodflip["runSummary"]["avgQaScore"], 35.0)
        self.assertEqual(feelsy["runSummary"]["avgQaScore"], 65.0)
        self.assertEqual(goodflip["name"], "GoodFlip QA")
        self.assertEqual(feelsy["name"], "Feelsy")

    def test_each_evaluator_reads_its_own_output_not_evaluations_zero(self):
        """Regression: when a thread has evaluations[0]=GoodFlip, evaluations[1]=Feelsy,
        the Feelsy aggregate must read evaluations[1].output, not evaluations[0]."""
        threads = [
            _thread("c1", {"overall_score": 0, "greeting_score": 0},
                    {"emotional_intelligence_score": 99, "warmth": 90}),
        ]
        result = aggregate_multi_evaluator(
            threads,
            output_schemas={"gf": GOODFLIP_SCHEMA, "fe": FEELSY_SCHEMA},
            agent_names={},
            evaluator_names={"gf": "GoodFlip", "fe": "Feelsy"},
        )
        self.assertEqual(result["perEvaluator"]["gf"]["runSummary"]["avgQaScore"], 0.0)
        self.assertEqual(result["perEvaluator"]["fe"]["runSummary"]["avgQaScore"], 99.0)

    def test_empty_schemas_returns_empty_per_evaluator(self):
        threads = [_thread("c1", {"overall_score": 50}, {"emotional_intelligence_score": 60})]
        result = aggregate_multi_evaluator(threads, {}, {}, {})
        self.assertEqual(result["perEvaluator"], {})

    def test_null_agent_id_falls_back_to_display_name(self):
        # Regression: prod run 3a72eba6 crashed because rep_external_id was
        # JSON null for 20 calls. The aggregator must group those under the
        # display name (rep_label), never produce a None dict key or agentName.
        thread = {
            "thread_id": "c1",
            "success_status": True,
            "result": {
                "evaluations": [
                    {"evaluator_id": "gf", "output": {"overall_score": 70, "greeting_score": 8}},
                ],
                "call_metadata": {"rep_external_id": None, "rep_label": "Tushar Misra"},
            },
        }
        agg = InsideSalesAggregator(
            [thread], GOODFLIP_SCHEMA, agent_names={}, evaluator_id="gf",
        ).aggregate()
        self.assertEqual(set(agg["agentSlices"].keys()), {"Tushar Misra"})
        self.assertEqual(agg["agentSlices"]["Tushar Misra"]["agentName"], "Tushar Misra")
        self.assertNotIn(None, agg["agentSlices"])

    def test_null_agent_id_and_no_display_name_uses_unknown(self):
        thread = {
            "thread_id": "c1",
            "success_status": True,
            "result": {
                "evaluations": [
                    {"evaluator_id": "gf", "output": {"overall_score": 70, "greeting_score": 8}},
                ],
                "call_metadata": {"rep_external_id": None, "rep_label": ""},
            },
        }
        agg = InsideSalesAggregator(
            [thread], GOODFLIP_SCHEMA, agent_names={}, evaluator_id="gf",
        ).aggregate()
        self.assertEqual(set(agg["agentSlices"].keys()), {"unknown"})
        self.assertEqual(agg["agentSlices"]["unknown"]["agentName"], "unknown")

    def test_role_detail_number_fields_are_dimensions(self):
        # Regression: both seeded inside-sales evaluators tag every dimension
        # `role=detail`, but the previous filter required role to be falsy,
        # producing an empty dimensionBreakdown on every prod report.
        schema = [
            {"key": "overall_score", "type": "number", "role": "metric", "isMainMetric": True},
            {"key": "call_opening", "type": "number", "role": "detail"},
            {"key": "need_analysis", "type": "number", "role": "detail"},
            {"key": "ztp_evidence", "type": "text", "role": "detail"},
        ]
        thread = {
            "thread_id": "c1",
            "success_status": True,
            "result": {
                "evaluations": [
                    {"evaluator_id": "sal", "output": {
                        "overall_score": 75, "call_opening": 8, "need_analysis": 7,
                    }},
                ],
                "call_metadata": {"agent_id": "agent-1", "agent": "Tushar Misra"},
            },
        }
        agg = InsideSalesAggregator(
            [thread], schema, {"agent-1": "Tushar Misra"}, evaluator_id="sal",
        ).aggregate()
        self.assertEqual(
            set(agg["dimensionBreakdown"].keys()), {"call_opening", "need_analysis"},
        )
        self.assertEqual(agg["dimensionBreakdown"]["call_opening"]["avg"], 8.0)

    def test_null_overall_score_does_not_crash(self):
        thread = {
            "thread_id": "c1",
            "success_status": True,
            "result": {
                "evaluations": [
                    {"evaluator_id": "gf", "output": {"overall_score": None, "greeting_score": 8}},
                ],
                "call_metadata": {"agent_id": "agent-1"},
            },
        }
        agg = InsideSalesAggregator(
            [thread], GOODFLIP_SCHEMA, {"agent-1": "Agent One"}, evaluator_id="gf",
        ).aggregate()
        self.assertEqual(agg["runSummary"]["avgQaScore"], 0)
        self.assertEqual(agg["runSummary"]["evaluatedCalls"], 1)


if __name__ == "__main__":
    unittest.main()
