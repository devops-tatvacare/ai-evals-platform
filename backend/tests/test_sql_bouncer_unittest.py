"""Unit tests for sql_bouncer — every rule, positive + negative.

The bouncer is deterministic: same input, same verdict, no I/O. Tests
build a synthetic ``WorkbenchCatalog`` (a tiny inside-sales) so the
assertions remain fast even with the heavy sqlglot parser.
"""
from __future__ import annotations

import unittest

from app.services.chat_engine.granularity_graph import build_granularity_graph
from app.services.chat_engine.sql_bouncer import (
    ROW_CAPS,
    apply_server_limit,
    check_after,
    check_before,
    expand_logical_columns,
)
from app.services.chat_engine.workbench_catalog import parse_workbench_catalog


# ── Test catalog fixture ──────────────────────────────────────────────


def _catalog_yaml() -> dict:
    return {
        "name": "test_catalog",
        "tables": {
            "agg_evaluation_run": {
                "table_kind": "aggregate",
                "base_table": {"schema": "analytics", "table": "agg_evaluation_run"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["run_id"]},
                "dimensions": [
                    {"name": "run_id"},
                    {"name": "run_name"},
                    {"name": "eval_type"},
                ],
                "facts": [{"name": "avg_score"}, {"name": "thread_count"}],
            },
            "fact_evaluation": {
                "table_kind": "fact",
                "base_table": {"schema": "analytics", "table": "fact_evaluation"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["run_id", "item_id", "evaluator_id"]},
                "dimensions": [
                    {"name": "run_id"},
                    {"name": "item_id"},
                    {"name": "evaluator_id"},
                    {"name": "agent"},
                    {"name": "direction", "is_enum": True, "sample_values": ["inbound", "outbound"]},
                    {
                        "name": "call_opening_score",
                        "expr": "(result_detail->>'call_opening')::numeric",
                        "source_table": "fact_evaluation",
                    },
                ],
                "time_dimensions": [{"name": "created_at"}],
                "facts": [{"name": "result_score"}],
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
                    {"name": "criterion_label"},
                    {"name": "passed"},
                ],
            },
            "dim_lead": {
                "table_kind": "dimension",
                "base_table": {"schema": "analytics", "table": "dim_lead"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["lead_id"]},
                "dimensions": [{"name": "lead_id"}, {"name": "latest_stage_observed"}],
            },
            "fact_lead_activity": {
                "table_kind": "fact",
                "base_table": {"schema": "analytics", "table": "fact_lead_activity"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["id"]},
                "dimensions": [{"name": "lead_id"}, {"name": "activity_type"}],
            },
            "fact_lead_stage_transition": {
                "table_kind": "fact",
                "base_table": {
                    "schema": "analytics",
                    "table": "fact_lead_stage_transition",
                },
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["id"]},
                "dimensions": [{"name": "lead_id"}, {"name": "to_stage"}],
            },
        },
        "relationships": [
            {
                "name": "fact_eval_to_agg_run",
                "left_table": "fact_evaluation",
                "right_table": "agg_evaluation_run",
                "relationship_columns": [
                    {"left_column": "run_id", "right_column": "run_id"}
                ],
                "join_type": "inner",
                "relationship_type": "many_to_one",
            },
            {
                "name": "lead_activity_to_lead",
                "left_table": "fact_lead_activity",
                "right_table": "dim_lead",
                "relationship_columns": [
                    {"left_column": "lead_id", "right_column": "lead_id"}
                ],
                "join_type": "inner",
                "relationship_type": "many_to_one",
            },
            {
                "name": "stage_transition_to_lead",
                "left_table": "fact_lead_stage_transition",
                "right_table": "dim_lead",
                "relationship_columns": [
                    {"left_column": "lead_id", "right_column": "lead_id"}
                ],
                "join_type": "inner",
                "relationship_type": "many_to_one",
            },
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
            },
        ],
        "verified_queries": [
            {"name": "q1", "question": "?", "sql": "SELECT 1"},
            {"name": "q2", "question": "?", "sql": "SELECT 2"},
            {"name": "q3", "question": "?", "sql": "SELECT 3"},
        ],
    }


