"""Tests for tool_description_generator — manifest-token substitution."""
from __future__ import annotations

from app.services.chat_engine.manifest import _clear_manifest_cache_for_tests
from app.services.chat_engine.tool_description_generator import fill_tool_description


def setup_function(_):
    _clear_manifest_cache_for_tests()


def test_fill_substitutes_catalog_tables_for_kaira_bot():
    tool = {"name": "x", "description": "Check {{catalog_tables}}."}
    filled = fill_tool_description(tool, app_id="kaira-bot")
    assert "{{catalog_tables}}" not in filled["description"]
    assert "analytics_run_facts" in filled["description"]
    assert "eval_runs" in filled["description"]


def test_fill_substitutes_surface_keys_for_voice_rx():
    tool = {
        "name": "y",
        "inputSchema": {
            "properties": {
                "surface_key": {"description": "One of: {{surface_keys}}."}
            }
        },
    }
    filled = fill_tool_description(tool, app_id="voice-rx")
    desc = filled["inputSchema"]["properties"]["surface_key"]["description"]
    assert "runs" in desc
    assert "logs" in desc
    assert "thread_evaluations" not in desc  # voice-rx doesn't declare it


def test_fill_surface_keys_for_kaira_bot_includes_adversarial():
    tool = {"name": "z", "description": "Surfaces: {{surface_keys}}."}
    filled = fill_tool_description(tool, app_id="kaira-bot")
    assert "adversarial_evaluations" in filled["description"]


def test_fill_leaves_unrelated_strings_alone():
    tool = {"name": "noop", "description": "Plain description, no tokens."}
    filled = fill_tool_description(tool, app_id="kaira-bot")
    assert filled["description"] == "Plain description, no tokens."
    assert filled is not tool  # deep copy


def test_fill_is_nondestructive():
    tool = {"name": "x", "description": "Tables: {{catalog_tables}}."}
    original = dict(tool)
    fill_tool_description(tool, app_id="kaira-bot")
    assert tool == original  # input untouched
