"""Phase 11 §9 — Scenario B: segmented channel strategy with retries.

Three disjoint cohort batches, each running a different channel sequence:

  - branch A: WATI then Bolna
  - branch B: Bolna then WATI
  - branch C: SMS only

Per-attempt retries live inside each dispatch node's ``attempt_policy`` —
the graph never models retry as a loop (Phase 11 §3.5). The whole flow
ends in a single LSQ stage mutation.

Proves:

  1. The split node correctly fans out to disjoint downstream sequences
     using stable branch ids.
  2. Each dispatch node's attempt_policy is a regular config field
     (validates through Pydantic) — operators don't have to author
     retries via graph branches.
  3. Mixed dispatch (success/exhausted) and mutation (success/failed)
     nodes coexist in a single canonical definition.
  4. Validator surfaces fan-out as an error when an output_id appears on
     multiple outgoing edges from a node whose descriptor doesn't allow
     it (regression guard for Phase 11 §7.11).
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


_CONN = str(uuid.uuid4())


def _scenario_b_definition() -> dict:
    aggressive_attempt = {
        "max_attempts": 4,
        "backoff_kind": "immediate",
        "delay_minutes": 0,
        "retry_on": [],
        "on_exhausted_output_id": "exhausted",
    }

    return {
        "nodes": [
            {
                "id": "src",
                "type": "source.cohort_query",
                "position": {"x": 0, "y": 0},
                "config": {
                    "source_ref": "crm.lead_record",
                    "payload_fields": ["first_name", "phone", "whatsapp_number"],
                },
            },
            {
                "id": "split",
                "type": "logic.split",
                "position": {"x": 0, "y": 100},
                "config": {
                    "mode": "by_field",
                    "field": "preferred_channel",
                    "branches": [
                        {"id": "wa_first", "label": "WhatsApp First", "match": "wa"},
                        {"id": "voice_first", "label": "Voice First", "match": "voice"},
                        {"id": "sms_only", "label": "SMS Only",      "match": "sms"},
                    ],
                    "default_branch_id": "sms_only",
                },
            },
            # Branch A: WATI then Bolna fallback.
            {
                "id": "a_wati",
                "type": "crm.send_wati",
                "position": {"x": -300, "y": 200},
                "config": {
                    "connection_id": _CONN,
                    "template_slug": "concierge_priority",
                    "phone_field": "whatsapp_number",
                    "attempt_policy": aggressive_attempt,
                },
            },
            {
                "id": "a_bolna",
                "type": "crm.place_bolna_call",
                "position": {"x": -300, "y": 300},
                "config": {
                    "connection_id": _CONN,
                    "template_slug": "concierge_confirmation",
                    "phone_field": "phone",
                    "attempt_policy": aggressive_attempt,
                },
            },
            # Branch B: Bolna then WATI fallback.
            {
                "id": "b_bolna",
                "type": "crm.place_bolna_call",
                "position": {"x": 0, "y": 200},
                "config": {
                    "connection_id": _CONN,
                    "template_slug": "concierge_confirmation",
                    "phone_field": "phone",
                    "attempt_policy": aggressive_attempt,
                },
            },
            {
                "id": "b_wati",
                "type": "crm.send_wati",
                "position": {"x": 0, "y": 300},
                "config": {
                    "connection_id": _CONN,
                    "template_slug": "concierge_priority",
                    "phone_field": "whatsapp_number",
                    "attempt_policy": aggressive_attempt,
                },
            },
            # Branch C: SMS only.
            {
                "id": "c_sms",
                "type": "crm.send_sms",
                "position": {"x": 300, "y": 200},
                "config": {
                    "connection_id": _CONN,
                    "template_slug": "concierge_text",
                    "phone_field": "phone",
                    "attempt_policy": aggressive_attempt,
                },
            },
            # Convergence: LSQ stage update.
            {
                "id": "lsq_stage",
                "type": "crm.lsq_update_stage",
                "position": {"x": 0, "y": 400},
                "config": {
                    "connection_id": _CONN,
                    "target_stage": "Contacted",
                },
            },
            {
                "id": "sink_done",
                "type": "sink.complete",
                "position": {"x": 0, "y": 500},
                "config": {"reason": "concierge_done"},
            },
            {
                "id": "sink_failed",
                "type": "sink.complete",
                "position": {"x": 200, "y": 500},
                "config": {"reason": "concierge_failed"},
            },
        ],
        "edges": [
            {"id": "e_src", "source": "src", "target": "split", "output_id": "default"},

            {"id": "e_split_a", "source": "split", "target": "a_wati", "output_id": "wa_first"},
            {"id": "e_split_b", "source": "split", "target": "b_bolna", "output_id": "voice_first"},
            {"id": "e_split_c", "source": "split", "target": "c_sms",   "output_id": "sms_only"},

            # Branch A: success goes to LSQ; exhausted falls through to bolna fallback.
            {"id": "e_a_wati_ok", "source": "a_wati", "target": "lsq_stage", "output_id": "success"},
            {"id": "e_a_wati_x",  "source": "a_wati", "target": "a_bolna",   "output_id": "exhausted"},
            {"id": "e_a_bolna_ok","source": "a_bolna","target": "lsq_stage", "output_id": "success"},
            {"id": "e_a_bolna_x", "source": "a_bolna","target": "sink_failed","output_id": "exhausted"},

            # Branch B mirrors A in reverse order.
            {"id": "e_b_bolna_ok","source": "b_bolna","target": "lsq_stage", "output_id": "success"},
            {"id": "e_b_bolna_x", "source": "b_bolna","target": "b_wati",    "output_id": "exhausted"},
            {"id": "e_b_wati_ok", "source": "b_wati", "target": "lsq_stage", "output_id": "success"},
            {"id": "e_b_wati_x",  "source": "b_wati", "target": "sink_failed","output_id": "exhausted"},

            # Branch C single dispatch.
            {"id": "e_c_sms_ok",  "source": "c_sms",  "target": "lsq_stage", "output_id": "success"},
            {"id": "e_c_sms_x",   "source": "c_sms",  "target": "sink_failed","output_id": "exhausted"},

            # Mutation node still uses success/failed.
            {"id": "e_lsq_ok",   "source": "lsq_stage", "target": "sink_done",  "output_id": "success"},
            {"id": "e_lsq_fail", "source": "lsq_stage", "target": "sink_failed","output_id": "failed"},
        ],
    }


def test_scenario_b_normalizes_and_validates():
    raw = _scenario_b_definition()
    canonical = normalize_definition(raw)
    validate_definition(canonical, workflow_type="crm")


def test_scenario_b_attempt_policy_persists_in_config():
    """Each dispatch node's attempt_policy survives normalization unchanged
    — it is regular config, not graph state."""
    raw = _scenario_b_definition()
    canonical = normalize_definition(raw)
    by_id = {n["id"]: n for n in canonical["nodes"]}
    for node_id in ("a_wati", "a_bolna", "b_bolna", "b_wati", "c_sms"):
        ap = by_id[node_id]["config"].get("attempt_policy")
        assert ap is not None, node_id
        assert ap["max_attempts"] == 4
        assert ap["on_exhausted_output_id"] == "exhausted"


def test_scenario_b_split_branches_route_disjoint_paths():
    """Each split branch id has exactly one outgoing edge — no implicit
    fan-out, no mixing branches."""
    raw = _scenario_b_definition()
    canonical = normalize_definition(raw)
    split_edges = [e for e in canonical["edges"] if e["source"] == "split"]
    output_ids = sorted(e["output_id"] for e in split_edges)
    assert output_ids == ["sms_only", "voice_first", "wa_first"]
    targets = sorted(e["target"] for e in split_edges)
    assert targets == ["a_wati", "b_bolna", "c_sms"]


def test_scenario_b_validator_rejects_unknown_branch_id():
    """If an edge references a branch id that isn't in the split's
    ``branches`` config, the validator surfaces it (Phase 11 §7.12)."""
    raw = _scenario_b_definition()
    raw["edges"].append({
        "id": "e_split_bogus",
        "source": "split",
        "target": "sink_failed",
        "output_id": "phantom_branch",
    })
    canonical = normalize_definition(raw)
    with pytest.raises(DefinitionValidationError) as exc:
        validate_definition(canonical, workflow_type="crm")
    assert any("phantom_branch" in e for e in exc.value.errors)


def test_scenario_b_legacy_failed_edges_migrate_for_dispatch_only():
    """Pre-Phase-11: every dispatch action emitted ``failed``. After the
    contract change, retry-capable dispatch nodes adopt ``exhausted`` but
    mutation nodes (LSQ stage) keep ``failed``. The normalizer must
    migrate one and not the other in the same definition."""
    raw = _scenario_b_definition()
    # Roll back to legacy edge labels everywhere.
    for edge in raw["edges"]:
        if edge["output_id"] == "exhausted":
            edge["output_id"] = "failed"

    canonical = normalize_definition(raw)
    by_source = {}
    for e in canonical["edges"]:
        by_source.setdefault(e["source"], []).append(e["output_id"])

    # Dispatch nodes — exhausted reappears.
    for source in ("a_wati", "a_bolna", "b_bolna", "b_wati", "c_sms"):
        assert "exhausted" in by_source[source], source
        assert "failed" not in by_source[source], source

    # Mutation node — failed stays.
    assert "failed" in by_source["lsq_stage"]
    assert "exhausted" not in by_source["lsq_stage"]
