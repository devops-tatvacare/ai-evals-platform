"""Phase 11 — canonical node descriptor and contract metadata.

This module is the source of truth for:
  - the **rich** node descriptor surfaced to the builder,
  - the per-node payload IO contract (required inputs, emitted outputs),
  - the per-node output-edge metadata (id, label, cardinality, dynamic),
  - the per-node graph rules (does the node need an outgoing edge? terminal?
    can a single output_id fan out to multiple targets?),
  - and the per-node runtime contract (execution kind, attempt policy,
    suspend / resume support).

Handlers (registered in ``node_registry``) keep declaring ``output_edges`` as
a flat ``list[str]`` of stable ids for runtime dispatch — this is the routing
key the executor matches against ``WorkflowDefinitionEdge.output_id``. The
descriptor adds **labels and metadata** on top so the builder can render
edges with human text without making routing dependent on those labels.

The descriptor is consumed by:
  - ``api/node_types.py``        — palette feed for the frontend
  - ``definition_validator.py``  — publish-time graph validation
  - ``definition_normalizer.py`` — legacy → canonical migration

Adding a new active node type requires registering it here. Node types not
registered here fall back to a permissive descriptor that exposes only the
flat ``output_edges`` list — that fallback exists so dispatch / mutation
nodes (whose contract finalization lives in a later commit) keep working
during the contract-foundation rollout.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.services.orchestration.node_registry import NODE_REGISTRY


# Eight neutral, functional categories (Phase 11 §4). These are surfaced as
# palette groupings — never as routing or domain identifiers. Internal node
# type strings (e.g. ``logic.split``) remain stable and need not match the
# display category (``Routing``).
DisplayCategory = Literal[
    "ingress",
    "qualification",
    "routing",
    "suspension",
    "synchronization",
    "dispatch",
    "mutation",
    "termination",
]

AuthoringStatus = Literal["active", "hidden", "experimental", "deprecated"]

ExecutionKind = Literal[
    "entry_sql",
    "entry_event",
    "qualification",
    "routing",
    "suspension",
    "synchronization",
    "dispatch",
    "mutation",
    "termination",
]

OutputCardinality = Literal["one", "many"]


class OutputEdgeDescriptor(BaseModel):
    """One outgoing edge slot on a node.

    ``id`` is the stable routing key (matches ``WorkflowDefinitionEdge.output_id``).
    ``label`` is the human-readable display string used by the canvas — never
    used for routing. ``dynamic`` means additional output_ids may be appended
    at config time (e.g. ``logic.split`` branches). ``cardinality`` says
    whether one ``(node_id, output_id)`` pair may fan out to multiple
    outgoing edges in the persisted definition.
    """
    id: str
    label: str
    cardinality: OutputCardinality = "one"
    dynamic: bool = False


class GraphRules(BaseModel):
    """How the validator should treat a node when checking the published graph."""
    requires_incoming_edges: bool = True
    requires_outgoing_edges: bool = True
    required_output_ids: list[str] = Field(default_factory=list)
    allows_multiple_outgoing_per_output: bool = False
    terminal: bool = False


class RuntimeContract(BaseModel):
    """How the runtime sees the node — informs scheduler / resume / retry handling."""
    execution_kind: ExecutionKind
    supports_attempt_policy: bool = False
    supports_suspend_resume: bool = False


class EditorHints(BaseModel):
    """Builder hints for picking an editor and laying out the form."""
    preferred_editor: Optional[str] = None
    hidden_fields: list[str] = Field(default_factory=list)
    read_only_fields: list[str] = Field(default_factory=list)
    field_order: list[str] = Field(default_factory=list)
    empty_state_message: Optional[str] = None


class NodeDescriptor(BaseModel):
    """Phase 11 canonical descriptor — superset of the legacy ``NodeTypeDescriptor``.

    ``config_schema`` is the JSON Schema produced by the handler's Pydantic
    config model. ``output_edges`` is the rich metadata shape; the legacy
    flat ``output_edges`` list still exists on the handler for runtime
    dispatch but the descriptor surfaces the rich shape for builders and
    validators.
    """
    node_type: str
    workflow_type: str  # '*' for shared
    display_label: str
    display_category: DisplayCategory
    description: str
    authoring_status: AuthoringStatus = "active"

    config_schema: dict[str, Any]
    editor_hints: EditorHints = Field(default_factory=EditorHints)

    required_payload_fields: list[str] = Field(default_factory=list)
    emitted_payload_fields: list[str] = Field(default_factory=list)

    output_edges: list[OutputEdgeDescriptor] = Field(default_factory=list)

    graph_rules: GraphRules = Field(default_factory=GraphRules)
    runtime_contract: RuntimeContract


# ─────────────────────────────────────────────────────────────────────────────
# Per-node-type contract metadata.
# Only the eight node types finalized in Commit 1 declare a full contract.
# Other node types fall back to ``_legacy_descriptor`` until their own
# contract finalization commits land.
# ─────────────────────────────────────────────────────────────────────────────

_ContractMeta = dict[str, Any]

# Standard graph rules for retry-capable dispatch nodes:
#   - inbound and outbound edges required;
#   - workflow-visible outputs are 'success' / 'exhausted' (per-attempt retry
#     stays inside the node — see ``attempt_policy.run_with_attempt_policy``);
#   - 'exhausted' is the configured ``attempt_policy.on_exhausted_output_id``;
#     descriptors expose the contract slot named ``exhausted`` and validators
#     do not care whether a tenant later reroutes to a different id.
_DISPATCH_OUTPUT_EDGES: list[dict[str, Any]] = [
    {"id": "success", "label": "Success", "cardinality": "one", "dynamic": False},
    {"id": "exhausted", "label": "Exhausted", "cardinality": "one", "dynamic": False},
]

_DISPATCH_GRAPH_RULES: dict[str, Any] = {
    "requires_incoming_edges": True,
    "requires_outgoing_edges": True,
    "required_output_ids": [],  # at least one of success/exhausted must be wired
    "allows_multiple_outgoing_per_output": False,
    "terminal": False,
}


_CONTRACT_META: dict[str, _ContractMeta] = {
    # ─── Ingress ────────────────────────────────────────────────────────────
    "source.cohort_query": {
        "display_label": "Cohort Query",
        "display_category": "ingress",
        "description": "Load contacts from a connected data source as the workflow's entry audience.",
        "authoring_status": "active",
        "editor_hints": {"preferred_editor": "SourceSelector"},
        "required_payload_fields": [],
        "emitted_payload_fields": [],  # config-derived; surfaced via source catalog
        "output_edges": [{"id": "default", "label": "Cohort", "cardinality": "one", "dynamic": False}],
        "graph_rules": {
            "requires_incoming_edges": False,
            "requires_outgoing_edges": True,
            "required_output_ids": ["default"],
            "allows_multiple_outgoing_per_output": False,
            "terminal": False,
        },
        "runtime_contract": {"execution_kind": "entry_sql"},
    },
    "source.event_trigger": {
        "display_label": "Event Trigger",
        "display_category": "ingress",
        "description": "Trigger a workflow run when an external event fires (e.g. a new CRM lead).",
        "authoring_status": "active",
        "editor_hints": {"empty_state_message": "Event payload is supplied by the trigger / webhook."},
        "required_payload_fields": [],
        "emitted_payload_fields": [],
        "output_edges": [{"id": "default", "label": "Cohort", "cardinality": "one", "dynamic": False}],
        "graph_rules": {
            "requires_incoming_edges": False,
            "requires_outgoing_edges": True,
            "required_output_ids": ["default"],
            "allows_multiple_outgoing_per_output": False,
            "terminal": False,
        },
        "runtime_contract": {"execution_kind": "entry_event"},
    },

    # ─── Qualification ──────────────────────────────────────────────────────
    "filter.eligibility": {
        "display_label": "Eligibility Filter",
        "display_category": "qualification",
        "description": "Continue only with contacts that match your eligibility rule.",
        "authoring_status": "active",
        "editor_hints": {"preferred_editor": "PredicateBuilder"},
        "required_payload_fields": [],  # config-derived from predicate field references
        "emitted_payload_fields": [],
        "output_edges": [
            {"id": "passed", "label": "Passed", "cardinality": "one", "dynamic": False},
            {"id": "skipped", "label": "Skipped", "cardinality": "one", "dynamic": False},
        ],
        "graph_rules": {
            "requires_incoming_edges": True,
            "requires_outgoing_edges": True,
            "required_output_ids": [],  # at least one of the two must be wired
            "allows_multiple_outgoing_per_output": False,
            "terminal": False,
        },
        "runtime_contract": {"execution_kind": "qualification"},
    },
    "filter.consent_gate": {
        "display_label": "Consent Gate",
        "display_category": "qualification",
        "description": "Continue only with contacts that have valid consent on record.",
        "authoring_status": "hidden",
        "editor_hints": {
            "empty_state_message": (
                "Consent gating is hidden from the palette until consent ingestion lands. "
                "Existing definitions still execute."
            ),
        },
        "required_payload_fields": [],
        "emitted_payload_fields": [],
        "output_edges": [
            {"id": "allowed", "label": "Allowed", "cardinality": "one", "dynamic": False},
            {"id": "blocked", "label": "Blocked", "cardinality": "one", "dynamic": False},
        ],
        "graph_rules": {
            "requires_incoming_edges": True,
            "requires_outgoing_edges": True,
            "required_output_ids": [],
            "allows_multiple_outgoing_per_output": False,
            "terminal": False,
        },
        "runtime_contract": {"execution_kind": "qualification"},
    },

    # ─── Routing ────────────────────────────────────────────────────────────
    "logic.conditional": {
        "display_label": "Conditional Branch",
        "display_category": "routing",
        "description": "Route each contact to a true or false branch based on a rule.",
        "authoring_status": "active",
        "editor_hints": {"preferred_editor": "PredicateBuilder"},
        "required_payload_fields": [],
        "emitted_payload_fields": [],
        "output_edges": [
            {"id": "true", "label": "True", "cardinality": "one", "dynamic": False},
            {"id": "false", "label": "False", "cardinality": "one", "dynamic": False},
        ],
        "graph_rules": {
            "requires_incoming_edges": True,
            "requires_outgoing_edges": True,
            "required_output_ids": [],
            "allows_multiple_outgoing_per_output": False,
            "terminal": False,
        },
        "runtime_contract": {"execution_kind": "routing"},
    },
    "logic.split": {
        "display_label": "Segment Split",
        "display_category": "routing",
        "description": "Route contacts into multiple branches by rule or weighted percentage.",
        "authoring_status": "active",
        "editor_hints": {"preferred_editor": "SplitBranchEditor"},
        "required_payload_fields": [],
        "emitted_payload_fields": [],
        # Branches are dynamic — additional output_ids derived per-config.
        "output_edges": [],
        "graph_rules": {
            "requires_incoming_edges": True,
            "requires_outgoing_edges": True,
            "required_output_ids": [],
            "allows_multiple_outgoing_per_output": False,
            "terminal": False,
        },
        "runtime_contract": {"execution_kind": "routing"},
    },

    # ─── Suspension ─────────────────────────────────────────────────────────
    "logic.wait": {
        "display_label": "Wait Condition",
        "display_category": "suspension",
        "description": "Pause execution until a delay elapses or an awaited event arrives.",
        "authoring_status": "active",
        "editor_hints": {"preferred_editor": "WaitConditionEditor"},
        "required_payload_fields": [],
        "emitted_payload_fields": [],
        # Output set depends on mode; validator reads config to pick which
        # subset of these is required.
        "output_edges": [
            {"id": "wakeup", "label": "Wake-up", "cardinality": "one", "dynamic": False},
            {"id": "event", "label": "Event", "cardinality": "one", "dynamic": False},
            {"id": "timeout", "label": "Timeout", "cardinality": "one", "dynamic": False},
        ],
        "graph_rules": {
            "requires_incoming_edges": True,
            "requires_outgoing_edges": True,
            "required_output_ids": [],
            "allows_multiple_outgoing_per_output": False,
            "terminal": False,
        },
        "runtime_contract": {"execution_kind": "suspension", "supports_suspend_resume": True},
    },

    # ─── Synchronization ────────────────────────────────────────────────────
    "logic.merge": {
        "display_label": "Path Merge",
        "display_category": "synchronization",
        "description": "Reconverge multiple inbound branches into a single downstream path.",
        "authoring_status": "active",
        "editor_hints": {"preferred_editor": "MergePolicyEditor"},
        "required_payload_fields": [],
        "emitted_payload_fields": [],
        "output_edges": [
            {"id": "default", "label": "Continue", "cardinality": "one", "dynamic": False},
        ],
        "graph_rules": {
            "requires_incoming_edges": True,
            "requires_outgoing_edges": True,
            "required_output_ids": ["default"],
            "allows_multiple_outgoing_per_output": False,
            "terminal": False,
        },
        "runtime_contract": {"execution_kind": "synchronization"},
    },

    # ─── Dispatch (retry-capable, success/exhausted) ────────────────────────
    "core.webhook_out": {
        "display_label": "Webhook Dispatch",
        "display_category": "dispatch",
        "description": "Call an external API with a JSON body assembled from contact attributes.",
        "authoring_status": "active",
        "editor_hints": {"preferred_editor": "StructuredRequestBodyEditor"},
        "required_payload_fields": [],  # derived from body field references
        "emitted_payload_fields": [],
        "output_edges": _DISPATCH_OUTPUT_EDGES,
        "graph_rules": _DISPATCH_GRAPH_RULES,
        "runtime_contract": {"execution_kind": "dispatch", "supports_attempt_policy": True},
    },
    # ─── Termination ────────────────────────────────────────────────────────
    "sink.complete": {
        "display_label": "Workflow Complete",
        "display_category": "termination",
        "description": "End the workflow run for the contact.",
        "authoring_status": "active",
        "editor_hints": {},
        "required_payload_fields": [],
        "emitted_payload_fields": [],
        "output_edges": [],
        "graph_rules": {
            "requires_incoming_edges": True,
            "requires_outgoing_edges": False,
            "required_output_ids": [],
            "allows_multiple_outgoing_per_output": False,
            "terminal": True,
        },
        "runtime_contract": {"execution_kind": "termination"},
    },
}


def _legacy_descriptor(*, node_type: str, workflow_type: str, handler: Any) -> NodeDescriptor:
    """Permissive descriptor for node types not registered in ``_CONTRACT_META``.

    Every Phase 11 (Commit 2) shipped node now has a finalized entry above, so
    this fallback is reserved for *unknown* third-party node types loaded from
    saved definitions. It picks a sensible display category from the type
    prefix and surfaces the handler's flat ``output_edges`` list as
    descriptor edges.
    """
    category = _category_from_prefix(node_type)
    edges = [
        OutputEdgeDescriptor(id=eid, label=eid.replace("_", " ").title(), cardinality="one", dynamic=False)
        for eid in (handler.output_edges or [])
    ]
    is_terminal = not edges
    return NodeDescriptor(
        node_type=node_type,
        workflow_type=workflow_type,
        display_label=node_type,
        display_category=category,
        description="",
        authoring_status="active",
        config_schema=handler.config_schema.model_json_schema(),
        editor_hints=EditorHints(),
        required_payload_fields=[],
        emitted_payload_fields=[],
        output_edges=edges,
        graph_rules=GraphRules(
            requires_incoming_edges=not node_type.startswith("source."),
            requires_outgoing_edges=not is_terminal,
            terminal=is_terminal,
        ),
        runtime_contract=RuntimeContract(execution_kind=_runtime_kind_from_category(category)),
    )


def _category_from_prefix(node_type: str) -> DisplayCategory:
    if node_type.startswith("source."):
        return "ingress"
    if node_type.startswith("filter."):
        return "qualification"
    if node_type.startswith("logic."):
        return "routing"
    if node_type.startswith("sink."):
        return "termination"
    if node_type.startswith("core."):
        return "dispatch"
    return "routing"


def _runtime_kind_from_category(category: DisplayCategory) -> ExecutionKind:
    if category == "ingress":
        return "entry_event"
    if category == "qualification":
        return "qualification"
    if category == "routing":
        return "routing"
    if category == "suspension":
        return "suspension"
    if category == "synchronization":
        return "synchronization"
    if category == "dispatch":
        return "dispatch"
    if category == "mutation":
        return "mutation"
    return "termination"


def build_descriptor(*, node_type: str, workflow_type: str) -> NodeDescriptor:
    """Resolve a handler from the registry and wrap it in a NodeDescriptor.

    Falls back to ``_legacy_descriptor`` for node types whose Phase 11
    contract has not yet been declared in ``_CONTRACT_META``.
    """
    handler = NODE_REGISTRY.get((workflow_type, node_type))
    if handler is None:
        handler = NODE_REGISTRY.get(("*", node_type))
    if handler is None:
        raise KeyError(f"no handler registered for ({workflow_type!r}, {node_type!r})")
    meta = _CONTRACT_META.get(node_type)
    if meta is None:
        return _legacy_descriptor(node_type=node_type, workflow_type=workflow_type, handler=handler)
    edges = [OutputEdgeDescriptor(**e) for e in meta["output_edges"]]
    return NodeDescriptor(
        node_type=node_type,
        workflow_type=workflow_type,
        display_label=meta["display_label"],
        display_category=meta["display_category"],
        description=meta["description"],
        authoring_status=meta.get("authoring_status", "active"),
        config_schema=handler.config_schema.model_json_schema(),
        editor_hints=EditorHints(**meta.get("editor_hints", {})),
        required_payload_fields=list(meta.get("required_payload_fields", [])),
        emitted_payload_fields=list(meta.get("emitted_payload_fields", [])),
        output_edges=edges,
        graph_rules=GraphRules(**meta.get("graph_rules", {})),
        runtime_contract=RuntimeContract(**meta["runtime_contract"]),
    )


def has_finalized_contract(node_type: str) -> bool:
    """True iff the node type has a Phase 11 contract entry (not just legacy fallback)."""
    return node_type in _CONTRACT_META


def all_finalized_node_types() -> list[str]:
    return sorted(_CONTRACT_META.keys())


__all__ = [
    "DisplayCategory",
    "AuthoringStatus",
    "ExecutionKind",
    "OutputCardinality",
    "OutputEdgeDescriptor",
    "GraphRules",
    "RuntimeContract",
    "EditorHints",
    "NodeDescriptor",
    "build_descriptor",
    "has_finalized_contract",
    "all_finalized_node_types",
]
