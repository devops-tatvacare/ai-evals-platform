"""Node descriptor contract tests — every shipped node has a finalized _CONTRACT_META entry."""
from __future__ import annotations

import pytest

import app.services.orchestration.nodes  # noqa: F401 — register handlers
from app.services.orchestration.node_descriptors import (
    all_finalized_node_types,
    build_descriptor,
    has_finalized_contract,
)


_FINALIZED_NODE_TYPES = {
    "source.saved_cohort",
    "source.dataset",
    "source.event_trigger",
    "filter.eligibility",
    "filter.consent_gate",
    "logic.conditional",
    "logic.split",
    "logic.wait",
    "logic.merge",
    "core.webhook_out",
    "sink.complete",
}

_SUPPORTED_PREFERRED_EDITORS = {
    None,
    "SavedCohortPicker",
    "DatasetPicker",
    "PredicateBuilder",
    "SplitBranchEditor",
    "WaitConditionEditor",
    "MergePolicyEditor",
    "StructuredRequestBodyEditor",
}


def test_all_finalized_node_types_listed():
    listed = set(all_finalized_node_types())
    missing = _FINALIZED_NODE_TYPES - listed
    assert not missing, f"finalized contract metadata missing for: {sorted(missing)}"


@pytest.mark.parametrize("node_type", sorted(_FINALIZED_NODE_TYPES))
def test_finalized_node_descriptor(node_type):
    assert has_finalized_contract(node_type), node_type
    d = build_descriptor(node_type=node_type, workflow_type="*")
    assert d.node_type == node_type
    assert d.display_label, f"empty display_label for {node_type}"
    assert d.display_category in {
        "ingress", "qualification", "routing", "suspension",
        "synchronization", "dispatch", "mutation", "termination",
    }, d.display_category
    assert d.runtime_contract.execution_kind, f"no execution_kind for {node_type}"
    assert isinstance(d.config_schema, dict)
    assert "properties" in d.config_schema or d.config_schema.get("type") in {"object", None}
    assert d.editor_hints.preferred_editor in _SUPPORTED_PREFERRED_EDITORS


def test_consent_gate_is_hidden():
    d = build_descriptor(node_type="filter.consent_gate", workflow_type="*")
    assert d.authoring_status == "hidden"


def test_source_nodes_have_only_default_output():
    for nt in ("source.saved_cohort", "source.dataset", "source.event_trigger"):
        d = build_descriptor(node_type=nt, workflow_type="*")
        ids = [oe.id for oe in d.output_edges]
        assert ids == ["default"], (nt, ids)
        assert d.graph_rules.required_output_ids == ["default"]
        assert d.graph_rules.requires_incoming_edges is False
        assert d.graph_rules.requires_outgoing_edges is True


def test_split_outputs_are_dynamic_per_config():
    d = build_descriptor(node_type="logic.split", workflow_type="*")
    assert d.output_edges == []


def test_wait_descriptor_lists_all_three_outputs_for_validator():
    d = build_descriptor(node_type="logic.wait", workflow_type="*")
    ids = sorted(oe.id for oe in d.output_edges)
    assert ids == ["event", "timeout", "wakeup"]


def test_core_webhook_has_attempt_policy_runtime_flag():
    d = build_descriptor(node_type="core.webhook_out", workflow_type="*")
    assert d.runtime_contract.supports_attempt_policy is True
    ids = [oe.id for oe in d.output_edges]
    assert ids == ["success", "exhausted"]


def test_webhook_descriptor_exposes_connection_picker():
    d = build_descriptor(node_type="core.webhook_out", workflow_type="*")
    connection_id = d.config_schema["properties"]["connection_id"]
    assert connection_id["x-type"] == "connection_picker"
    assert connection_id["x-provider"] == "webhook"
