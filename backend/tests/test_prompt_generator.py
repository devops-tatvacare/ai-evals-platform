"""Tests for prompt_generator.render_tools_section."""
from __future__ import annotations

from app.services.chat_engine.manifest import _clear_manifest_cache_for_tests
from app.services.chat_engine.prompt_generator import render_tools_section


def setup_function(_):
    _clear_manifest_cache_for_tests()


def test_renders_kaira_bot_tools_section_includes_real_surfaces():
    rendered = render_tools_section(app_id="kaira-bot")
    assert "runs" in rendered
    # ``thread_evaluations`` / ``adversarial_evaluations`` are surface keys
    # (logical Sherlock-facing names) — kept unchanged by the §5.4 rename
    # since only the physical tables moved.
    assert "thread_evaluations" in rendered
    assert "adversarial_evaluations" in rendered
    assert "agg_evaluation_run" in rendered
    assert "{{" not in rendered


def test_voice_rx_does_not_include_thread_evaluations():
    rendered = render_tools_section(app_id="voice-rx")
    assert "thread_evaluations" not in rendered
    assert "runs" in rendered
    assert "logs" in rendered


def test_section_contains_tool_orchestration_prose():
    rendered = render_tools_section(app_id="inside-sales")
    for name in [
        "catalog_inspect",
        "data_query",
        "data_check",
        "get_surface_records",
        "resolve_entity",
        "blueprint_blocks",
    ]:
        assert name in rendered
