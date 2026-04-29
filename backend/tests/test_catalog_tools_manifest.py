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
        "agg_evaluation_run",
        "fact_evaluation",
        "fact_evaluation_criterion",
        "evaluation_runs",
    }


def test_build_catalog_allowlist_for_kaira_bot():
    assert build_catalog_allowlist(app_id="kaira-bot") == [
        "agg_evaluation_run",
        "evaluation_runs",
        "fact_evaluation",
        "fact_evaluation_criterion",
    ]


def test_validate_table_access_rejects_table_not_in_manifest():
    # Phase 2: rejection surfaces as a §6.2 envelope with a typed reason_code.
    err = _validate_table_access(app_id="kaira-bot", table="evaluation_run_thread_results", column=None)
    assert err is not None
    assert err["status"] == "error"
    assert err["outcome"]["reason_code"] == "ENTITY_OUT_OF_SCOPE"
    warnings = err["outcome"]["warnings"]
    assert any("not declared in the manifest" in w for w in warnings)
    assert any("kaira-bot.yaml" in w for w in warnings)


def test_validate_table_access_accepts_declared_table():
    err = _validate_table_access(app_id="kaira-bot", table="evaluation_runs", column=None)
    assert err is None


def test_validate_table_access_rejects_invalid_column():
    err = _validate_table_access(app_id="kaira-bot", table="evaluation_runs", column="bad col name!")
    assert err is not None
    assert err["status"] == "error"
    assert err["outcome"]["reason_code"] == "ENTITY_NOT_FOUND"
    assert any("Invalid column expression" in w for w in err["outcome"]["warnings"])
