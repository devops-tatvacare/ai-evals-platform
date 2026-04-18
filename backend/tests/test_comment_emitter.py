"""Tests for comment_emitter.emit_column_comments."""
from __future__ import annotations

from app.services.chat_engine.comment_emitter import emit_column_comments
from app.services.chat_engine.manifest import _clear_manifest_cache_for_tests


def setup_function(_):
    _clear_manifest_cache_for_tests()


def test_emits_comment_for_pass_rate_with_role_measure():
    stmts = emit_column_comments(app_id="kaira-bot")
    joined = "\n".join(stmts)
    assert "COMMENT ON COLUMN analytics_run_facts.pass_rate" in joined
    assert "Role: measure" in joined


def test_emits_measure_kind_and_unit_on_pass_rate():
    stmts = emit_column_comments(app_id="kaira-bot")
    pass_rate_stmt = next(s for s in stmts if "analytics_run_facts.pass_rate" in s)
    assert "MeasureKind: percent" in pass_rate_stmt
    assert "Unit: percent" in pass_rate_stmt


def test_emits_allowed_values_for_enum_columns():
    stmts = emit_column_comments(app_id="kaira-bot")
    difficulty_stmt = next(s for s in stmts if "analytics_eval_facts.difficulty" in s)
    assert "EASY" in difficulty_stmt
    assert "MORIARTY" in difficulty_stmt


def test_no_dangling_tokens_in_comments():
    for s in emit_column_comments(app_id="kaira-bot"):
        assert "{{" not in s
        assert "}}" not in s


def test_emit_all_is_deduped():
    all_stmts = emit_column_comments()
    # Same (table, column) key must not appear twice.
    keys = [s.split(" IS ")[0] for s in all_stmts]
    assert len(keys) == len(set(keys))
