"""Unit tests for the granularity graph.

Each test builds a small synthetic ``WorkbenchCatalog`` so the assertions
focus on the graph behavior, not on any one app's content.
"""
from __future__ import annotations

import unittest

from app.services.chat_engine.granularity_graph import (
    aggregate_at_lowest_grain,
    build_granularity_graph,
)
from app.services.chat_engine.workbench_catalog import parse_workbench_catalog


def _two_table_chain() -> dict:
    """fact_evaluation -[many_to_one]-> agg_evaluation_run"""
    return {
        "name": "test_chain",
        "tables": {
            "agg_evaluation_run": {
                "table_kind": "aggregate",
                "base_table": {"schema": "analytics", "table": "agg_evaluation_run"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["run_id"]},
                "dimensions": [{"name": "run_id"}],
            },
            "fact_evaluation": {
                "table_kind": "fact",
                "base_table": {"schema": "analytics", "table": "fact_evaluation"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["run_id", "item_id"]},
                "dimensions": [{"name": "run_id"}, {"name": "item_id"}],
                "facts": [{"name": "result_score"}],
            },
        },
        "relationships": [
            {
                "name": "fact_to_agg",
                "left_table": "fact_evaluation",
                "right_table": "agg_evaluation_run",
                "relationship_columns": [
                    {"left_column": "run_id", "right_column": "run_id"}
                ],
                "join_type": "inner",
                "relationship_type": "many_to_one",
            }
        ],
        "verified_queries": [
            {"name": "q1", "question": "?", "sql": "SELECT 1"},
            {"name": "q2", "question": "?", "sql": "SELECT 2"},
            {"name": "q3", "question": "?", "sql": "SELECT 3"},
        ],
    }


def _chasm_shape() -> dict:
    """fact_lead_activity, fact_lead_stage_transition -> dim_lead"""
    return {
        "name": "test_chasm",
        "tables": {
            "dim_lead": {
                "table_kind": "dimension",
                "base_table": {"schema": "analytics", "table": "dim_lead"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["lead_id"]},
                "dimensions": [{"name": "lead_id"}],
            },
            "fact_lead_activity": {
                "table_kind": "fact",
                "base_table": {"schema": "analytics", "table": "fact_lead_activity"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["id"]},
                "dimensions": [{"name": "lead_id"}],
            },
            "fact_lead_stage_transition": {
                "table_kind": "fact",
                "base_table": {
                    "schema": "analytics",
                    "table": "fact_lead_stage_transition",
                },
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["id"]},
                "dimensions": [{"name": "lead_id"}],
            },
        },
        "relationships": [
            {
                "name": "act_to_lead",
                "left_table": "fact_lead_activity",
                "right_table": "dim_lead",
                "relationship_columns": [
                    {"left_column": "lead_id", "right_column": "lead_id"}
                ],
                "join_type": "inner",
                "relationship_type": "many_to_one",
            },
            {
                "name": "stage_to_lead",
                "left_table": "fact_lead_stage_transition",
                "right_table": "dim_lead",
                "relationship_columns": [
                    {"left_column": "lead_id", "right_column": "lead_id"}
                ],
                "join_type": "inner",
                "relationship_type": "many_to_one",
            },
        ],
        "verified_queries": [
            {"name": "q1", "question": "?", "sql": "SELECT 1"},
            {"name": "q2", "question": "?", "sql": "SELECT 2"},
            {"name": "q3", "question": "?", "sql": "SELECT 3"},
        ],
    }


def _one_to_many_shape() -> dict:
    """dim_lead -[one_to_many]-> fact_lead_activity."""
    return {
        "name": "test_one_to_many",
        "tables": {
            "dim_lead": {
                "table_kind": "dimension",
                "base_table": {"schema": "analytics", "table": "dim_lead"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["lead_id"]},
                "dimensions": [{"name": "lead_id"}],
            },
            "fact_lead_activity": {
                "table_kind": "fact",
                "base_table": {"schema": "analytics", "table": "fact_lead_activity"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["source_activity_id"]},
                "dimensions": [
                    {"name": "lead_id"},
                    {"name": "source_activity_id"},
                ],
            },
        },
        "relationships": [
            {
                "name": "lead_to_activity",
                "left_table": "dim_lead",
                "right_table": "fact_lead_activity",
                "relationship_columns": [
                    {"left_column": "lead_id", "right_column": "lead_id"}
                ],
                "join_type": "inner",
                "relationship_type": "one_to_many",
            }
        ],
        "verified_queries": [
            {"name": "q1", "question": "?", "sql": "SELECT 1"},
            {"name": "q2", "question": "?", "sql": "SELECT 2"},
            {"name": "q3", "question": "?", "sql": "SELECT 3"},
        ],
    }


def _composite_key_shape() -> dict:
    """fact_evaluation_criterion -[many_to_one]-> fact_evaluation on two keys."""
    return {
        "name": "test_composite",
        "tables": {
            "fact_evaluation": {
                "table_kind": "fact",
                "base_table": {"schema": "analytics", "table": "fact_evaluation"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["run_id", "item_id"]},
                "dimensions": [{"name": "run_id"}, {"name": "item_id"}],
            },
            "fact_evaluation_criterion": {
                "table_kind": "fact",
                "base_table": {
                    "schema": "analytics",
                    "table": "fact_evaluation_criterion",
                },
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["run_id", "item_id", "criterion_id"]},
                "dimensions": [
                    {"name": "run_id"},
                    {"name": "item_id"},
                    {"name": "criterion_id"},
                ],
            },
        },
        "relationships": [
            {
                "name": "criterion_to_fact_eval",
                "left_table": "fact_evaluation_criterion",
                "right_table": "fact_evaluation",
                "relationship_columns": [
                    {"left_column": "run_id", "right_column": "run_id"},
                    {"left_column": "item_id", "right_column": "item_id"},
                ],
                "join_type": "inner",
                "relationship_type": "many_to_one",
            }
        ],
        "verified_queries": [
            {"name": "q1", "question": "?", "sql": "SELECT 1"},
            {"name": "q2", "question": "?", "sql": "SELECT 2"},
            {"name": "q3", "question": "?", "sql": "SELECT 3"},
        ],
    }


