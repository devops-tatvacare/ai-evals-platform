"""Phase 11 — definition validator tests.

Each test feeds the validator a canonical (post-normalization) definition
and asserts the right rule fires (or doesn't).
"""
from __future__ import annotations

import pytest

import app.services.orchestration.nodes  # noqa: F401 — register handlers
from app.services.orchestration.definition_normalizer import normalize_definition
from app.services.orchestration.definition_validator import (
    DefinitionValidationError,
    validate_definition,
)


def _wf(nodes, edges):
    return {"nodes": nodes, "edges": edges, "canvas": {}}


_VALID_COHORT_QUERY_NODE = {
    "id": "src",
    "type": "source.cohort_query",
    "position": {"x": 0, "y": 0},
    "data": {},
    "config": {
        "source_ref": "crm.lead_record",
        "payload_fields": ["first_name"],
    },
}

_VALID_SINK_NODE = {
    "id": "done",
    "type": "sink.complete",
    "position": {"x": 0, "y": 200},
    "data": {},
    "config": {},
}


def _minimal_valid():
    return _wf(
        [_VALID_COHORT_QUERY_NODE, _VALID_SINK_NODE],
        [{"id": "e1", "source": "src", "target": "done", "output_id": "default"}],
    )


def test_minimal_valid_workflow_passes():
    validate_definition(_minimal_valid(), workflow_type="crm")


def test_duplicate_node_id_fails():
    nodes = [
        _VALID_COHORT_QUERY_NODE,
        {**_VALID_COHORT_QUERY_NODE, "id": "src"},  # duplicate id
        _VALID_SINK_NODE,
    ]
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(_wf(nodes, []), workflow_type="crm")
    assert any("duplicate node id" in e for e in (it["message"] for it in exc_info.value.errors))


def test_edge_references_unknown_node_fails():
    defn = _minimal_valid()
    defn["edges"].append({"id": "e2", "source": "ghost", "target": "done", "output_id": "default"})
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("ghost" in e for e in (it["message"] for it in exc_info.value.errors))


def test_unknown_node_type_fails():
    nodes = [{"id": "x", "type": "not.a.real.type", "position": {"x": 0, "y": 0}, "data": {}, "config": {}}]
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(_wf(nodes, []), workflow_type="crm")
    assert any("not.a.real.type" in e for e in (it["message"] for it in exc_info.value.errors))


def test_invalid_node_config_fails():
    bad_cohort = {
        **_VALID_COHORT_QUERY_NODE,
        "config": {},  # no source_ref or legacy fields
    }
    defn = _wf([bad_cohort, _VALID_SINK_NODE],
               [{"id": "e1", "source": "src", "target": "done", "output_id": "default"}])
    with pytest.raises(DefinitionValidationError):
        validate_definition(defn, workflow_type="crm")


