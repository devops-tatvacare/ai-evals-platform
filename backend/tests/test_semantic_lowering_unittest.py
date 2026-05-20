"""Unit tests for ``semantic_lowering.lower_sql``.

Lowering is the deterministic logical→physical SQL rewriter that runs
between the bouncer's pre-execution rules and ``prepare_query``. These
tests pin the contract that complex SQL shapes — same-name aliases,
multi-clause references, CTEs, JOINs, aggregates, subqueries — all
flow through the same single rule: *manifest entry has expr → substitute*.

The kaira-bot ``persona_tactic`` bug (2026-05-18) was caused by an
over-broad SELECT-alias skip; the ``test_same_name_alias_*`` cases
guard against its return.
"""
from __future__ import annotations

import unittest

from app.services.chat_engine.semantic_lowering import lower_sql
from app.services.chat_engine.workbench_catalog import parse_workbench_catalog


# ── Catalog fixture ──────────────────────────────────────────────────
#
# Two tables; the derived columns exercise the same shapes kaira-bot,
# inside-sales, and voice-rx manifests use today (JSONB extract, CASE
# WHEN, simple cast).


def _catalog():
    raw = {
        'name': 'lowering_tests',
        'tables': {
            'fact_evaluation': {
                'table_kind': 'fact',
                'base_table': {'schema': 'analytics', 'table': 'fact_evaluation'},
                'physical_primary_key': {'columns': ['id']},
                'analytical_grain': {'columns': ['run_id', 'item_id', 'evaluator_id']},
                'dimensions': [
                    {'name': 'run_id'},
                    {'name': 'item_id'},
                    {'name': 'evaluator_id'},
                    {'name': 'agent'},  # passthrough
                    {
                        # JSONB extract — kaira-bot persona_tactic shape
                        'name': 'persona_tactic',
                        'expr': "context->>'persona_tactics_attempted'",
                        'source_table': 'fact_evaluation',
                    },
                    {
                        # Cast-on-extract — voice-rx call_opening_score shape
                        'name': 'call_opening_score',
                        'expr': "(result_detail->>'call_opening')::numeric",
                        'source_table': 'fact_evaluation',
                    },
                ],
                'time_dimensions': [{'name': 'created_at'}],
                'facts': [{'name': 'result_score'}],
            },
            'fact_evaluation_criterion': {
                'table_kind': 'fact',
                'base_table': {
                    'schema': 'analytics', 'table': 'fact_evaluation_criterion',
                },
                'physical_primary_key': {'columns': ['id']},
                'analytical_grain': {'columns': ['run_id', 'item_id', 'criterion_id']},
                'dimensions': [
                    {'name': 'run_id'},
                    {'name': 'item_id'},
                    {'name': 'criterion_id'},
                    {'name': 'criterion_label'},
                    {'name': 'criterion_source'},
                    {
                        # CASE-WHEN derived — kaira-bot persona_id shape
                        'name': 'persona_id',
                        'expr': (
                            "CASE WHEN criterion_source LIKE 'persona.%' "
                            "THEN split_part(criterion_source, '.', 2) "
                            "ELSE NULL END"
                        ),
                        'source_table': 'fact_evaluation_criterion',
                    },
                ],
            },
        },
        'relationships': [
            {
                'name': 'crit_to_eval',
                'left_table': 'fact_evaluation_criterion',
                'right_table': 'fact_evaluation',
                'relationship_columns': [
                    {'left_column': 'run_id', 'right_column': 'run_id'},
                    {'left_column': 'item_id', 'right_column': 'item_id'},
                ],
                'join_type': 'inner',
                'relationship_type': 'many_to_one',
            },
        ],
        'verified_queries': [
            {'name': 'q1', 'question': '?', 'sql': 'SELECT 1'},
            {'name': 'q2', 'question': '?', 'sql': 'SELECT 2'},
            {'name': 'q3', 'question': '?', 'sql': 'SELECT 3'},
        ],
    }
    return parse_workbench_catalog(raw)


# ── 1. The kaira-bot bug class: same-name alias ──────────────────────