class BuildGraphTests(unittest.TestCase):
    def test_nodes_and_edges_built_from_chain(self) -> None:
        c = parse_workbench_catalog(_two_table_chain())
        g = build_granularity_graph(c)
        self.assertEqual(
            sorted(g.nodes.keys()),
            ["agg_evaluation_run", "fact_evaluation"],
        )
        self.assertEqual(len(g.edges), 1)
        e = g.edges[0]
        self.assertEqual(e.many, "fact_evaluation")
        self.assertEqual(e.one, "agg_evaluation_run")
        self.assertEqual(e.columns, (("run_id", "run_id"),))

    def test_declared_join_exists_in_either_direction(self) -> None:
        c = parse_workbench_catalog(_two_table_chain())
        g = build_granularity_graph(c)
        self.assertTrue(g.declared_join_exists("fact_evaluation", "agg_evaluation_run"))
        self.assertTrue(g.declared_join_exists("agg_evaluation_run", "fact_evaluation"))
        self.assertFalse(g.declared_join_exists("fact_evaluation", "dim_lead"))

    def test_one_to_many_relationship_is_inverted_to_many_to_one_edge(self) -> None:
        c = parse_workbench_catalog(_one_to_many_shape())
        g = build_granularity_graph(c)
        self.assertEqual(len(g.edges), 1)
        edge = g.edges[0]
        self.assertEqual(edge.many, "fact_lead_activity")
        self.assertEqual(edge.one, "dim_lead")
        self.assertEqual(edge.columns, (("lead_id", "lead_id"),))

    def test_composite_relationship_preserves_every_key_pair(self) -> None:
        c = parse_workbench_catalog(_composite_key_shape())
        g = build_granularity_graph(c)
        edge = g.edge_for("fact_evaluation_criterion", "fact_evaluation")
        self.assertIsNotNone(edge)
        assert edge is not None
        self.assertEqual(
            edge.columns,
            (("run_id", "run_id"), ("item_id", "item_id")),
        )


class LowestGrainTests(unittest.TestCase):
    def test_finer_table_is_lowest(self) -> None:
        g = build_granularity_graph(parse_workbench_catalog(_two_table_chain()))
        self.assertEqual(
            g.lowest_grain_table(["agg_evaluation_run", "fact_evaluation"]),
            "fact_evaluation",
        )

    def test_single_table_input_returns_itself(self) -> None:
        g = build_granularity_graph(parse_workbench_catalog(_two_table_chain()))
        self.assertEqual(g.lowest_grain_table(["fact_evaluation"]), "fact_evaluation")

    def test_unknown_tables_skipped(self) -> None:
        g = build_granularity_graph(parse_workbench_catalog(_two_table_chain()))
        self.assertIsNone(g.lowest_grain_table(["nope"]))


class FanTrapTests(unittest.TestCase):
    def test_fan_trap_detected_on_many_to_one_pair(self) -> None:
        g = build_granularity_graph(parse_workbench_catalog(_two_table_chain()))
        fan = g.fan_trap_path(["agg_evaluation_run", "fact_evaluation"])
        self.assertEqual(fan, ("agg_evaluation_run", "fact_evaluation"))

    def test_no_fan_trap_on_single_table(self) -> None:
        g = build_granularity_graph(parse_workbench_catalog(_two_table_chain()))
        self.assertIsNone(g.fan_trap_path(["fact_evaluation"]))


class ChasmTrapTests(unittest.TestCase):
    def test_chasm_detected_on_two_facts_through_dim(self) -> None:
        g = build_granularity_graph(parse_workbench_catalog(_chasm_shape()))
        chasm = g.chasm_trap_path([
            "fact_lead_activity",
            "dim_lead",
            "fact_lead_stage_transition",
        ])
        self.assertIsNotNone(chasm)
        assert chasm is not None
        self.assertEqual(chasm[1], "dim_lead")
        self.assertIn(chasm[0], {"fact_lead_activity", "fact_lead_stage_transition"})
        self.assertIn(chasm[2], {"fact_lead_activity", "fact_lead_stage_transition"})

    def test_no_chasm_on_pair_join(self) -> None:
        g = build_granularity_graph(parse_workbench_catalog(_chasm_shape()))
        self.assertIsNone(g.chasm_trap_path(["fact_lead_activity", "dim_lead"]))


class AggregatePlacementTests(unittest.TestCase):
    def test_aggregate_on_finest_grain_ok(self) -> None:
        g = build_granularity_graph(parse_workbench_catalog(_two_table_chain()))
        self.assertTrue(
            aggregate_at_lowest_grain(
                g,
                tables_in_query=["fact_evaluation", "agg_evaluation_run"],
                measured_tables=["fact_evaluation"],
            )
        )

    def test_aggregate_on_coarser_grain_flagged(self) -> None:
        g = build_granularity_graph(parse_workbench_catalog(_two_table_chain()))
        self.assertFalse(
            aggregate_at_lowest_grain(
                g,
                tables_in_query=["fact_evaluation", "agg_evaluation_run"],
                measured_tables=["agg_evaluation_run"],
            )
        )


if __name__ == "__main__":
    unittest.main()