def test_invalid_filter_predicate_contract_fails():
    bad_filter = {
        "id": "filter",
        "type": "filter.eligibility",
        "position": {"x": 0, "y": 100},
        "data": {},
        "config": {
            "predicate": {"field": "phone", "op": "exists", "value": "stale"},
        },
    }
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, bad_filter, _VALID_SINK_NODE],
        [
            {"id": "e1", "source": "src", "target": "filter", "output_id": "default"},
            {"id": "e2", "source": "filter", "target": "done", "output_id": "passed"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("does not accept a value" in e for e in (it["message"] for it in exc_info.value.errors))


def test_invalid_cohort_filter_value_shape_fails():
    bad_source = {
        **_VALID_COHORT_QUERY_NODE,
        "config": {
            "source_ref": "crm.lead_record",
            "filters": [{"column": "city", "op": "in", "value": []}],
        },
    }
    defn = _wf(
        [bad_source, _VALID_SINK_NODE],
        [{"id": "e1", "source": "src", "target": "done", "output_id": "default"}],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("non-empty list value" in e for e in (it["message"] for it in exc_info.value.errors))


def test_split_rejects_stale_random_fields_in_by_field_mode():
    split_node = {
        "id": "split",
        "type": "logic.split",
        "position": {"x": 0, "y": 100},
        "data": {},
        "config": {
            "mode": "by_field",
            "field": "tier",
            "branches": [
                {"id": "high", "label": "High", "match": "high", "weight": 10},
                {"id": "low", "label": "Low", "match": "low", "weight": 90},
            ],
        },
    }
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, split_node, _VALID_SINK_NODE],
        [
            {"id": "e_in", "source": "src", "target": "split", "output_id": "default"},
            {"id": "e_h", "source": "split", "target": "done", "output_id": "high"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("must not carry random 'weight'" in e for e in (it["message"] for it in exc_info.value.errors))


def test_split_rejects_stale_by_field_fields_in_random_mode():
    split_node = {
        "id": "split",
        "type": "logic.split",
        "position": {"x": 0, "y": 100},
        "data": {},
        "config": {
            "mode": "random",
            "field": "tier",
            "default_branch_id": "high",
            "drop_unmatched": True,
            "branches": [
                {"id": "high", "label": "High", "weight": 50, "match": "high"},
                {"id": "low", "label": "Low", "weight": 50, "match": "low"},
            ],
        },
    }
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, split_node, _VALID_SINK_NODE],
        [
            {"id": "e_in", "source": "src", "target": "split", "output_id": "default"},
            {"id": "e_h", "source": "split", "target": "done", "output_id": "high"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("'field' is not allowed when mode='random'" in e for e in (it["message"] for it in exc_info.value.errors))


def test_invalid_wait_event_match_predicate_fails():
    wait_node = {
        "id": "wait",
        "type": "logic.wait",
        "position": {"x": 0, "y": 100},
        "data": {},
        "config": {
            "mode": "event",
            "event_name": "lead_replied",
            "correlation": {"recipient_id_field": "lead_id"},
            "event_match": {"field": "stage", "op": "in", "value": []},
        },
    }
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, wait_node, _VALID_SINK_NODE],
        [
            {"id": "e1", "source": "src", "target": "wait", "output_id": "default"},
            {"id": "e2", "source": "wait", "target": "done", "output_id": "event"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("non-empty list value" in e for e in (it["message"] for it in exc_info.value.errors))


def test_no_ingress_node_fails():
    defn = _wf([_VALID_SINK_NODE], [])
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("ingress" in e for e in (it["message"] for it in exc_info.value.errors))


def test_source_must_have_exactly_one_default_edge():
    # Missing default edge:
    defn = _wf([_VALID_COHORT_QUERY_NODE, _VALID_SINK_NODE], [])
    with pytest.raises(DefinitionValidationError):
        validate_definition(defn, workflow_type="crm")
    # Two default edges from source:
    defn2 = _wf(
        [_VALID_COHORT_QUERY_NODE,
         _VALID_SINK_NODE,
         {**_VALID_SINK_NODE, "id": "done2"}],
        [
            {"id": "e1", "source": "src", "target": "done", "output_id": "default"},
            {"id": "e2", "source": "src", "target": "done2", "output_id": "default"},
        ],
    )
    with pytest.raises(DefinitionValidationError):
        validate_definition(defn2, workflow_type="crm")


def test_sink_with_outgoing_edges_fails():
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, _VALID_SINK_NODE,
         {**_VALID_SINK_NODE, "id": "extra"}],
        [
            {"id": "e1", "source": "src", "target": "done", "output_id": "default"},
            {"id": "e2", "source": "done", "target": "extra", "output_id": "default"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("must not have outgoing" in e for e in (it["message"] for it in exc_info.value.errors))


def test_split_branch_id_stability_required():
    split_node = {
        "id": "split",
        "type": "logic.split",
        "position": {"x": 0, "y": 100},
        "data": {},
        "config": {
            "mode": "by_field",
            "field": "tier",
            "branches": [
                {"id": "high", "label": "High Tier", "match": "high"},
                {"id": "low",  "label": "Low Tier",  "match": "low"},
            ],
            "default_branch_id": "low",
        },
    }
    sink2 = {**_VALID_SINK_NODE, "id": "sink2"}
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, split_node, _VALID_SINK_NODE, sink2],
        [
            {"id": "e_in", "source": "src", "target": "split", "output_id": "default"},
            {"id": "e_h", "source": "split", "target": "done",  "output_id": "high"},
            {"id": "e_l", "source": "split", "target": "sink2", "output_id": "low"},
        ],
    )
    validate_definition(defn, workflow_type="crm")


def test_split_routes_unknown_branch_fails():
    split_node = {
        "id": "split",
        "type": "logic.split",
        "position": {"x": 0, "y": 100},
        "data": {},
        "config": {
            "mode": "by_field",
            "field": "tier",
            "branches": [
                {"id": "high", "label": "High", "match": "high"},
                {"id": "low",  "label": "Low",  "match": "low"},
            ],
            "default_branch_id": "low",
        },
    }
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, split_node, _VALID_SINK_NODE],
        [
            {"id": "e_in", "source": "src", "target": "split", "output_id": "default"},
            {"id": "e_bad", "source": "split", "target": "done", "output_id": "ghost"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("ghost" in e for e in (it["message"] for it in exc_info.value.errors))


def test_wait_event_mode_with_only_wakeup_edge_fails():
    wait_node = {
        "id": "wait",
        "type": "logic.wait",
        "position": {"x": 0, "y": 100},
        "data": {},
        "config": {
            "mode": "event",
            "event_name": "lead_replied",
            "correlation": {"recipient_id_field": "lead_id"},
        },
    }
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, wait_node, _VALID_SINK_NODE],
        [
            {"id": "e_in", "source": "src", "target": "wait", "output_id": "default"},
            {"id": "e_w", "source": "wait", "target": "done", "output_id": "wakeup"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    msgs = [it["message"] or "" for it in exc_info.value.errors]
    assert any("wakeup" in m and "not valid" in m for m in msgs)


def test_wait_duration_mode_with_event_edge_fails():
    wait_node = {
        "id": "wait",
        "type": "logic.wait",
        "position": {"x": 0, "y": 100},
        "data": {},
        "config": {"mode": "duration", "duration_hours": 4},
    }
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, wait_node, _VALID_SINK_NODE],
        [
            {"id": "e_in", "source": "src", "target": "wait", "output_id": "default"},
            {"id": "e_e", "source": "wait", "target": "done", "output_id": "event"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("event" in e for e in (it["message"] for it in exc_info.value.errors))


def test_cycle_detected():
    a = {"id": "a", "type": "logic.merge", "position": {"x": 0, "y": 0}, "data": {}, "config": {"merge_policy": "dedupe"}}
    b = {"id": "b", "type": "logic.merge", "position": {"x": 0, "y": 0}, "data": {}, "config": {"merge_policy": "dedupe"}}
    defn = _wf(
        [_VALID_COHORT_QUERY_NODE, a, b, _VALID_SINK_NODE],
        [
            {"id": "e_in",   "source": "src", "target": "a",    "output_id": "default"},
            {"id": "e_ab",   "source": "a",   "target": "b",    "output_id": "default"},
            {"id": "e_ba",   "source": "b",   "target": "a",    "output_id": "default"},
            {"id": "e_done", "source": "b",   "target": "done", "output_id": "default"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("cycle" in e for e in (it["message"] for it in exc_info.value.errors))


def test_scenario_a_passes_after_normalization_of_legacy_input():
    """Phase 11 §9 Scenario A skeleton — cohort -> split -> wait -> conditional -> sinks.

    Built using the legacy edge ``label`` shape, legacy split-by-label
    branches, legacy source ``next_node_id``, and a legacy wait config
    (``duration_hours`` only). Asserts the normalizer fixes all of the
    above and the validator accepts the canonical form.

    The dispatch step from Scenario A (WATI) is omitted here because its
    contract finalization (``connection_id`` requirement) lands in a
    later commit; validating the contract foundation does not need it.
    """
    nodes = [
        {
            "id": "src",
            "type": "source.cohort_query",
            "position": {"x": 0, "y": 0},
            "data": {},
            "config": {
                "source_table": "analytics.crm_lead_record",
                "id_column": "lead_id",
                "payload_columns": ["mql_score", "wa_replied"],
                "next_node_id": "split",
            },
        },
        {
            "id": "split",
            "type": "logic.split",
            "position": {"x": 0, "y": 0},
            "data": {},
            "config": {
                "mode": "by_field",
                "field": "mql_score",
                "branches": [
                    {"label": "high", "match": "5"},
                    {"label": "low", "match": "1"},
                ],
                "default_branch": "low",
            },
        },
        {"id": "wait", "type": "logic.wait", "position": {"x": 0, "y": 0}, "data": {},
         "config": {"duration_hours": 4}},
        {"id": "cond", "type": "logic.conditional", "position": {"x": 0, "y": 0}, "data": {},
         "config": {"predicate": {"field": "wa_replied", "op": "eq", "value": True}}},
        {**_VALID_SINK_NODE, "id": "done_yes"},
        {**_VALID_SINK_NODE, "id": "done_no"},
        {**_VALID_SINK_NODE, "id": "done_low"},
    ]
    edges = [
        {"id": "e1", "source": "src",   "target": "split",   "label": "default"},
        {"id": "e2", "source": "split", "target": "wait",    "label": "high"},
        {"id": "e3", "source": "split", "target": "done_low","label": "low"},
        {"id": "e6", "source": "wait",  "target": "cond",    "label": "wakeup"},
        {"id": "e7", "source": "cond",  "target": "done_yes","label": "true"},
        {"id": "e8", "source": "cond",  "target": "done_no", "label": "false"},
    ]
    defn = {"nodes": nodes, "edges": edges, "canvas": {}}
    canonical = normalize_definition(defn)
    # Validate the normalized form — no legacy-only constructs should remain.
    validate_definition(canonical, workflow_type="crm")
    # Sanity: every edge now carries an output_id.
    assert all(e.get("output_id") for e in canonical["edges"])
    # Source no longer carries next_node_id and source_table was promoted to source_ref.
    src = next(n for n in canonical["nodes"] if n["id"] == "src")
    src_cfg = src.get("config") or {}
    assert "next_node_id" not in src_cfg
    assert src_cfg.get("source_ref") == "crm.lead_record"
    # Split branches have ids; default_branch_id is set.
    split = next(n for n in canonical["nodes"] if n["id"] == "split")
    assert all("id" in b for b in split["config"]["branches"])
    assert split["config"].get("default_branch_id") in {b["id"] for b in split["config"]["branches"]}
    # Wait promoted to mode='duration'.
    wait = next(n for n in canonical["nodes"] if n["id"] == "wait")
    assert wait["config"].get("mode") == "duration"
