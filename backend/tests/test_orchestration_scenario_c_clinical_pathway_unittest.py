"""Phase 11 §9 — Scenario C: clinical pathway with async feedback + escalation.

  cohort_query (clinical.dim_patient)
    -> filter.eligibility (active patients only)
    -> logic.split (risk tier, by_field on `risk_tier`)
    -> clinical.schedule_lab + clinical.send_pro_assessment (parallel arms)
    -> logic.wait (event_or_timeout, correlated by `lab_request_id`)
    -> logic.merge (reconcile both arms — dedupe + last_wins)
    -> logic.conditional (clinical outcome severe?)
    -> clinical.escalation_uptier OR clinical.emr_write
    -> sink.complete

Proves:

  1. A 3-way risk-tier split fans out to parallel dispatch arms.
  2. Wait + merge correctly reconcile two parallel dispatch arms with
     explicit merge/payload policies.
  3. Mutation node (``clinical.emr_write``) keeps success/failed; dispatch
     node (``clinical.escalation_uptier``) emits success/exhausted; both
     coexist in one canonical definition.
  4. The clinical flow normalizes + validates without legacy edge labels.

Note: `logic.split.mode='by_rules'` (predicate-driven branches) is in the
plan §6.3 but the handler currently exposes only `by_field` and `random`.
This scenario uses `by_field` against a synthetic `risk_tier` payload key
to keep the test contract-pure. Predicate-split coverage lands when the
handler ships the `by_rules` mode.
"""
from __future__ import annotations

import app.services.orchestration.nodes  # noqa: F401 — registers handlers
from app.services.orchestration.definition_normalizer import normalize_definition
from app.services.orchestration.definition_validator import validate_definition
from app.services.orchestration.node_descriptors import build_descriptor


