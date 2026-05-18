"""Phase 11 — definition normalization tests.

Verifies the lossless legacy → canonical migration paths:
  - edge `label`           -> `output_id`
  - source `next_node_id`  -> removed
  - split branches by label -> stable `id`s; edges rewritten
  - wait `duration_hours`  -> `mode='duration'`
  - merge `dedupe`         -> `merge_policy` + `payload_policy`
  - consent_gate `require_explicit_optin` -> `consent_policy`
"""
from __future__ import annotations

from app.services.orchestration.definition_normalizer import normalize_definition


def test_normalization_is_idempotent_on_canonical_input():
    canonical = {
        "nodes": [
            {
                "id": "src",
                "type": "source.event_trigger",
                "position": {"x": 0, "y": 0},
                "data": {},
                "config": {},
            },
            {
                "id": "done",
                "type": "sink.complete",
                "position": {"x": 0, "y": 100},
                "data": {},
                "config": {},
            },
        ],
        "edges": [
            {"id": "e1", "source": "src", "target": "done", "output_id": "default"},
        ],
    }
    once = normalize_definition(canonical)
    twice = normalize_definition(once)
    assert once == twice


def test_edge_label_promoted_to_output_id():
    raw = {
        "nodes": [
            {"id": "a", "type": "logic.merge", "position": {"x": 0, "y": 0}, "data": {}, "config": {}},
            {"id": "b", "type": "sink.complete", "position": {"x": 0, "y": 0}, "data": {}, "config": {}},
        ],
        "edges": [{"id": "e", "source": "a", "target": "b", "label": "default"}],
    }
    out = normalize_definition(raw)
    assert out["edges"][0]["output_id"] == "default"


def test_source_next_node_id_removed():
    raw = {
        "nodes": [{
            "id": "src", "type": "source.event_trigger",
            "position": {"x": 0, "y": 0}, "data": {},
            "config": {"next_node_id": "downstream"},
        }],
        "edges": [],
    }
    out = normalize_definition(raw)
    assert "next_node_id" not in out["nodes"][0]["config"]


def test_split_branches_by_label_get_ids_and_edges_rewrite():
    raw = {
        "nodes": [{
            "id": "split", "type": "logic.split",
            "position": {"x": 0, "y": 0}, "data": {},
            "config": {
                "mode": "by_field",
                "field": "tier",
                "branches": [
                    {"label": "high", "match": "high"},
                    {"label": "low", "match": "low"},
                ],
                "default_branch": "low",
            },
        }],
        "edges": [
            {"id": "e_h", "source": "split", "target": "x", "label": "high"},
            {"id": "e_l", "source": "split", "target": "y", "label": "low"},
        ],
    }
    out = normalize_definition(raw)
    cfg = out["nodes"][0]["config"]
    ids = {b["id"] for b in cfg["branches"]}
    assert ids == {"high", "low"}
    # Default lifted to id form.
    assert cfg["default_branch_id"] in ids
    assert "default_branch" not in cfg
    # Edges now reference branch ids.
    output_ids = {e["output_id"] for e in out["edges"]}
    assert output_ids == {"high", "low"}


def test_split_branch_label_with_spaces_becomes_safe_id():
    raw = {
        "nodes": [{
            "id": "split", "type": "logic.split",
            "position": {"x": 0, "y": 0}, "data": {},
            "config": {
                "mode": "by_field",
                "field": "tier",
                "branches": [
                    {"label": "High Priority!", "match": "high"},
                    {"label": "Low / Cold", "match": "low"},
                ],
            },
        }],
        "edges": [
            {"id": "e_h", "source": "split", "target": "x", "label": "High Priority!"},
        ],
    }
    out = normalize_definition(raw)
    branch_ids = [b["id"] for b in out["nodes"][0]["config"]["branches"]]
    # Slugified — only [A-Za-z0-9_].
    for bid in branch_ids:
        assert all(c.isalnum() or c == "_" for c in bid)
    # Edge rewritten to match the slug.
    assert out["edges"][0]["output_id"] == branch_ids[0]


def test_wait_legacy_duration_lifts_to_mode():
    raw = {
        "nodes": [{
            "id": "w", "type": "logic.wait",
            "position": {"x": 0, "y": 0}, "data": {},
            "config": {"duration_hours": 4},
        }],
        "edges": [],
    }
    out = normalize_definition(raw)
    assert out["nodes"][0]["config"]["mode"] == "duration"
    assert out["nodes"][0]["config"]["duration_hours"] == 4


def test_merge_legacy_dedupe_lifts_to_policy():
    for legacy, expected in (({"dedupe": True}, "dedupe"), ({"dedupe": False}, "last_wins")):
        raw = {
            "nodes": [{
                "id": "m", "type": "logic.merge",
                "position": {"x": 0, "y": 0}, "data": {},
                "config": legacy,
            }],
            "edges": [],
        }
        out = normalize_definition(raw)
        cfg = out["nodes"][0]["config"]
        assert cfg["merge_policy"] == expected
        assert cfg["payload_policy"] == "last_wins"


def test_consent_gate_legacy_optin_lifts_to_policy():
    raw = {
        "nodes": [{
            "id": "g", "type": "filter.consent_gate",
            "position": {"x": 0, "y": 0}, "data": {},
            "config": {"channel": "wa", "require_explicit_optin": True},
        }],
        "edges": [],
    }
    out = normalize_definition(raw)
    cfg = out["nodes"][0]["config"]
    assert cfg["consent_policy"] == "explicit_optin"
    assert "require_explicit_optin" not in cfg


