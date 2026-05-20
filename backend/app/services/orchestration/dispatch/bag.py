"""Step-namespaced payload bag helpers — fields land as flat ``steps.<node_id>.<key>`` keys.

The JSONB ``||`` merge in ``_reconciler.apply_terminal_event`` is shallow, so flat
dotted-name keys never collide across distinct node-steps. Predicate evaluation
reads via ``payload.get('steps.<node>.<key>')`` (see ``predicate_contract``).
"""
from __future__ import annotations

from typing import Any


def bag_path(node_id: str, key: str) -> str:
    return f"steps.{node_id}.{key}"


def bag_write(*, node_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Return a flat patch under the ``steps.<node_id>.`` namespace."""
    return {bag_path(node_id, k): v for k, v in fields.items()}


def bag_read(payload: dict[str, Any], *, node_id: str, key: str) -> Any:
    return payload.get(bag_path(node_id, key))