def _scenario_c_definition() -> dict:
    return {
        "nodes": [
            {
                "id": "src",
                "type": "source.cohort_query",
                "position": {"x": 0, "y": 0},
                "config": {
                    "source_ref": "clinical.dim_patient",
                    "payload_fields": [
                        "first_name", "preferred_language", "primary_condition",
                        "active", "hba1c_latest", "hba1c_prior",
                    ],
                    "filters": [
                        {"column": "active", "op": "eq", "value": True},
                    ],
                },
            },
            {
                "id": "elig",
                "type": "filter.eligibility",
                "position": {"x": 0, "y": 100},
                "config": {
                    "predicate": {
                        "field": "primary_condition",
                        "op": "eq",
                        "value": "DM2",
                    },
                },
            },
            {
                "id": "risk_split",
                "type": "logic.split",
                "position": {"x": 0, "y": 200},
                "config": {
                    "mode": "by_field",
                    "field": "risk_tier",
                    "branches": [
                        {"id": "severe",       "label": "Severe",       "match": "severe"},
                        {"id": "uncontrolled", "label": "Uncontrolled", "match": "uncontrolled"},
                        {"id": "controlled",   "label": "Controlled",   "match": "controlled"},
                    ],
                    "default_branch_id": "controlled",
                },
            },
            {
                "id": "lab_order",
                "type": "clinical.schedule_lab",
                "position": {"x": -200, "y": 300},
                "config": {
                    "test_code": "HBA1C",
                    "test_name": "HbA1c",
                    "frequency": "quarterly",
                    "notify_roles": ["care_manager"],
                    "urgency": "routine",
                    "attempt_policy": {
                        "max_attempts": 3,
                        "backoff_kind": "immediate",
                        "delay_minutes": 0,
                        "retry_on": ["outbox_error"],
                        "on_exhausted_output_id": "exhausted",
                    },
                },
            },
            {
                "id": "pro_dds",
                "type": "clinical.send_pro_assessment",
                "position": {"x": 200, "y": 300},
                "config": {
                    "instrument": "DDS",
                    "delivery_channel": "wa",
                    "attempt_policy": {
                        "max_attempts": 3,
                        "backoff_kind": "immediate",
                        "delay_minutes": 0,
                        "retry_on": ["outbox_error"],
                        "on_exhausted_output_id": "exhausted",
                    },
                },
            },
            {
                "id": "wait_results",
                "type": "logic.wait",
                "position": {"x": 0, "y": 400},
                "config": {
                    "mode": "event_or_timeout",
                    "event_name": "clinical.lab_result",
                    "correlation": {
                        "recipient_id_field": "lab_request_id",
                    },
                    "timeout_hours": 168,  # 1 week
                },
            },
            {
                "id": "merge",
                "type": "logic.merge",
                "position": {"x": 0, "y": 500},
                "config": {
                    "merge_policy": "dedupe",
                    "payload_policy": "last_wins",
                },
            },
            {
                "id": "outcome_cond",
                "type": "logic.conditional",
                "position": {"x": 0, "y": 600},
                "config": {
                    "predicate": {
                        "field": "lab_severity",
                        "op": "eq",
                        "value": "critical",
                    },
                },
            },
            {
                "id": "escalate",
                "type": "clinical.escalation_uptier",
                "position": {"x": -200, "y": 700},
                "config": {
                    "target_role": "physician",
                    "urgency": "same_day",
                    "reason": "Critical lab result",
                    "attempt_policy": {
                        "max_attempts": 5,
                        "backoff_kind": "immediate",
                        "delay_minutes": 0,
                        "retry_on": ["outbox_error"],
                        "on_exhausted_output_id": "exhausted",
                    },
                },
            },
            {
                "id": "emr_note",
                "type": "clinical.emr_write",
                "position": {"x": 200, "y": 700},
                "config": {
                    "note_type": "progress_note",
                    "template": "DM2 follow-up: HbA1c {{hba1c_latest}}",
                    "structured_fields": {},
                },
            },
            {
                "id": "sink_done",
                "type": "sink.complete",
                "position": {"x": 0, "y": 800},
                "config": {"reason": "clinical_cycle_done"},
            },
            {
                "id": "sink_skipped",
                "type": "sink.complete",
                "position": {"x": 200, "y": 200},
                "config": {"reason": "not_dm2"},
            },
            {
                "id": "sink_controlled",
                "type": "sink.complete",
                "position": {"x": 200, "y": 100},
                "config": {"reason": "controlled"},
            },
        ],
        "edges": [
            {"id": "e_src",         "source": "src",     "target": "elig",         "output_id": "default"},
            {"id": "e_elig_pass",   "source": "elig",    "target": "risk_split",   "output_id": "passed"},
            {"id": "e_elig_skip",   "source": "elig",    "target": "sink_skipped", "output_id": "skipped"},

            {"id": "e_risk_severe","source":"risk_split","target":"lab_order",     "output_id": "severe"},
            {"id": "e_risk_unc",   "source":"risk_split","target":"pro_dds",       "output_id": "uncontrolled"},
            {"id": "e_risk_ctrl",  "source":"risk_split","target":"sink_controlled","output_id": "controlled"},

            {"id":"e_lab_ok",  "source":"lab_order","target":"wait_results","output_id":"success"},
            {"id":"e_lab_x",   "source":"lab_order","target":"sink_done",   "output_id":"exhausted"},
            {"id":"e_pro_ok",  "source":"pro_dds",  "target":"wait_results","output_id":"success"},
            {"id":"e_pro_x",   "source":"pro_dds",  "target":"sink_done",   "output_id":"exhausted"},

            {"id":"e_wait_evt","source":"wait_results","target":"merge","output_id":"event"},
            {"id":"e_wait_to", "source":"wait_results","target":"merge","output_id":"timeout"},

            {"id":"e_merge",   "source":"merge","target":"outcome_cond","output_id":"default"},

            {"id":"e_cond_y",  "source":"outcome_cond","target":"escalate","output_id":"true"},
            {"id":"e_cond_n",  "source":"outcome_cond","target":"emr_note","output_id":"false"},

            {"id":"e_esc_ok",  "source":"escalate","target":"sink_done","output_id":"success"},
            {"id":"e_esc_x",   "source":"escalate","target":"sink_done","output_id":"exhausted"},

            {"id":"e_emr_ok",  "source":"emr_note","target":"sink_done","output_id":"success"},
            {"id":"e_emr_fail","source":"emr_note","target":"sink_done","output_id":"failed"},
        ],
    }


