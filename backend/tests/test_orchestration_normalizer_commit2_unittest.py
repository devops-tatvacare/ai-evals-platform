"""Normalizer migrations for the dispatch / mutation contract."""
from __future__ import annotations

from app.services.orchestration.definition_normalizer import normalize_definition


def _node(node_id: str, node_type: str, **config) -> dict:
    return {
        "id": node_id,
        "type": node_type,
        "position": {"x": 0, "y": 0},
        "config": dict(config),
    }


def _edge(eid: str, source: str, target: str, output_id: str = "default") -> dict:
    return {"id": eid, "source": source, "target": target, "output_id": output_id}


def test_core_webhook_failed_edge_becomes_exhausted():
    """The retry-capable ``core.webhook_out`` node rewrites legacy ``failed`` to ``exhausted``."""
    defn = {
        "nodes": [
            _node("src", "source.event_trigger"),
            _node("wh", "core.webhook_out", url="x", body={}),
            _node("sink", "sink.complete"),
        ],
        "edges": [
            _edge("e1", "src", "wh"),
            _edge("e2", "wh", "sink", output_id="failed"),
        ],
    }
    canon = normalize_definition(defn)
    by_id = {e["id"]: e for e in canon["edges"]}
    assert by_id["e2"]["output_id"] == "exhausted"


def test_webhook_body_template_migrates_to_structured_body():
    defn = {
        "nodes": [
            _node(
                "wh", "core.webhook_out",
                url="https://x", method="POST",
                body_template='{"name": "{{first_name}}", "static": "v"}',
            ),
        ],
        "edges": [],
    }
    canon = normalize_definition(defn)
    cfg = canon["nodes"][0]["config"]
    assert "body_template" not in cfg
    assert cfg["body"] == {"name": {"$payload": "first_name"}, "static": "v"}


def test_webhook_existing_body_takes_priority_over_legacy_template():
    defn = {
        "nodes": [
            _node(
                "wh", "core.webhook_out",
                url="x",
                body={"name": {"$payload": "first_name"}},
                body_template='{"static": "ignored"}',
            ),
        ],
        "edges": [],
    }
    canon = normalize_definition(defn)
    cfg = canon["nodes"][0]["config"]
    assert "body_template" not in cfg
    assert cfg["body"] == {"name": {"$payload": "first_name"}}


def test_normalizer_idempotent_on_canonical_definition():
    defn = {
        "nodes": [
            _node("src", "source.event_trigger"),
            _node("wh", "core.webhook_out", connection_id="c", url="https://x", body={}),
            _node("sink", "sink.complete"),
        ],
        "edges": [
            _edge("e1", "src", "wh"),
            _edge("e2", "wh", "sink", output_id="success"),
            _edge("e3", "wh", "sink", output_id="exhausted"),
        ],
    }
    once = normalize_definition(defn)
    twice = normalize_definition(once)
    assert once == twice