class SameNameAliasTests(unittest.TestCase):
    """When the LLM aliases a derived column to its own name (which is
    natural — keeps the output column name stable), references inside
    the SELECT expression resolve against FROM tables, NOT against the
    same-level SELECT alias. The bug was over-broad alias skipping;
    these tests pin that it stays fixed."""

    def test_alias_matches_column_name_inside_aggregate(self) -> None:
        sql = (
            "SELECT TRIM(persona_tactic) AS persona_tactic "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        out = lower_sql(sql, _catalog())
        # The persona_tactic INSIDE TRIM() must be rewritten.
        self.assertIn("context", out)
        self.assertNotIn("TRIM(persona_tactic)", out)

    def test_alias_matches_column_name_with_coalesce_chain(self) -> None:
        # Real kaira-bot turn 2 shape from the 2026-05-18 incident.
        sql = (
            "SELECT COALESCE(NULLIF(TRIM(persona_tactic), ''), '(none)') AS persona_tactic, "
            "COUNT(*) AS failures "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "GROUP BY persona_tactic"
        )
        out = lower_sql(sql, _catalog())
        self.assertIn("context", out)
        # The GROUP BY persona_tactic ALSO gets lowered (uniform rule).
        self.assertNotIn("TRIM(persona_tactic)", out)


# ── 2. Multi-clause uniformity ───────────────────────────────────────


class MultiClauseTests(unittest.TestCase):
    """The rewriter walks every clause uniformly because AST traversal
    is clause-agnostic. One rule, applied everywhere."""

    def test_derived_in_select_where_group_order(self) -> None:
        sql = (
            "SELECT call_opening_score, COUNT(*) AS n "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "AND call_opening_score > 0 "
            "GROUP BY call_opening_score "
            "ORDER BY call_opening_score DESC"
        )
        out = lower_sql(sql, _catalog())
        # Every occurrence rewritten (4 references → 4 expansions).
        self.assertEqual(out.count("result_detail"), 4)
        self.assertNotIn("call_opening_score", out.replace(" AS n", ""))

    def test_passthrough_column_left_alone(self) -> None:
        sql = (
            "SELECT agent, COUNT(*) AS n "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "GROUP BY agent"
        )
        out = lower_sql(sql, _catalog())
        # No expr declared for agent — passthrough, unchanged.
        self.assertIn("agent", out)


# ── 3. Qualified references / JOIN ───────────────────────────────────


class QualifiedJoinTests(unittest.TestCase):
    def test_qualified_derived_uses_alias_in_expansion(self) -> None:
        sql = (
            "SELECT fe.call_opening_score "
            "FROM analytics.fact_evaluation fe "
            "WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id"
        )
        out = lower_sql(sql, _catalog())
        self.assertIn("fe.result_detail", out)

    def test_join_with_derived_on_each_side(self) -> None:
        sql = (
            "SELECT fec.persona_id, fe.call_opening_score "
            "FROM analytics.fact_evaluation_criterion fec "
            "JOIN analytics.fact_evaluation fe "
            "  ON fec.run_id = fe.run_id AND fec.item_id = fe.item_id "
            "WHERE fec.tenant_id = :tenant_id AND fec.app_id = :app_id"
        )
        out = lower_sql(sql, _catalog())
        # Each derived column rewrites with the alias of its source table.
        self.assertIn("fec.criterion_source", out)
        self.assertIn("fe.result_detail", out)


# ── 4. CTE scope ─────────────────────────────────────────────────────


class CteScopeTests(unittest.TestCase):
    """References qualified by a CTE name are left alone; lowering does
    not look inside CTE bodies for projection-vs-base-column resolution
    (the bouncer already validated that)."""

    def test_cte_qualified_reference_is_not_rewritten(self) -> None:
        sql = (
            "WITH x AS ("
            "  SELECT 1 AS persona_tactic"
            ") "
            "SELECT x.persona_tactic FROM x"
        )
        out = lower_sql(sql, _catalog())
        # The outer x.persona_tactic stays as-is (x is a CTE, not a
        # manifest table).
        self.assertIn("x.persona_tactic", out)

    def test_cte_body_references_get_rewritten_when_bound_to_manifest_table(self) -> None:
        sql = (
            "WITH x AS ("
            "  SELECT persona_tactic FROM analytics.fact_evaluation"
            ") "
            "SELECT * FROM x"
        )
        out = lower_sql(sql, _catalog())
        # Inside the CTE, persona_tactic is on fact_evaluation → rewritten.
        self.assertIn("context", out)


# ── 5. References the manifest doesn't know about ────────────────────


class UnknownReferenceTests(unittest.TestCase):
    """Lowering never raises on unknown columns — that's R4's job at
    check_before. Unknown references pass through unchanged."""

    def test_unknown_column_passes_through(self) -> None:
        sql = (
            "SELECT not_in_manifest "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        out = lower_sql(sql, _catalog())
        self.assertIn("not_in_manifest", out)

    def test_unknown_table_passes_through(self) -> None:
        # Bouncer's R2 would reject this; lowering does nothing.
        sql = (
            "SELECT persona_tactic "
            "FROM analytics.some_other_table "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id"
        )
        out = lower_sql(sql, _catalog())
        # persona_tactic isn't matched to a known table → no rewrite.
        self.assertIn("persona_tactic", out)


# ── 6. Idempotence ───────────────────────────────────────────────────


class IdempotenceTests(unittest.TestCase):
    def test_lowering_twice_equals_lowering_once(self) -> None:
        sql = (
            "SELECT persona_tactic, COUNT(*) AS n "
            "FROM analytics.fact_evaluation "
            "WHERE tenant_id = :tenant_id AND app_id = :app_id "
            "GROUP BY persona_tactic"
        )
        once = lower_sql(sql, _catalog())
        twice = lower_sql(once, _catalog())
        self.assertEqual(once, twice)


# ── 7. Nested subquery ───────────────────────────────────────────────


class SubqueryTests(unittest.TestCase):
    def test_derived_inside_subquery_is_rewritten(self) -> None:
        sql = (
            "SELECT n FROM ("
            "  SELECT COUNT(persona_tactic) AS n "
            "  FROM analytics.fact_evaluation "
            "  WHERE tenant_id = :tenant_id AND app_id = :app_id"
            ") sub"
        )
        out = lower_sql(sql, _catalog())
        self.assertIn("context", out)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
