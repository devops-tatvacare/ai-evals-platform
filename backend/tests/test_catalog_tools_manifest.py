"""Tests for Phase 3: catalog_tools reads allow-list from manifest."""
from __future__ import annotations

from app.services.chat_engine.catalog_tools import (
    _validate_table_access,
    build_catalog_allowlist,
    get_catalog_model_map,
)
from app.services.chat_engine.manifest import _clear_manifest_cache_for_tests


def setup_function(_):
    _clear_manifest_cache_for_tests()


def test_catalog_model_map_has_four_tables_for_kaira_bot():
    m = get_catalog_model_map("kaira-bot")
    assert set(m.keys()) == {
        "analytics_run_facts",
        "analytics_eval_facts",
        "analytics_criterion_facts",
        "eval_runs",
    }


def test_build_catalog_allowlist_for_kaira_bot():
    assert build_catalog_allowlist(app_id="kaira-bot") == [
        "analytics_criterion_facts",
        "analytics_eval_facts",
        "analytics_run_facts",
        "eval_runs",
    ]


def test_validate_table_access_rejects_table_not_in_manifest():
    err = _validate_table_access(app_id="kaira-bot", table="thread_evaluations", column=None)
    assert err is not None
    assert "not declared in the manifest" in err["error"]
    assert "kaira-bot.yaml" in err["error"]


def test_validate_table_access_accepts_declared_table():
    err = _validate_table_access(app_id="kaira-bot", table="eval_runs", column=None)
    assert err is None


def test_validate_table_access_rejects_invalid_column():
    err = _validate_table_access(app_id="kaira-bot", table="eval_runs", column="bad col name!")
    assert err is not None
    assert "Invalid column expression" in err["error"]
