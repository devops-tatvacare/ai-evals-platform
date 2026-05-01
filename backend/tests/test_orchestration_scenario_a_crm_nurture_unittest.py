"""Phase 11 §9 — Scenario A: CRM nurture with engagement wait.

Proves the contract supports this end-to-end shape, *without* running it
against a real DB. Each scenario test:

  1. Builds a workflow definition as raw JSON.
  2. Normalises it through ``definition_normalizer.normalize_definition``.
  3. Validates it through ``definition_validator.validate_definition``.
  4. Asserts the canonical form carries the right output_ids, node types,
     and the descriptor-declared payload IO that downstream nodes need.
  5. Spot-checks idempotency by re-running normalize on the canonical form.

Scenario A graph (from plan §9):

  cohort_query -> split (mql_score) -> WATI dispatch
                -> wait (event_or_timeout: replied | 4h)
                -> Bolna call dispatch
                -> wait (event_or_timeout: call_done | 1h)
                -> conditional (intent == 'confirmed')
                -> LSQ stage update -> sink.complete

The proof is *contract-level*: every dispatch node emits success/exhausted
under attempt_policy, every wait is a discriminated-union mode, every
mutation node keeps success/failed, and the validator passes the whole
graph as one canonical structure.
"""
from __future__ import annotations

import uuid

import pytest

import app.services.orchestration.nodes  # noqa: F401 — registers handlers
from app.services.orchestration.definition_normalizer import normalize_definition
from app.services.orchestration.definition_validator import (
    DefinitionValidationError,
    validate_definition,
)
from app.services.orchestration.node_descriptors import build_descriptor


_FAKE_CONNECTION_ID = str(uuid.uuid4())


def _scenario_a_definition() -> dict:
    return {
        "nodes": [
            {
                "id": "src",
                "type": "source.cohort_query",
                "position": {"x": 0, "y": 0},
                "config": {
                    "source_ref": "crm.lead_record",
                    "payload_fields": [
                        "first_name", "phone", "whatsapp_number",
                        "mql_score", "prospect_stage",
                    ],
                    "lookback_hours": 24,
                    "lookback_column": "created_on",
                },
            },
            {
                "id": "split",
                "type": "logic.split",
                "position": {"x": 0, "y": 100},
                "config": {
                    "mode": "by_field",
                    "field": "mql_score",
                    "branches": [
                        {"id": "high", "label": "High",   "match": "5"},
                        {"id": "mid",  "label": "Mid",    "match": "3"},
                        {"id": "low",  "label": "Low",    "match": "1"},
                    ],
                    "default_branch_id": "low",
                },
            },
            {
                "id": "wati_dispatch",
                "type": "crm.send_wati",
                "position": {"x": -100, "y": 200},
                "config": {
                    "connection_id": _FAKE_CONNECTION_ID,
                    "template_slug": "concierge_priority",
                    "phone_field": "whatsapp_number",
                    "attempt_policy": {
                        "max_attempts": 3,
                        "backoff_kind": "immediate",
                        "delay_minutes": 0,
                        "retry_on": ["wati_service_error"],
                        "on_exhausted_output_id": "exhausted",
                    },
                },
            },
            {
                "id": "wait_replied",
                "type": "logic.wait",
                "position": {"x": -100, "y": 300},
                "config": {
                    "mode": "event_or_timeout",
                    "event_name": "wati.message_replied",
                    "correlation": {
                        "recipient_id_field": "wati_local_message_id",
                    },
                    "timeout_hours": 4,
                },
            },
            {
                "id": "bolna_call",
                "type": "crm.place_bolna_call",
                "position": {"x": -100, "y": 400},
                "config": {
                    "connection_id": _FAKE_CONNECTION_ID,
                    "template_slug": "concierge_confirmation",
                    "phone_field": "phone",
                    "attempt_policy": {
                        "max_attempts": 2,
                        "backoff_kind": "immediate",
                        "delay_minutes": 0,
                        "retry_on": ["bolna_service_error"],
                        "on_exhausted_output_id": "exhausted",
                    },
                },
            },
            {
                "id": "wait_call_done",
                "type": "logic.wait",
                "position": {"x": -100, "y": 500},
                "config": {
                    "mode": "event_or_timeout",
                    "event_name": "bolna.call_completed",
                    "correlation": {
                        "recipient_id_field": "bolna_call_id",
                    },
                    "timeout_hours": 1,
                },
            },
            {
                "id": "cond_intent",
                "type": "logic.conditional",
                "position": {"x": -100, "y": 600},
                "config": {
                    "predicate": {
                        "field": "call_intent",
                        "op": "eq",
                        "value": "confirmed",
                    },
                },
            },
            {
                "id": "lsq_confirm",
                "type": "crm.lsq_update_stage",
                "position": {"x": -100, "y": 700},
                "config": {
                    "connection_id": _FAKE_CONNECTION_ID,
                    "target_stage": "Slot Confirmed",
                },
            },
            {
                "id": "sink_done",
                "type": "sink.complete",
                "position": {"x": -100, "y": 800},
                "config": {"reason": "concierge_completed"},
            },
            {
                "id": "sink_no_intent",
                "type": "sink.complete",
                "position": {"x": 100, "y": 700},
                "config": {"reason": "no_intent"},
            },
            {
                "id": "sink_failed",
                "type": "sink.complete",
                "position": {"x": 200, "y": 700},
                "config": {"reason": "concierge_failed"},
            },
        ],
        "edges": [
            {"id": "e_src",      "source": "src",   "target": "split",         "output_id": "default"},
            {"id": "e_split_h",  "source": "split", "target": "wati_dispatch", "output_id": "high"},
            {"id": "e_split_m",  "source": "split", "target": "wati_dispatch", "output_id": "mid"},
            {"id": "e_split_l",  "source": "split", "target": "wati_dispatch", "output_id": "low"},

            {"id": "e_wati_ok",  "source": "wati_dispatch", "target": "wait_replied", "output_id": "success"},
            {"id": "e_wati_x",   "source": "wati_dispatch", "target": "sink_failed",  "output_id": "exhausted"},

            {"id": "e_wait_evt", "source": "wait_replied", "target": "bolna_call", "output_id": "event"},
            {"id": "e_wait_to",  "source": "wait_replied", "target": "bolna_call", "output_id": "timeout"},

            {"id": "e_bolna_ok", "source": "bolna_call", "target": "wait_call_done", "output_id": "success"},
            {"id": "e_bolna_x",  "source": "bolna_call", "target": "sink_failed",    "output_id": "exhausted"},

            {"id": "e_wcd_evt",  "source": "wait_call_done", "target": "cond_intent", "output_id": "event"},
            {"id": "e_wcd_to",   "source": "wait_call_done", "target": "cond_intent", "output_id": "timeout"},

            {"id": "e_intent_y", "source": "cond_intent", "target": "lsq_confirm",   "output_id": "true"},
            {"id": "e_intent_n", "source": "cond_intent", "target": "sink_no_intent","output_id": "false"},

            {"id": "e_lsq_ok",   "source": "lsq_confirm", "target": "sink_done",   "output_id": "success"},
            {"id": "e_lsq_fail", "source": "lsq_confirm", "target": "sink_failed", "output_id": "failed"},
        ],
    }


