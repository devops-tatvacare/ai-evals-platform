"""register_node decorator + resolve_handler dispatch."""
from __future__ import annotations

import pytest
from pydantic import BaseModel

from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import (
    NODE_REGISTRY,
    NodeRegistryError,
    register_node,
    resolve_handler,
)


class _NoopConfig(BaseModel):
    pass


@register_node(workflow_type="*", node_type="test.noop")
class _NoopHandler:
    node_type = "test.noop"
    config_schema = _NoopConfig
    output_edges = ["default"]
    category = "logic"

    async def execute(self, input_cohort, config, ctx):
        return NodeResult()


@register_node(workflow_type="crm", node_type="crm.test_only")
class _CrmOnlyHandler:
    node_type = "crm.test_only"
    config_schema = _NoopConfig
    output_edges = ["default"]
    category = "action"

    async def execute(self, input_cohort, config, ctx):
        return NodeResult()


def test_shared_handler_resolves_for_any_workflow_type():
    h = resolve_handler(workflow_type="crm", node_type="test.noop")
    assert isinstance(h, _NoopHandler)
    h2 = resolve_handler(workflow_type="clinical", node_type="test.noop")
    assert isinstance(h2, _NoopHandler)


def test_namespaced_handler_only_resolves_for_matching_workflow_type():
    h = resolve_handler(workflow_type="crm", node_type="crm.test_only")
    assert isinstance(h, _CrmOnlyHandler)
    with pytest.raises(NodeRegistryError):
        resolve_handler(workflow_type="clinical", node_type="crm.test_only")


def test_unknown_node_type_raises():
    with pytest.raises(NodeRegistryError):
        resolve_handler(workflow_type="crm", node_type="does.not.exist")


def test_double_registration_raises():
    with pytest.raises(NodeRegistryError):
        register_node(workflow_type="*", node_type="test.noop")(_NoopHandler)


def test_registry_lists_registered_types_for_palette():
    types = list(NODE_REGISTRY.keys())
    assert ("*", "test.noop") in types
    assert ("crm", "crm.test_only") in types
