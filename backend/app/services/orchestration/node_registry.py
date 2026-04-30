"""Node handler registry — singleton + decorator + resolver.

(workflow_type, node_type) → handler instance. workflow_type='*' means shared.
Resolver tries (workflow_type, node_type) first, then falls back to ('*', node_type).

Double-registration raises immediately so a typo in two places is loud.
"""
from __future__ import annotations

from typing import Type

from app.services.orchestration.node_protocol import NodeHandler


class NodeRegistryError(RuntimeError):
    pass


# (workflow_type, node_type) → instance
NODE_REGISTRY: dict[tuple[str, str], NodeHandler] = {}


def register_node(*, workflow_type: str, node_type: str):
    """Class decorator. Instantiates the handler and registers it.

    workflow_type:
      '*' for shared (resolves for any workflow type)
      'crm' / 'clinical' for namespace-restricted

    Handlers must be stateless — instantiated once at import time.
    """
    def decorator(handler_cls: Type) -> Type:
        key = (workflow_type, node_type)
        if key in NODE_REGISTRY:
            raise NodeRegistryError(
                f"node already registered: workflow_type={workflow_type!r} node_type={node_type!r}"
            )
        instance = handler_cls()
        for attr in ("node_type", "config_schema", "output_edges", "category"):
            if not hasattr(instance, attr):
                raise NodeRegistryError(
                    f"handler {handler_cls.__name__} missing required attribute: {attr}"
                )
        if instance.node_type != node_type:
            raise NodeRegistryError(
                f"handler {handler_cls.__name__}.node_type={instance.node_type!r} "
                f"does not match registration node_type={node_type!r}"
            )
        NODE_REGISTRY[key] = instance
        return handler_cls
    return decorator


def resolve_handler(*, workflow_type: str, node_type: str) -> NodeHandler:
    """Look up the handler for (workflow_type, node_type), with '*' fallback.

    Raises NodeRegistryError if no match.
    """
    direct = NODE_REGISTRY.get((workflow_type, node_type))
    if direct is not None:
        return direct
    shared = NODE_REGISTRY.get(("*", node_type))
    if shared is not None:
        return shared
    raise NodeRegistryError(
        f"no handler registered for workflow_type={workflow_type!r} node_type={node_type!r}"
    )