def test_scenario_a_normalizes_and_validates():
    """The CRM nurture scenario survives normalize + validate end-to-end."""
    raw = _scenario_a_definition()
    canonical = normalize_definition(raw)
    validate_definition(canonical, workflow_type="crm")

    # Spot check: canonical edges all carry an explicit output_id.
    for edge in canonical["edges"]:
        assert edge.get("output_id"), f"edge {edge['id']} missing output_id"


def test_scenario_a_dispatch_nodes_emit_success_exhausted():
    """Phase 11 §6.6 — every retry-capable dispatch node in this scenario
    must declare ``success`` / ``exhausted`` as workflow-visible outputs."""
    for node_type in ("crm.send_wati", "crm.place_bolna_call"):
        d = build_descriptor(node_type=node_type, workflow_type="crm")
        ids = [oe.id for oe in d.output_edges]
        assert ids == ["success", "exhausted"], (node_type, ids)
        assert d.runtime_contract.supports_attempt_policy is True


def test_scenario_a_mutation_keeps_failed_edge():
    """Phase 11 §6.7 — LSQ stage update is a mutation, not a dispatch."""
    d = build_descriptor(node_type="crm.lsq_update_stage", workflow_type="crm")
    ids = [oe.id for oe in d.output_edges]
    assert ids == ["success", "failed"]
    assert d.runtime_contract.supports_attempt_policy is False


def test_scenario_a_wait_event_or_timeout_outputs_match_mode():
    """Phase 11 §6.4 — ``event_or_timeout`` waits expose ``event`` and
    ``timeout`` outputs; the validator rejects edges referencing
    ``wakeup``."""
    raw = _scenario_a_definition()
    # Inject a bogus wakeup edge; validator must complain.
    raw["edges"].append({
        "id": "e_bogus",
        "source": "wait_replied",
        "target": "sink_failed",
        "output_id": "wakeup",
    })
    canonical = normalize_definition(raw)
    with pytest.raises(DefinitionValidationError) as exc:
        validate_definition(canonical, workflow_type="crm")
    assert any("wakeup" in e for e in exc.value.errors)


def test_scenario_a_normalizer_idempotent():
    """Running the normalizer twice on the canonical form must be a no-op."""
    raw = _scenario_a_definition()
    once = normalize_definition(raw)
    twice = normalize_definition(once)
    assert once == twice


def test_scenario_a_legacy_failed_edge_migrates_to_exhausted():
    """A pre-Phase-11 author wired the WATI failure to ``failed`` instead
    of ``exhausted``. The normalizer migrates the edge so the validator
    sees the canonical form (Phase 11 §6.6)."""
    raw = _scenario_a_definition()
    for edge in raw["edges"]:
        if edge["source"] == "wati_dispatch" and edge["output_id"] == "exhausted":
            edge["output_id"] = "failed"
    canonical = normalize_definition(raw)
    wati_edges = [e for e in canonical["edges"] if e["source"] == "wati_dispatch"]
    output_ids = sorted(e["output_id"] for e in wati_edges)
    assert output_ids == ["exhausted", "success"]
    # Canonical form still validates clean.
    validate_definition(canonical, workflow_type="crm")
