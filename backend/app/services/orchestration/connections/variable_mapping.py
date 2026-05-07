"""Variable-mapping resolver — single shape, end-to-end.

A node carries its mappings in ``config.variable_mappings`` (Phase 10
shape). Each row binds an ``agent_variable`` to either a recipient
payload field (``source_kind='payload'``) or a static literal
(``source_kind='static'``). Templates do **not** carry any mapping
shape — they only hold static provider metadata (template name, retry
config, agent id, etc.). Nodes that need to send variables must declare
the bindings explicitly.

A missing payload field resolves to ``""``. Unknown ``source_kind``
raises ``VariableMappingConfigError`` so workflow-config drift surfaces
as a node-step failure rather than a silent empty payload.
"""
from __future__ import annotations

from typing import Any


class VariableMappingConfigError(ValueError):
    """Raised when a variable_mapping row carries an unsupported source_kind."""


def _resolve_one(
    mapping: dict[str, Any], payload: dict[str, Any],
) -> tuple[str, str]:
    name = mapping.get("agent_variable") or ""
    if not name:
        raise VariableMappingConfigError(
            "variable_mapping row missing 'agent_variable'"
        )
    kind = mapping.get("source_kind", "payload")
    if kind == "payload":
        field = mapping.get("payload_field") or ""
        raw = payload.get(field) if field else None
        return name, "" if raw is None else str(raw)
    if kind == "static":
        raw = mapping.get("static_value")
        return name, "" if raw is None else str(raw)
    raise VariableMappingConfigError(
        f"variable_mapping row {name!r} has unsupported source_kind={kind!r}"
    )


def apply_variable_mappings_dict(
    mappings: list[dict[str, Any]],
    payload: dict[str, Any],
) -> dict[str, str]:
    """Build a ``dict[name, value]`` for Bolna's ``user_data``."""
    out: dict[str, str] = {}
    for row in mappings:
        name, value = _resolve_one(row, payload)
        out[name] = value
    return out


def apply_variable_mappings_list(
    mappings: list[dict[str, Any]],
    payload: dict[str, Any],
) -> list[dict[str, str]]:
    """Build a ``[{name, value}, ...]`` list for WATI's ``parameters``.

    Order is preserved: rows keep their declared order.
    """
    out: list[dict[str, str]] = []
    for row in mappings:
        name, value = _resolve_one(row, payload)
        out.append({"name": name, "value": value})
    return out


__all__ = [
    "VariableMappingConfigError",
    "apply_variable_mappings_dict",
    "apply_variable_mappings_list",
]
