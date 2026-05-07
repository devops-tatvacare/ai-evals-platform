"""Builds the palette descriptor list — fed to the frontend builder.

Phase 11: descriptor metadata (display label, display category, authoring
status, payload IO, output-edge metadata, graph rules, runtime contract)
lives in ``node_descriptors.build_descriptor``. This module is now a thin
adapter that walks the registry and projects each handler through the
canonical descriptor model.

Back-compat fields — ``category`` (legacy bucket) and ``label`` (mirrors
``display_label``) — are populated alongside the canonical fields so older
frontend code keeps rendering until it migrates to the Phase 11 fields.

Pydantic config-schema metadata keys honoured by the frontend builder:

  ``x-secret``    : bool — render as a password input; treat blanks on
                    edit as "leave the stored value alone".
  ``x-provider``  : str  — narrow the connection picker to one provider
                    (e.g. ``crm.place_bolna_call`` → ``"bolna"``).
  ``x-providers`` : list[str] — multi-provider picker.

Pydantic v2 propagates ``json_schema_extra`` through ``model_json_schema``
verbatim, so this module passes the schema through unchanged.
"""
from __future__ import annotations

from typing import Any, Optional, cast

from pydantic.alias_generators import to_camel

from app.schemas.orchestration import (
    LegacyNodeCategory,
    NodeOutputEdge,
    NodeTypeDescriptor,
)
from app.services.orchestration.node_descriptors import build_descriptor
from app.services.orchestration.node_registry import NODE_REGISTRY


def _camelize_keys(d: dict[str, Any]) -> dict[str, Any]:
    """Project snake_case keys to camelCase for a wire-format dict.

    The Phase 11 descriptor sub-models (``EditorHints``, ``GraphRules``,
    ``RuntimeContract``) are typed as raw ``dict[str, Any]`` on
    ``NodeTypeDescriptor`` so the response model's ``alias_generator``
    doesn't reach inside them. The frontend reads ``editorHints.preferredEditor``
    etc. — camelCase — so we re-key here before serialization.
    """
    return {to_camel(k): v for k, v in d.items()}


_LEGACY_CATEGORY_BY_PREFIX: dict[str, LegacyNodeCategory] = {
    "source.": "source",
    "filter.": "filter",
    "logic.":  "logic",
    "sink.":   "sink",
    "crm.":    "action",
    "core.":   "action",
    "clinical.": "action",
}


def _legacy_category_for(node_type: str, handler_category: str) -> LegacyNodeCategory:
    """Pick the legacy bucket. Falls back to the handler's ``category`` attribute
    if the prefix is unrecognized — covers test-only registrations cleanly."""
    for prefix, bucket in _LEGACY_CATEGORY_BY_PREFIX.items():
        if node_type.startswith(prefix):
            return bucket
    if handler_category in {"source", "filter", "logic", "action", "escalation", "sink"}:
        return cast(LegacyNodeCategory, handler_category)
    return "logic"


def list_node_types(workflow_type: Optional[str] = None) -> list[NodeTypeDescriptor]:
    out: list[NodeTypeDescriptor] = []
    for (wf_match, node_type), handler in NODE_REGISTRY.items():
        if node_type.startswith("test."):
            continue
        if workflow_type and wf_match not in (workflow_type, "*"):
            continue

        d = build_descriptor(node_type=node_type, workflow_type=wf_match)
        out.append(NodeTypeDescriptor(
            node_type=d.node_type,
            workflow_type=d.workflow_type,
            display_label=d.display_label,
            display_category=d.display_category,
            description=d.description,
            authoring_status=d.authoring_status,
            config_schema=d.config_schema,
            editor_hints=_camelize_keys(d.editor_hints.model_dump()),
            required_payload_fields=d.required_payload_fields,
            emitted_payload_fields=d.emitted_payload_fields,
            output_edges=[
                NodeOutputEdge(
                    id=e.id, label=e.label,
                    cardinality=e.cardinality, dynamic=e.dynamic,
                )
                for e in d.output_edges
            ],
            graph_rules=_camelize_keys(d.graph_rules.model_dump()),
            runtime_contract=_camelize_keys(d.runtime_contract.model_dump()),
            category=_legacy_category_for(node_type, handler.category),
            label=d.display_label,
        ))
    return sorted(out, key=lambda n: (n.display_category, n.node_type))
