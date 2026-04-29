"""Tests for tool_description_generator — manifest-token substitution."""
from __future__ import annotations

from typing import Any, Mapping, Sequence

from app.services.chat_engine.artifact import Outcome
from app.services.chat_engine.capability_pack import CapabilityPack
from app.services.chat_engine.manifest import _clear_manifest_cache_for_tests
from app.services.chat_engine.tool_description_generator import fill_tool_description


class _StubPack:
    """Minimal ``CapabilityPack`` used to exercise the manifest-token path.

    The generator requires a pack (Phase 9 — no optional ``pack=None``
    fallback); this stub contributes nothing of its own so the tests stay
    focused on manifest substitution.
    """

    pack_id: str = 'stub'
    reason_codes: frozenset[str] = frozenset()
    artifact_contracts: Mapping[str, type] = {}
    artifact_extras_contracts: Mapping[str, type] = {}

    def tool_specs(self) -> Sequence[Mapping[str, Any]]:
        return ()

    def tool_handlers(self) -> Mapping[str, Any]:
        return {}

    def validate_arguments(self, tool_name: str, args: Mapping[str, Any]) -> None:
        return None

    def describe_tools(self, app_id: str) -> Mapping[str, str]:
        return {}

    def build_outcome(self, tool_name: str, raw_result: Any) -> Outcome:
        return Outcome()

    def describe_job(self, job: Any) -> str:
        return ''

    def output_schema(self, tool_name: str):
        return None

    def tool_reason_codes(self, tool_name: str) -> Sequence[str]:
        return ()

    def tool_limitations(self, tool_name: str) -> Sequence[str]:
        return ()


_PACK: CapabilityPack = _StubPack()


def setup_function(_):
    _clear_manifest_cache_for_tests()


def test_fill_substitutes_catalog_tables_for_kaira_bot():
    tool = {"name": "x", "description": "Check {{catalog_tables}}."}
    filled = fill_tool_description(tool, app_id="kaira-bot", pack=_PACK)
    assert "{{catalog_tables}}" not in filled["description"]
    assert "agg_evaluation_run" in filled["description"]
    assert "evaluation_runs" in filled["description"]


def test_fill_substitutes_surface_keys_for_voice_rx():
    tool = {
        "name": "y",
        "inputSchema": {
            "properties": {
                "surface_key": {"description": "One of: {{surface_keys}}."}
            }
        },
    }
    filled = fill_tool_description(tool, app_id="voice-rx", pack=_PACK)
    desc = filled["inputSchema"]["properties"]["surface_key"]["description"]
    assert "runs" in desc
    assert "logs" in desc
    assert "thread_evaluations" not in desc  # voice-rx doesn't declare it


def test_fill_surface_keys_for_kaira_bot_includes_adversarial():
    tool = {"name": "z", "description": "Surfaces: {{surface_keys}}."}
    filled = fill_tool_description(tool, app_id="kaira-bot", pack=_PACK)
    # ``adversarial_evaluations`` is a Sherlock surface key (logical), kept
    # unchanged by §5.4 since only the physical table moved.
    assert "adversarial_evaluations" in filled["description"]


def test_fill_leaves_unrelated_strings_alone():
    tool = {"name": "noop", "description": "Plain description, no tokens."}
    filled = fill_tool_description(tool, app_id="kaira-bot", pack=_PACK)
    assert filled["description"] == "Plain description, no tokens."
    assert filled is not tool  # deep copy


def test_fill_is_nondestructive():
    tool = {"name": "x", "description": "Tables: {{catalog_tables}}."}
    original = dict(tool)
    fill_tool_description(tool, app_id="kaira-bot", pack=_PACK)
    assert tool == original  # input untouched