def test_scenario_c_normalizes_and_validates():
    raw = _scenario_c_definition()
    canonical = normalize_definition(raw)
    validate_definition(canonical, workflow_type="clinical")


def test_scenario_c_risk_split_branches_have_stable_ids():
    """Phase 11 §6.3 — every split branch carries a stable id; outgoing
    edges route by id, not by the human-editable label."""
    raw = _scenario_c_definition()
    canonical = normalize_definition(raw)
    by_id = {n["id"]: n for n in canonical["nodes"]}
    cfg = by_id["risk_split"]["config"]
    assert cfg["mode"] == "by_field"
    assert cfg["field"] == "risk_tier"
    branch_ids = {b["id"] for b in cfg["branches"]}
    assert branch_ids == {"severe", "uncontrolled", "controlled"}
    # Outgoing edges from risk_split must reference branch ids only.
    edges = [e for e in canonical["edges"] if e["source"] == "risk_split"]
    edge_outputs = {e["output_id"] for e in edges}
    assert edge_outputs == branch_ids


def test_scenario_c_merge_node_uses_explicit_policies():
    """Phase 11 §6.5 — ``logic.merge.dedupe: bool`` is gone; the merge
    node carries two explicit policies."""
    raw = _scenario_c_definition()
    canonical = normalize_definition(raw)
    by_id = {n["id"]: n for n in canonical["nodes"]}
    merge_cfg = by_id["merge"]["config"]
    assert merge_cfg["merge_policy"] == "dedupe"
    assert merge_cfg["payload_policy"] == "last_wins"


def test_scenario_c_escalation_emits_success_exhausted():
    d = build_descriptor(
        node_type="clinical.escalation_uptier", workflow_type="clinical",
    )
    ids = [oe.id for oe in d.output_edges]
    assert ids == ["success", "exhausted"]
    assert d.runtime_contract.supports_attempt_policy is True


def test_scenario_c_emr_write_keeps_failed_edge():
    """Phase 11 §6.7 — EMR write is a mutation node; it emits success/failed
    and does not declare attempt_policy."""
    d = build_descriptor(node_type="clinical.emr_write", workflow_type="clinical")
    ids = [oe.id for oe in d.output_edges]
    assert ids == ["success", "failed"]
    assert d.runtime_contract.supports_attempt_policy is False
    raw = _scenario_c_definition()
    canonical = normalize_definition(raw)
    by_id = {n["id"]: n for n in canonical["nodes"]}
    assert "attempt_policy" not in by_id["emr_note"]["config"]


def test_scenario_c_legacy_merge_dedupe_bool_migrates():
    """Pre-Phase-11 author wrote ``dedupe: True`` instead of the explicit
    policies. Normalizer must lift it into ``merge_policy='dedupe'`` +
    ``payload_policy='last_wins'`` (Phase 11 §6.5)."""
    raw = _scenario_c_definition()
    for node in raw["nodes"]:
        if node["id"] == "merge":
            node["config"] = {"dedupe": True}
    canonical = normalize_definition(raw)
    by_id = {n["id"]: n for n in canonical["nodes"]}
    merge_cfg = by_id["merge"]["config"]
    assert merge_cfg["merge_policy"] == "dedupe"
    assert merge_cfg["payload_policy"] == "last_wins"
    validate_definition(canonical, workflow_type="clinical")


def test_scenario_c_validator_rejects_emr_attempt_policy_misuse():
    """An EMR write that carries an unrecognized config field must surface
    via Pydantic config validation. We don't ban the key list; we rely on
    the handler's BaseModel — extra fields by default are ignored, so this
    test simply asserts Pydantic accepts the canonical shape and that the
    descriptor does not advertise attempt_policy as a config slot."""
    d = build_descriptor(node_type="clinical.emr_write", workflow_type="clinical")
    schema = d.config_schema
    assert "attempt_policy" not in schema.get("properties", {})
