"""Orchestration engine package.

See docs/plans/orchestration/design-spec.md.

Re-exports the public API so consumers can do:
    from app.services.orchestration import register_node, NodeHandler, NodeContext
"""
from app.services.orchestration.node_protocol import (
    ActionDispatch,
    ActionResult,
    NodeHandler,
    NodeResult,
    RecipientOutcome,
)
from app.services.orchestration.node_registry import (
    NODE_REGISTRY,
    NodeRegistryError,
    register_node,
    resolve_handler,
)
from app.services.orchestration.node_context import NodeContext, ServiceRegistry

__all__ = [
    "ActionDispatch",
    "ActionResult",
    "NODE_REGISTRY",
    "NodeContext",
    "NodeHandler",
    "NodeRegistryError",
    "NodeResult",
    "RecipientOutcome",
    "ServiceRegistry",
    "register_node",
    "resolve_handler",
]
