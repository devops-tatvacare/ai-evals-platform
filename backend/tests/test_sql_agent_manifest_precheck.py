"""Tests for validate_sql_columns_against_manifest (Phase 8 pre-check)."""
from __future__ import annotations

import pytest

from app.services.chat_engine.manifest import _clear_manifest_cache_for_tests
from app.services.chat_engine.sql_agent import (
    SQLValidationError,
    validate_sql_columns_against_manifest,
)


def setup_function(_):
    _clear_manifest_cache_for_tests()


def test_accepts_real_columns():
    sql = (
        "SELECT rf.run_id, rf.pass_rate "
        "FROM analytics_run_facts rf "
        "WHERE rf.app_id = :app_id"
    )
    validate_sql_columns_against_manifest(sql, app_id="kaira-bot")  # must not raise


def test_rejects_hallucinated_column_on_eval_runs():
    sql = (
        "SELECT er.evaluator_name "
        "FROM eval_runs er "
        "WHERE er.app_id = :app_id"
    )
    with pytest.raises(SQLValidationError, match="evaluator_name"):
        validate_sql_columns_against_manifest(sql, app_id="kaira-bot")


def test_rejects_hallucinated_criterion_rule_column():
    # "cf.rule" is a known LLM hallucination — real column is criterion_label.
    sql = (
        "SELECT cf.rule, COUNT(*) "
        "FROM analytics_criterion_facts cf "
        "WHERE cf.app_id = :app_id "
        "GROUP BY cf.rule"
    )
    with pytest.raises(SQLValidationError, match="cf.rule"):
        validate_sql_columns_against_manifest(sql, app_id="kaira-bot")


def test_ignores_cte_aliases():
    sql = (
        "WITH latest AS (SELECT rf.run_id, rf.pass_rate FROM analytics_run_facts rf) "
        "SELECT latest.run_id FROM latest"
    )
    validate_sql_columns_against_manifest(sql, app_id="kaira-bot")  # must not raise


def test_ignores_unknown_tables():
    # If the SQL references a table not in the manifest at all, the pre-check
    # cannot validate it and silently passes — existing validate_sql handles
    # the disallowed-table case.
    sql = "SELECT x.foo FROM some_other_table x"
    validate_sql_columns_against_manifest(sql, app_id="kaira-bot")  # must not raise
