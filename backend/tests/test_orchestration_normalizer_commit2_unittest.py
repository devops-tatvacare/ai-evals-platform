"""Phase 11 (Commit 2) — normalizer migrations for the dispatch / mutation contract.

Covers the post-Commit-2 migration paths added on top of the Commit-1 normalizer:

  - retry-capable dispatch node ``output_id='failed'`` → ``'exhausted'``
  - mutation node ``output_id='failed'`` left untouched
  - ``core.webhook_out.body_template`` (string) → structured ``body``
"""
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


def test_retry_capable_failed_edges_become_exhausted():
    """Each retry-capable dispatch node's legacy ``failed`` edge is rewritten."""
    defn = {
        "nodes": [
            _node("src", "source.cohort_query", source_table="t", id_column="id"),
            _node("wati", "crm.send_wati", connection_id="c", template_slug="t"),
            _node("bolna", "crm.place_bolna_call", connection_id="c", template_slug="t"),
            _node("sms", "crm.send_sms", connection_id="c", template_slug="t"),
            _node("wh", "core.webhook_out", url="x", body={}),
            _node("lab", "clinical.schedule_lab", test_code="X", test_name="X"),
            _node("care", "clinical.assign_care_team_task", task_label="x"),
            _node("pro", "clinical.send_pro_assessment"),
            _node("esc", "clinical.escalation_uptier", reason="r"),
            _node("sink", "sink.complete"),
        ],
        "edges": [
            _edge("e1", "src", "wati"),
            _edge("e2", "wati", "sink", output_id="failed"),
            _edge("e3", "bolna", "sink", output_id="failed"),
            _edge("e4", "sms", "sink", output_id="failed"),
            _edge("e5", "wh", "sink", output_id="failed"),
            _edge("e6", "lab", "sink", output_id="failed"),
            _edge("e7", "care", "sink", output_id="failed"),
            _edge("e8", "pro", "sink", output_id="failed"),
            _edge("e9", "esc", "sink", output_id="failed"),
        ],
    }
    canon = normalize_definition(defn)
    by_id = {e["id"]: e for e in canon["edges"]}
    for eid in ("e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9"):
        assert by_id[eid]["output_id"] == "exhausted", eid


def test_mutation_failed_edges_remain_failed():
    """LSQ + EMR write are mutation nodes — their ``failed`` edge must not migrate."""
    defn = {
        "nodes": [
            _node("src", "source.cohort_query", source_table="t", id_column="id"),
            _node("lsq_stage", "crm.lsq_update_stage", connection_id="c", target_stage="X"),
            _node("lsq_log", "crm.lsq_log_activity", connection_id="c", activity_event_code=1, note="n"),
            _node("emr", "clinical.emr_write", template="x"),
            _node("sink", "sink.complete"),
        ],
        "edges": [
            _edge("e1", "src", "lsq_stage"),
            _edge("e2", "lsq_stage", "sink", output_id="failed"),
            _edge("e3", "lsq_log", "sink", output_id="failed"),
            _edge("e4", "emr", "sink", output_id="failed"),
        ],
    }
    canon = normalize_definition(defn)
    by_id = {e["id"]: e for e in canon["edges"]}
    assert by_id["e2"]["output_id"] == "failed"
    assert by_id["e3"]["output_id"] == "failed"
    assert by_id["e4"]["output_id"] == "failed"


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
    """If a definition already carries ``body``, the migration leaves it
    alone and drops the redundant ``body_template``."""
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
    """Phase 11 §9.6 — running the normalizer twice is a no-op."""
    defn = {
        "nodes": [
            _node("src", "source.cohort_query", source_ref="crm.lead_record", payload_fields=["x"]),
            _node("wati", "crm.send_wati", connection_id="c", template_slug="t"),
            _node("sink", "sink.complete"),
        ],
        "edges": [
            _edge("e1", "src", "wati"),
            _edge("e2", "wati", "sink", output_id="success"),
            _edge("e3", "wati", "sink", output_id="exhausted"),
        ],
    }
    once = normalize_definition(defn)
    twice = normalize_definition(once)
    assert once == twice
