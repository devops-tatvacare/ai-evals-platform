"""Phase 13 / Phase A: seeds must not bake provider identifiers into JSON.

Keystone #1 of the phase plan: zero provider identifiers in seed data. Action
templates and seeded workflow definitions may declare *that* a node uses
Bolna / WATI / etc., but they may not declare *which* agent / template /
channel / sender — those are UI-supplied at draft time and validated at
publish time by the gate (Phase B/C).

This test scans every JSON under ``orchestration_seeds/`` for the deny-list
keys and fails the build if any leak in.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest


_SEEDS_ROOT = (
    Path(__file__).parent.parent
    / "app"
    / "services"
    / "orchestration_seeds"
)
_TEMPLATE_DIR = _SEEDS_ROOT / "action_templates"
_WORKFLOW_DIR = _SEEDS_ROOT / "workflows"


# Provider-specific identifiers that must never live in seed data per
# Phase 13 keystone #1. Operators supply these via the builder UI; the
# publish-gate (Phase B/C) blocks publication when they're missing.
_DENY_LIST = frozenset({
    "agent_id",
    "template_name",
    "broadcast_name",
    "channel_number",
    "from_phone",
    "from_number",
    "flow_id",
    "sender_id",
})


def _walk_keys(node: Any) -> list[str]:
    """Yield every dict key encountered, recursing into nested dicts/lists."""
    out: list[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            out.append(k)
            out.extend(_walk_keys(v))
    elif isinstance(node, list):
        for item in node:
            out.extend(_walk_keys(item))
    return out


def _action_template_files() -> list[Path]:
    return sorted(_TEMPLATE_DIR.glob("*.json"))


def _workflow_files() -> list[Path]:
    return sorted(_WORKFLOW_DIR.glob("*.json"))


@pytest.mark.parametrize(
    "path",
    _action_template_files(),
    ids=lambda p: p.name,
)
def test_action_template_payload_schema_has_no_provider_identifiers(path: Path):
    spec = json.loads(path.read_text())
    payload_schema = spec.get("payload_schema", {})
    leaked = sorted(set(_walk_keys(payload_schema)) & _DENY_LIST)
    assert not leaked, (
        f"{path.name}: payload_schema leaked provider identifiers {leaked!r}; "
        "these must be UI-supplied per Phase 13 keystone #1."
    )


@pytest.mark.parametrize(
    "path",
    _workflow_files(),
    ids=lambda p: p.name,
)
def test_seeded_workflow_node_configs_have_no_provider_identifiers(path: Path):
    spec = json.loads(path.read_text())
    definition = spec.get("definition", {})
    nodes = definition.get("nodes", [])
    failures: list[tuple[str, list[str]]] = []
    for node in nodes:
        cfg = node.get("config", {})
        leaked = sorted(set(_walk_keys(cfg)) & _DENY_LIST)
        if leaked:
            failures.append((node.get("id", "<unknown>"), leaked))
    assert not failures, (
        f"{path.name}: workflow nodes leaked provider identifiers {failures!r}; "
        "these must be UI-supplied per Phase 13 keystone #1."
    )