def _setup():
    catalog = parse_workbench_catalog(_catalog_yaml())
    graph = build_granularity_graph(catalog)
    return catalog, graph


def _ok_sql() -> str:
    return (
        "SELECT agent, ROUND(AVG(result_score)::numeric, 2) AS avg_score "
        "FROM analytics.fact_evaluation "
        "WHERE tenant_id = :tenant_id AND app_id = :app_id "
        "GROUP BY agent"
    )


def _run_before(sql: str, *, grain=("agent",), bound="small"):
    catalog, graph = _setup()
    return check_before(
        sql=sql,
        declared_grain=list(grain),
        expected_row_bound=bound,
        catalog=catalog,
        graph=graph,
    )


# ── R1: read-only / single statement / no comments ────────────────────


class R1ReadOnlyTests(unittest.TestCase):
    def test_clean_select_passes_R1(self) -> None:
        v = _run_before(_ok_sql())
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_empty_sql_rejected(self) -> None:
        v = _run_before("")
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertTrue(v.diagnostic.rule_id.startswith("R1"))

    def test_ddl_rejected(self) -> None:
        v = _run_before("DROP TABLE analytics.fact_evaluation")
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R1.ddl_not_allowed")

    def test_dml_rejected(self) -> None:
        v = _run_before(
            "DELETE FROM analytics.fact_evaluation WHERE tenant_id = :tenant_id"
        )
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R1.dml_not_allowed")

    def test_stacked_statements_rejected(self) -> None:
        v = _run_before(_ok_sql() + "; SELECT 1")
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R1.stacked_statements")

    def test_line_comments_rejected(self) -> None:
        sql = (
            "SELECT agent -- naughty\n"
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        v = _run_before(sql, grain=("agent",), bound="small")
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R1.no_comments")

    def test_block_comments_rejected(self) -> None:
        sql = (
            "SELECT agent /* sneaky */ "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        v = _run_before(sql, grain=("agent",), bound="small")
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R1.no_comments")

    def test_trailing_semicolon_allowed(self) -> None:
        v = _run_before(_ok_sql() + ";")
        self.assertEqual(v.status, "ok", msg=v.diagnostic)


# ── R2: allowed tables ────────────────────────────────────────────────


class R2AllowedTablesTests(unittest.TestCase):
    def test_unknown_table_rejected(self) -> None:
        sql = (
            "SELECT * FROM analytics.evaluation_runs "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        v = _run_before(sql)
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R2.allowed_tables")
        self.assertIn("evaluation_runs", v.diagnostic.offending_tables)

    def test_information_schema_rejected(self) -> None:
        v = _run_before("SELECT table_name FROM information_schema.tables")
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        # Could be caught by R2.allowed_tables (table 'tables') first;
        # both are valid rejections.
        self.assertTrue(v.diagnostic.rule_id.startswith("R2"))

    def test_pg_catalog_rejected(self) -> None:
        v = _run_before("SELECT * FROM pg_catalog.pg_class")
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertTrue(v.diagnostic.rule_id.startswith("R2"))


# ── R3: declared joins ────────────────────────────────────────────────


class R3DeclaredJoinsTests(unittest.TestCase):
    def test_declared_join_passes(self) -> None:
        sql = (
            "SELECT fe.agent, COUNT(*) AS n "
            "FROM analytics.fact_evaluation fe "
            "JOIN analytics.agg_evaluation_run ar ON ar.run_id = fe.run_id "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id "
            "  AND ar.tenant_id = :tenant_id AND ar.app_id = :app_id "
            "GROUP BY fe.agent"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_undeclared_join_rejected(self) -> None:
        # fact_evaluation has no declared edge to fact_lead_activity.
        sql = (
            "SELECT fe.agent, la.activity_type "
            "FROM analytics.fact_evaluation fe "
            "JOIN analytics.fact_lead_activity la ON la.lead_id = fe.run_id "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id "
            "  AND la.tenant_id = :tenant_id AND la.app_id = :app_id"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R3.undeclared_join")

    def test_declared_tables_joined_on_wrong_columns_rejected(self) -> None:
        sql = (
            "SELECT fe.agent, COUNT(*) AS n "
            "FROM analytics.fact_evaluation fe "
            "JOIN analytics.agg_evaluation_run ar ON ar.run_id = fe.item_id "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id "
            "  AND ar.tenant_id = :tenant_id AND ar.app_id = :app_id "
            "GROUP BY fe.agent"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R3.declared_join_columns")

    def test_composite_declared_join_requires_every_key_column(self) -> None:
        sql = (
            "SELECT fec.criterion_label, COUNT(*) AS violations "
            "FROM analytics.fact_evaluation_criterion fec "
            "JOIN analytics.fact_evaluation fe ON fe.run_id = fec.run_id "
            "WHERE fec.tenant_id = :tenant_id AND fec.app_id = :app_id "
            "  AND fe.tenant_id = :tenant_id AND fe.app_id = :app_id "
            "GROUP BY fec.criterion_label"
        )
        v = _run_before(sql, grain=("criterion_label",))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R3.declared_join_columns")

    def test_composite_declared_join_passes_when_all_key_columns_present(self) -> None:
        sql = (
            "SELECT fec.criterion_label, COUNT(*) AS violations "
            "FROM analytics.fact_evaluation_criterion fec "
            "JOIN analytics.fact_evaluation fe "
            "  ON fe.run_id = fec.run_id AND fe.item_id = fec.item_id "
            "WHERE fec.tenant_id = :tenant_id AND fec.app_id = :app_id "
            "  AND fe.tenant_id = :tenant_id AND fe.app_id = :app_id "
            "GROUP BY fec.criterion_label"
        )
        v = _run_before(sql, grain=("criterion_label",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)


# ── R4: allowed columns ───────────────────────────────────────────────


class R4AllowedColumnsTests(unittest.TestCase):
    def test_unknown_column_rejected(self) -> None:
        sql = (
            "SELECT ghost_column FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        v = _run_before(sql)
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R4.allowed_columns")

    def test_raw_jsonb_extraction_rejected_when_not_declared(self) -> None:
        sql = (
            "SELECT result_detail->>'undeclared_key' AS leaked "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        v = _run_before(sql)
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R4.allowed_columns")

    def test_alias_qualified_column_ok(self) -> None:
        sql = (
            "SELECT fe.agent FROM analytics.fact_evaluation fe "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_select_alias_referenced_in_order_by_ok(self) -> None:
        sql = (
            "SELECT agent, COUNT(*) AS my_total "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "GROUP BY agent "
            "ORDER BY my_total DESC"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_derived_logical_column_expands_to_physical_expression(self) -> None:
        catalog, _graph = _setup()
        sql = (
            "SELECT agent, AVG(call_opening_score) AS avg_opening "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "GROUP BY agent"
        )
        expanded = expand_logical_columns(sql, catalog)
        self.assertIn("result_detail", expanded)
        self.assertIn("call_opening", expanded)
        self.assertNotIn("call_opening_score", expanded)

    def test_qualified_derived_logical_column_expands_with_alias(self) -> None:
        catalog, _graph = _setup()
        sql = (
            "SELECT fe.agent, AVG(fe.call_opening_score) AS avg_opening "
            "FROM analytics.fact_evaluation fe "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id "
            "GROUP BY fe.agent"
        )
        expanded = expand_logical_columns(sql, catalog)
        self.assertIn("fe.result_detail", expanded)
        self.assertNotIn("fe.call_opening_score", expanded)


# ── R5: GROUP BY completeness ─────────────────────────────────────────


class R5GroupByTests(unittest.TestCase):
    def test_missing_group_by_rejected(self) -> None:
        sql = (
            "SELECT agent, COUNT(*) "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R5.missing_group_by")

    def test_incomplete_group_by_rejected(self) -> None:
        sql = (
            "SELECT agent, direction, COUNT(*) "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "GROUP BY agent"
        )
        v = _run_before(sql, grain=("agent", "direction"))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R5.incomplete_group_by")


# ── R6: aggregate at lowest grain ─────────────────────────────────────


class R6AggregatePlacementTests(unittest.TestCase):
    def test_aggregate_on_coarse_side_rejected(self) -> None:
        # Aggregating avg_score on agg_evaluation_run while joining
        # the finer fact_evaluation is a fan trap; R6 catches it before
        # R8a does.
        sql = (
            "SELECT fe.agent, AVG(ar.avg_score) AS bogus "
            "FROM analytics.fact_evaluation fe "
            "JOIN analytics.agg_evaluation_run ar ON ar.run_id = fe.run_id "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id "
            "  AND ar.tenant_id = :tenant_id AND ar.app_id = :app_id "
            "GROUP BY fe.agent"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertTrue(v.diagnostic.rule_id in {
            "R6.aggregate_at_coarser_grain", "R8a.fan_trap"
        })


# ── R7s: tenant/app scope per alias ───────────────────────────────────


class R7sTenantScopeTests(unittest.TestCase):
    def test_missing_tenant_filter_rejected(self) -> None:
        sql = (
            "SELECT agent FROM analytics.fact_evaluation "
            "WHERE app_id = :app_id"
        )
        v = _run_before(sql)
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R7s.tenant_app_scope")

    def test_missing_app_filter_rejected(self) -> None:
        sql = (
            "SELECT agent FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id"
        )
        v = _run_before(sql)
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R7s.tenant_app_scope")

    def test_multi_table_join_must_scope_every_alias(self) -> None:
        # ar is missing app_id/tenant_id filter — must be rejected.
        sql = (
            "SELECT fe.agent "
            "FROM analytics.fact_evaluation fe "
            "JOIN analytics.agg_evaluation_run ar ON ar.run_id = fe.run_id "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id"
        )
        v = _run_before(sql)
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R7s.tenant_app_scope_per_alias")

    def test_multi_table_join_with_per_alias_scope_passes(self) -> None:
        sql = (
            "SELECT fe.agent "
            "FROM analytics.fact_evaluation fe "
            "JOIN analytics.agg_evaluation_run ar ON ar.run_id = fe.run_id "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id "
            "  AND ar.tenant_id = :tenant_id AND ar.app_id = :app_id"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_or_scope_bypass_is_rejected(self) -> None:
        sql = (
            "SELECT agent FROM analytics.fact_evaluation "
            "WHERE (tenant_id = :tenant_id AND app_id = :app_id) OR agent = 'A'"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R7s.tenant_app_scope")


# ── R7: honest server LIMIT ───────────────────────────────────────────


class R7HonestLimitTests(unittest.TestCase):
    def test_safe_sql_wraps_with_cap_plus_one(self) -> None:
        v = _run_before(_ok_sql(), bound="small")
        self.assertEqual(v.status, "ok", msg=v.diagnostic)
        self.assertEqual(v.row_cap, ROW_CAPS["small"])
        assert v.safe_sql is not None
        self.assertIn(f"LIMIT {ROW_CAPS['small'] + 1}", v.safe_sql)

    def test_bound_single_caps_to_one(self) -> None:
        v = _run_before(_ok_sql(), bound="single")
        self.assertEqual(v.row_cap, 1)
        assert v.safe_sql is not None
        self.assertIn("LIMIT 2", v.safe_sql)

    def test_llm_top_level_limit_is_stripped_before_server_cap(self) -> None:
        v = _run_before(_ok_sql() + " LIMIT 3", bound="small")
        self.assertEqual(v.status, "ok", msg=v.diagnostic)
        assert v.safe_sql is not None
        self.assertIn(f"LIMIT {ROW_CAPS['small'] + 1}", v.safe_sql)
        inner_sql = v.safe_sql.split("AS bouncer_limited_result", 1)[0]
        self.assertNotIn("LIMIT 3", inner_sql)

    def test_public_apply_server_limit_strips_top_level_limit(self) -> None:
        safe_sql = apply_server_limit(_ok_sql() + " LIMIT 3", row_cap=5)
        inner_sql = safe_sql.split("AS bouncer_limited_result", 1)[0]
        self.assertIn("LIMIT 6", safe_sql)
        self.assertNotIn("LIMIT 3", inner_sql)

    def test_invalid_expected_row_bound_rejected(self) -> None:
        v = _run_before(_ok_sql(), bound="tiny")
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R7.invalid_expected_row_bound")


# ── R8a: fan trap (covered partly by R6) ──────────────────────────────


class R8aFanTrapTests(unittest.TestCase):
    def test_fan_trap_when_aggregating_coarse_side(self) -> None:
        sql = (
            "SELECT ar.run_name, SUM(ar.thread_count) AS bogus_total "
            "FROM analytics.fact_evaluation fe "
            "JOIN analytics.agg_evaluation_run ar ON ar.run_id = fe.run_id "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id "
            "  AND ar.tenant_id = :tenant_id AND ar.app_id = :app_id "
            "GROUP BY ar.run_name"
        )
        v = _run_before(sql, grain=("run_name",))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertIn(v.diagnostic.rule_id, {"R6.aggregate_at_coarser_grain", "R8a.fan_trap"})


# ── R8b: chasm trap ───────────────────────────────────────────────────


class R8bChasmTrapTests(unittest.TestCase):
    def test_chasm_trap_rejected(self) -> None:
        sql = (
            "SELECT dl.lead_id "
            "FROM analytics.dim_lead dl "
            "JOIN analytics.fact_lead_activity la ON la.lead_id = dl.lead_id "
            "JOIN analytics.fact_lead_stage_transition lst ON lst.lead_id = dl.lead_id "
            "WHERE dl.tenant_id = :tenant_id AND dl.app_id = :app_id "
            "  AND la.tenant_id = :tenant_id AND la.app_id = :app_id "
            "  AND lst.tenant_id = :tenant_id AND lst.app_id = :app_id"
        )
        v = _run_before(sql, grain=("lead_id",))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R8b.chasm_trap")


# ── R9 / R10 / R11 / R12: post-execution rules ────────────────────────


class PostExecutionRulesTests(unittest.TestCase):
    def test_grain_missing_rejected_on_multirow(self) -> None:
        # Two rows with no 'agent' column → R9 rejects when grain=agent.
        rows = [{"x": 1}, {"x": 2}]
        v = check_after(
            rows=rows, declared_grain=["agent"],
            expected_row_bound="small", row_cap=50,
        )
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R9.grain_missing")

    def test_grain_match_on_single_row_ok(self) -> None:
        # Single-row result (KPI shape) — grain columns don't have to match.
        rows = [{"kpi": 42}]
        v = check_after(
            rows=rows, declared_grain=["agent"],
            expected_row_bound="single", row_cap=1,
        )
        self.assertEqual(v.status, "ok")

    def test_duplicate_grain_rejected(self) -> None:
        rows = [{"agent": "A", "n": 1}, {"agent": "A", "n": 2}]
        v = check_after(
            rows=rows, declared_grain=["agent"],
            expected_row_bound="small", row_cap=50,
        )
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R10.duplicate_grain")

    def test_honest_pagination_propagates_truthfully(self) -> None:
        cap = 5
        rows = [{"agent": f"A{i}", "n": i} for i in range(cap + 1)]  # cap+1 rows
        v = check_after(
            rows=rows, declared_grain=["agent"],
            expected_row_bound="small", row_cap=cap,
        )
        self.assertEqual(v.status, "ok")
        self.assertTrue(v.more_rows_exist)
        self.assertEqual(v.displayed_row_count, cap)

    def test_success_telemetry_includes_post_execution_metadata(self) -> None:
        cap = 2
        rows = [{"agent": f"A{i}", "n": i} for i in range(cap + 1)]
        v = check_after(
            rows=rows, declared_grain=["agent"],
            expected_row_bound="small", row_cap=cap,
        )
        telemetry = v.to_telemetry()
        self.assertEqual(telemetry["row_cap"], cap)
        self.assertTrue(telemetry["more_rows_exist"])
        self.assertEqual(telemetry["displayed_row_count"], cap)

    def test_honest_pagination_under_cap(self) -> None:
        rows = [{"agent": "A", "n": 1}]
        v = check_after(
            rows=rows, declared_grain=["agent"],
            expected_row_bound="small", row_cap=50,
        )
        self.assertEqual(v.status, "ok")
        self.assertFalse(v.more_rows_exist)
        self.assertEqual(v.displayed_row_count, 1)

    def test_all_null_columns_rejected(self) -> None:
        rows = [
            {"agent": "A", "result_score": None},
            {"agent": "B", "result_score": None},
        ]
        v = check_after(
            rows=rows, declared_grain=["agent"],
            expected_row_bound="small", row_cap=50,
        )
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R12.all_null_columns")
        self.assertIn("result_score", v.diagnostic.offending_columns)


# ── AST coverage: aliases, CTEs, subqueries, casts, quoted IDs ────────


class ASTCoverageTests(unittest.TestCase):
    def test_sql_keywords_inside_string_literals_do_not_trip_readonly(self) -> None:
        sql = (
            "SELECT 'DROP TABLE analytics.fact_evaluation' AS note "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        v = _run_before(sql, grain=("note",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_comment_markers_inside_string_literals_are_not_comments(self) -> None:
        sql = (
            "SELECT '-- not a comment' AS note "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        v = _run_before(sql, grain=("note",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_cte_passes_pre_checks(self) -> None:
        sql = (
            "WITH agents AS ("
            "  SELECT agent, COUNT(*) AS n FROM analytics.fact_evaluation "
            "  WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "  GROUP BY agent"
            ") "
            "SELECT agent FROM agents"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_nested_boolean_scope_bypass_rejected_by_ast(self) -> None:
        sql = (
            "SELECT agent FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id "
            "AND (app_id = :app_id OR agent = 'A')"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "invalid")
        assert v.diagnostic is not None
        self.assertEqual(v.diagnostic.rule_id, "R7s.tenant_app_scope")

    def test_subquery_in_from(self) -> None:
        sql = (
            "SELECT t.agent, t.n FROM ("
            "  SELECT agent, COUNT(*) AS n FROM analytics.fact_evaluation "
            "  WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "  GROUP BY agent"
            ") t"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_quoted_identifiers(self) -> None:
        sql = (
            'SELECT "agent" FROM analytics.fact_evaluation '
            'WHERE "tenant_id" = :tenant_id AND "app_id" = :app_id'
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_cast_expression(self) -> None:
        sql = (
            "SELECT agent, AVG(result_score)::float AS s "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "GROUP BY agent"
        )
        v = _run_before(sql, grain=("agent",))
        self.assertEqual(v.status, "ok", msg=v.diagnostic)

    def test_schema_qualified_table_alias_in_select(self) -> None:
        sql = (
            "SELECT analytics.fact_evaluation.agent "
            "FROM analytics.fact_evaluation "
            "WHERE analytics.fact_evaluation.tenant_id = :tenant_id "
            "AND analytics.fact_evaluation.app_id = :app_id"
        )
        v = _run_before(sql, grain=("agent",))
        # The expectation here is permissive: as long as we accept the
        # table and no unknown column, it should pass.
        self.assertEqual(v.status, "ok", msg=v.diagnostic)


if __name__ == "__main__":
    unittest.main()
