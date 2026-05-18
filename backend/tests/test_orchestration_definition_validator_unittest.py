"""Phase 11 — definition validator tests.

Each test feeds the validator a canonical (post-normalization) definition
and asserts the right rule fires (or doesn't).
"""
from __future__ import annotations

import pytest

import app.services.orchestration.nodes  # noqa: F401 — register handlers
from app.services.orchestration.definition_validator import (
    DefinitionValidationError,
    validate_definition,
)


def _wf(nodes, edges):
    return {"nodes": nodes, "edges": edges, "canvas": {}}


_VALID_SOURCE_NODE = {
    "id": "src",
    "type": "source.event_trigger",
    "position": {"x": 0, "y": 0},
    "data": {},
    "config": {},
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
        [_VALID_SOURCE_NODE, _VALID_SINK_NODE],
        [{"id": "e1", "source": "src", "target": "done", "output_id": "default"}],
    )


def test_minimal_valid_workflow_passes():
    validate_definition(_minimal_valid(), workflow_type="crm")


def test_duplicate_node_id_fails():
    nodes = [
        _VALID_SOURCE_NODE,
        {**_VALID_SOURCE_NODE, "id": "src"},  # duplicate id
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
        **_VALID_SOURCE_NODE,
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
        [_VALID_SOURCE_NODE, bad_filter, _VALID_SINK_NODE],
        [
            {"id": "e1", "source": "src", "target": "filter", "output_id": "default"},
            {"id": "e2", "source": "filter", "target": "done", "output_id": "passed"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    assert any("does not accept a value" in e for e in (it["message"] for it in exc_info.value.errors))


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
        [_VALID_SOURCE_NODE, split_node, _VALID_SINK_NODE],
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
        [_VALID_SOURCE_NODE, split_node, _VALID_SINK_NODE],
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
        [_VALID_SOURCE_NODE, wait_node, _VALID_SINK_NODE],
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
    defn = _wf([_VALID_SOURCE_NODE, _VALID_SINK_NODE], [])
    with pytest.raises(DefinitionValidationError):
        validate_definition(defn, workflow_type="crm")
    # Two default edges from source:
    defn2 = _wf(
        [_VALID_SOURCE_NODE,
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
        [_VALID_SOURCE_NODE, _VALID_SINK_NODE,
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
        [_VALID_SOURCE_NODE, split_node, _VALID_SINK_NODE, sink2],
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
        [_VALID_SOURCE_NODE, split_node, _VALID_SINK_NODE],
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
        [_VALID_SOURCE_NODE, wait_node, _VALID_SINK_NODE],
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
        [_VALID_SOURCE_NODE, wait_node, _VALID_SINK_NODE],
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
        [_VALID_SOURCE_NODE, a, b, _VALID_SINK_NODE],
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


# ─── Section 1 / 1b: draft mode validation ─────────────────────────────────


def test_draft_allows_missing_required_runtime_fields():
    """A partial source.saved_cohort (no cohort pinned yet) parses in draft."""
    nodes = [{
        "id": "src",
        "type": "source.saved_cohort",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {},  # no cohort_definition_version_id — incomplete authoring
    }]
    validate_definition(_wf(nodes, []), workflow_type="crm", mode="draft")


def test_draft_allows_single_node_canvas_without_terminal_or_ingress():
    """Ingress + terminal-path rules defer to publish in draft."""
    nodes = [{
        "id": "split",
        "type": "logic.split",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {"mode": "by_field"},  # branches not filled in yet
    }]
    validate_definition(_wf(nodes, []), workflow_type="crm", mode="draft")


def test_draft_rejects_fabricated_key():
    """extra='forbid' still fires in draft — unknown keys are hard errors."""
    nodes = [{
        "id": "src",
        "type": "source.event_trigger",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {"fabricated_key": 1},
    }]
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(_wf(nodes, []), workflow_type="crm", mode="draft")
    assert any("Extra inputs are not permitted" in e["message"]
               for e in exc_info.value.errors)


def test_draft_rejects_wrong_type_on_provided_field():
    """Wrong-typed provided fields still surface in draft."""
    nodes = [{
        "id": "wait",
        "type": "logic.wait",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {"mode": "duration", "duration_hours": "not-a-number"},
    }]
    with pytest.raises(DefinitionValidationError):
        validate_definition(_wf(nodes, []), workflow_type="crm", mode="draft")


def test_draft_rejects_malformed_predicate():
    """Predicate AST validation fires regardless of mode — structural."""
    nodes = [{
        "id": "f",
        "type": "filter.eligibility",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {"predicate": {"field": "x", "op": "in", "value": "not-a-list"}},
    }]
    with pytest.raises(DefinitionValidationError):
        validate_definition(_wf(nodes, []), workflow_type="crm", mode="draft")


def test_draft_rejects_split_with_conflicting_mode_fields():
    """Mode/field conflicts (structural) still fire in draft mode."""
    nodes = [{
        "id": "split",
        "type": "logic.split",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {
            "mode": "random",
            "field": "plan",  # not allowed when mode='random'
            "branches": [
                {"id": "a", "label": "A", "weight": 1},
                {"id": "b", "label": "B", "weight": 1},
            ],
        },
    }]
    with pytest.raises(DefinitionValidationError):
        validate_definition(_wf(nodes, []), workflow_type="crm", mode="draft")


def test_publish_still_requires_ingress_and_terminal():
    """Sanity check — section 1 didn't relax publish."""
    nodes = [{
        "id": "split",
        "type": "logic.split",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {"mode": "random", "branches": [
            {"id": "a", "label": "A", "weight": 1},
            {"id": "b", "label": "B", "weight": 1},
        ]},
    }]
    with pytest.raises(DefinitionValidationError):
        validate_definition(_wf(nodes, []), workflow_type="crm", mode="publish")


def test_publish_default_mode_is_unchanged():
    """The default (no mode arg) must still be 'publish'."""
    nodes = [{
        "id": "src",
        "type": "source.event_trigger",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {"fabricated_key": 1},
    }]
    with pytest.raises(DefinitionValidationError):
        validate_definition(_wf(nodes, []), workflow_type="crm")


def test_draft_allows_partial_core_webhook_out():
    """A dispatch node placed on canvas with no connection_id / url parses in draft
    so the operator can fill picker fields; publish still rejects via required-field check."""
    nodes = [{
        "id": "wh1",
        "type": "core.webhook_out",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {},
    }]
    validate_definition(_wf(nodes, []), workflow_type="crm", mode="draft")
    with pytest.raises(DefinitionValidationError):
        validate_definition(_wf(nodes, []), workflow_type="crm", mode="publish")


def test_draft_rejects_partial_core_webhook_out_with_fabricated_key():
    nodes = [{
        "id": "wh1",
        "type": "core.webhook_out",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {"fabricated_field": "smuggle"},
    }]
    with pytest.raises(DefinitionValidationError):
        validate_definition(_wf(nodes, []), workflow_type="crm", mode="draft")
