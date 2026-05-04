"""Phase 11 — publish-time validator for canonical workflow definitions.

The validator runs against the canonical (post-normalization) shape and
enforces the Phase 11 §7 rules:

  1.  unique node ids
  2.  unique edge ids
  3.  source/target node references exist
  4.  node type resolves for the workflow type
  5.  config validates against the handler's ``config_schema``
  6.  graph is acyclic
  7.  graph has at least one ingress node
  8.  terminal paths exist
  9.  ``source.*`` nodes have exactly one outgoing ``default`` edge
  10. ``sink.complete`` has no outgoing edges
  11. no duplicate outgoing edges for a ``(node_id, output_id)`` pair unless
      the descriptor explicitly allows fan-out
  12. split branch ids referenced by edges exist in the split's config
  13. split ``default_branch_id`` reference is valid
  14. wait node outputs used in edges match the wait mode
  15. hidden authoring nodes still validate and execute if present in saved
      definitions

Errors aggregate. The validator runs every rule it can and returns the
combined list so authors get a complete picture of what's wrong, not a
whack-a-mole sequence. ``validate_definition`` raises
``DefinitionValidationError`` only when at least one error is present.

Contract:
  - input is a **canonical** definition — call
    ``definition_normalizer.normalize_definition(...)`` first.
  - output: ``None`` on success; raises with structured ``errors`` list on failure.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Optional

from app.services.orchestration.node_descriptors import build_descriptor
from app.services.orchestration.node_registry import NodeRegistryError, resolve_handler
from app.services.orchestration.nodes.logic_wait import expected_output_ids_for_config


class DefinitionValidationError(ValueError):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("workflow definition is invalid:\n  - " + "\n  - ".join(errors))


class DispatchRequiredFieldsError(ValueError):
    """Phase 13 publish-gate: dispatch nodes are missing UI-supplied fields.

    Distinct from ``DefinitionValidationError`` so the route layer can
    return HTTP 422 with a structured error list (per the Phase 13 plan)
    instead of the legacy 400 + freeform string the regular validator
    raises. Drafts may still save with these fields blank — only publish
    is gated.
    """

    def __init__(self, errors: list[dict[str, str]]) -> None:
        self.errors = errors
        bullets = [
            f"node {e['node_id']!r}: {e['field']} — {e['message']}" for e in errors
        ]
        super().__init__(
            "workflow cannot publish — dispatch nodes need UI-supplied fields:\n  - "
            + "\n  - ".join(bullets)
        )


# Per Phase 13 keystone #1, these fields cannot be defaulted from seed data
# or template payloads. Authors fill them via the builder; publish is
# blocked until they're present. Phase B activates the bolna case; Phase
# C activates the wati case.
_DISPATCH_REQUIRED_FIELDS: dict[str, list[tuple[str, str]]] = {
    "crm.place_bolna_call": [
        ("connection_id", "Pick a Bolna provider connection."),
        ("agent_id", "Pick the live Bolna agent placed on the call."),
    ],
}


def validate_dispatch_required_fields(
    definition: dict[str, Any],
) -> list[dict[str, str]]:
    """Return the structured list of missing dispatch fields, empty when valid.

    Caller is the publish path (``api/versions.publish_version``); raise
    ``DispatchRequiredFieldsError`` from there on a non-empty result. Drafts
    stay saveable.
    """
    errors: list[dict[str, str]] = []
    for node in definition.get("nodes") or []:
        node_type = node.get("type")
        required = _DISPATCH_REQUIRED_FIELDS.get(node_type or "")
        if not required:
            continue
        node_id = str(node.get("id") or "<unknown>")
        config = node.get("config") or {}
        for field, message in required:
            value = config.get(field)
            # Treat ``None`` and empty strings the same way — both mean
            # "operator hasn't supplied this yet". The runtime contract
            # for ``connection_id`` accepts a UUID string; ``agent_id`` is
            # the Bolna UUID string.
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append({
                    "node_id": node_id,
                    "field": field,
                    "message": message,
                })
    return errors


def validate_definition(definition: dict[str, Any], *, workflow_type: str) -> None:
    """Validate a canonical (post-normalization) definition. Raises on failure."""
    errors: list[str] = []
    nodes: list[dict[str, Any]] = list(definition.get("nodes") or [])
    edges: list[dict[str, Any]] = list(definition.get("edges") or [])

    # ── 1: unique node ids ──────────────────────────────────────────────
    seen_node_ids: set[str] = set()
    nodes_by_id: dict[str, dict[str, Any]] = {}
    for n in nodes:
        nid = n.get("id")
        if not nid:
            errors.append("node is missing 'id'")
            continue
        if nid in seen_node_ids:
            errors.append(f"duplicate node id: {nid!r}")
            continue
        seen_node_ids.add(nid)
        nodes_by_id[nid] = n

    # ── 2: unique edge ids ──────────────────────────────────────────────
    seen_edge_ids: set[str] = set()
    for e in edges:
        eid = e.get("id")
        if not eid:
            errors.append("edge is missing 'id'")
            continue
        if eid in seen_edge_ids:
            errors.append(f"duplicate edge id: {eid!r}")
        seen_edge_ids.add(eid)

    # ── 3: edge endpoints reference existing nodes ──────────────────────
    for e in edges:
        if e.get("source") not in nodes_by_id:
            errors.append(f"edge {e.get('id')!r} source {e.get('source')!r} not in nodes")
        if e.get("target") not in nodes_by_id:
            errors.append(f"edge {e.get('id')!r} target {e.get('target')!r} not in nodes")

    # ── 4 + 5: node types resolve and configs validate ──────────────────
    for n in nodes:
        nid = n.get("id")
        node_type = n.get("type")
        if not node_type:
            errors.append(f"node {nid!r} missing 'type'")
            continue
        try:
            handler = resolve_handler(workflow_type=workflow_type, node_type=node_type)
        except NodeRegistryError as exc:
            errors.append(
                f"node {nid!r}: unknown node type {node_type!r} for workflow_type={workflow_type!r}: {exc}"
            )
            continue
        try:
            handler.config_schema(**(n.get("config") or {}))
        except Exception as exc:  # noqa: BLE001 — surfaces Pydantic / value errors verbatim
            errors.append(f"node {nid!r} config invalid: {exc}")

    # ── 6: graph is acyclic ─────────────────────────────────────────────
    adjacency: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        s = e.get("source")
        t = e.get("target")
        if s in nodes_by_id and t in nodes_by_id:
            adjacency[s].append(t)
    if _has_cycle(seen_node_ids, adjacency):
        errors.append("workflow graph contains a cycle")

    # Edge groupings reused by rules 8–11.
    out_edges_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
    out_edges_by_node_output: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    in_edge_count: dict[str, int] = defaultdict(int)
    for e in edges:
        s = e.get("source")
        t = e.get("target")
        oid = e.get("output_id")
        if s and t and s in nodes_by_id:
            out_edges_by_node[s].append(e)
            if oid:
                out_edges_by_node_output[(s, oid)].append(e)
            if t in nodes_by_id:
                in_edge_count[t] += 1

    # ── 7: at least one ingress (source.*) node ─────────────────────────
    if not any((n.get("type") or "").startswith("source.") for n in nodes):
        errors.append("workflow has no ingress (source.*) node")

    # ── 8: terminal paths exist ─────────────────────────────────────────
    has_terminal = any(
        (n.get("type") or "").startswith("sink.") or not out_edges_by_node[n["id"]]
        for n in nodes
    )
    if nodes and not has_terminal:
        errors.append("workflow has no terminal node (sink.* or a node with no outgoing edges)")

    # ── 9–14: per-node graph rules ──────────────────────────────────────
    for n in nodes:
        nid = n.get("id")
        node_type = n.get("type")
        if not nid or not node_type or node_type not in {h[1] for h in _registered_pairs(workflow_type)}:
            # already reported in rule 4
            continue
        try:
            descriptor = build_descriptor(node_type=node_type, workflow_type=workflow_type)
        except KeyError:
            continue

        outs = out_edges_by_node.get(nid, [])

        # Source nodes: exactly one outgoing 'default' edge.
        if node_type.startswith("source."):
            default_edges = [e for e in outs if e.get("output_id") == "default"]
            if len(default_edges) != 1:
                errors.append(
                    f"source node {nid!r} ({node_type}) must have exactly one outgoing "
                    f"'default' edge (found {len(default_edges)})"
                )
            other_outs = [e for e in outs if e.get("output_id") != "default"]
            if other_outs:
                errors.append(
                    f"source node {nid!r} ({node_type}) must not declare non-'default' outputs"
                )

        # Sink nodes: no outgoing edges.
        if node_type.startswith("sink.") and outs:
            errors.append(f"sink node {nid!r} ({node_type}) must not have outgoing edges")

        # Required output ids must each have at least one outgoing edge.
        for required in descriptor.graph_rules.required_output_ids:
            if not out_edges_by_node_output.get((nid, required)):
                errors.append(
                    f"node {nid!r} ({node_type}) missing required outgoing edge for output {required!r}"
                )

        # Generic outgoing-edges requirement.
        if descriptor.graph_rules.requires_outgoing_edges and not outs:
            errors.append(f"node {nid!r} ({node_type}) requires at least one outgoing edge")

        # No duplicate (node_id, output_id) edges unless the output declares fan-out.
        descriptor_outputs_by_id = {oe.id: oe for oe in descriptor.output_edges}
        for (sid, oid), group in out_edges_by_node_output.items():
            if sid != nid:
                continue
            if len(group) <= 1:
                continue
            slot = descriptor_outputs_by_id.get(oid)
            allows_fanout = (
                descriptor.graph_rules.allows_multiple_outgoing_per_output
                or (slot is not None and slot.cardinality == "many")
            )
            if not allows_fanout:
                errors.append(
                    f"node {nid!r} ({node_type}) has multiple outgoing edges for output {oid!r}; "
                    "descriptor does not allow fan-out for this slot"
                )

        # Validate edge outputs against the node's declared output set,
        # except for split (dynamic outputs) and wait (mode-dependent
        # outputs — handled below).
        if node_type == "logic.split":
            branch_ids: set[str] = {
                b["id"]
                for b in (n.get("config") or {}).get("branches", [])
                if isinstance(b, dict) and b.get("id")
            }
            if not branch_ids:
                errors.append(f"split node {nid!r} has no branches")
            for e in outs:
                oid = e.get("output_id")
                if oid not in branch_ids:
                    errors.append(
                        f"split node {nid!r} edge {e.get('id')!r} routes to unknown branch id {oid!r}"
                    )
            default_branch_id = (n.get("config") or {}).get("default_branch_id")
            if default_branch_id is not None and default_branch_id not in branch_ids:
                errors.append(
                    f"split node {nid!r} default_branch_id={default_branch_id!r} "
                    f"is not in branches {sorted(branch_ids)}"
                )
        elif node_type == "logic.wait":
            try:
                expected = set(expected_output_ids_for_config(n.get("config") or {}))
            except ValueError as exc:
                errors.append(f"wait node {nid!r}: {exc}")
                expected = set()
            seen_outputs: set[str] = {e["output_id"] for e in outs if e.get("output_id")}
            for o in sorted(seen_outputs - expected):
                errors.append(
                    f"wait node {nid!r} has edge with output_id={o!r} not valid for the configured mode "
                    f"(expected one of {sorted(expected)})"
                )
            # If the descriptor's graph_rules.requires_outgoing_edges is true,
            # at least one of the expected outputs must be wired.
            if descriptor.graph_rules.requires_outgoing_edges:
                if not (expected & seen_outputs):
                    errors.append(
                        f"wait node {nid!r} must have an outgoing edge for one of {sorted(expected)}"
                    )
        else:
            descriptor_ids = {oe.id for oe in descriptor.output_edges}
            if descriptor_ids:
                for e in outs:
                    oid = e.get("output_id")
                    if oid is not None and oid not in descriptor_ids:
                        errors.append(
                            f"node {nid!r} ({node_type}) edge {e.get('id')!r} routes via "
                            f"unknown output_id={oid!r} (declared: {sorted(descriptor_ids)})"
                        )

        # Hidden / experimental / deprecated authoring statuses still
        # validate and execute. We do not block them here — Phase 11 §7.15.

    if errors:
        raise DefinitionValidationError(errors)


def _registered_pairs(workflow_type: str) -> set[tuple[str, str]]:
    """Set of ``(workflow_type, node_type)`` pairs visible to the given workflow type."""
    from app.services.orchestration.node_registry import NODE_REGISTRY
    out: set[tuple[str, str]] = set()
    for (wf, nt) in NODE_REGISTRY.keys():
        if wf == workflow_type or wf == "*":
            out.add((wf, nt))
    return out


def _has_cycle(node_ids: set[str], adjacency: dict[str, list[str]]) -> bool:
    """Iterative DFS cycle check over the directed graph."""
    color: dict[str, int] = {nid: 0 for nid in node_ids}  # 0=white, 1=grey, 2=black
    for start in node_ids:
        if color[start] != 0:
            continue
        stack: list[tuple[str, Optional[int]]] = [(start, 0)]
        while stack:
            node, idx = stack[-1]
            if idx == 0:
                color[node] = 1
            neighbors = adjacency.get(node, [])
            assert idx is not None
            if idx < len(neighbors):
                stack[-1] = (node, idx + 1)
                nxt = neighbors[idx]
                c = color.get(nxt, 0)
                if c == 1:
                    return True
                if c == 0:
                    stack.append((nxt, 0))
            else:
                color[node] = 2
                stack.pop()
    return False


__all__ = ["DefinitionValidationError", "validate_definition"]
