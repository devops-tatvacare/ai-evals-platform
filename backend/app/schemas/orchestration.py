"""Pydantic request/response schemas for orchestration routes.

CamelModel/CamelORMModel base aliases snake_case ↔ camelCase per backend rules.
Validation enforces the same constraints as the DB CHECK constraints —
fail-fast at the route boundary instead of raising IntegrityError mid-handler.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import Field, field_validator, model_validator

from app.models.mixins.shareable import Visibility
from app.schemas.base import CamelModel, CamelORMModel


WorkflowType = Literal["crm", "clinical"]
TriggerKind = Literal["cron", "event", "manual"]
WorkflowVersionStatus = Literal["draft", "published", "archived"]
RunStatus = Literal["pending", "running", "waiting", "completed", "failed", "cancelled"]
OverrideAction = Literal["pause", "resume", "jump_to_node", "remove", "complete"]
ConsentChannel = Literal["wa", "voice", "sms", "email"]
ConsentStatus = Literal["opted_in", "opted_out", "unknown"]


class WorkflowDefinitionNode(CamelModel):
    """One node in a persisted workflow definition.

    ``data.label`` is purely a cached display string. Routing and execution
    must derive from ``id`` and ``type`` only — never from ``data.label``.
    """
    id: str
    type: str
    position: dict[str, float] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)


class WorkflowDefinitionEdge(CamelModel):
    """One edge in a persisted workflow definition.

    Phase 11 routing key is ``output_id`` — a stable machine string matching
    the source node's declared output edge. The legacy ``label`` field is
    accepted on input for backward compatibility and is mapped to
    ``output_id`` by the normalization layer; new persisted edges carry
    ``output_id`` only.
    """
    id: str
    source: str
    target: str
    output_id: Optional[str] = None
    label: Optional[str] = None  # legacy — superseded by output_id; preserved for migration only


class WorkflowDefinition(CamelModel):
    """The JSONB shape stored in workflow_versions.definition.

    Kept permissive at the boundary (raw ``dict`` lists) because the
    Phase 11 normalization layer is the single place that reshapes legacy
    persisted definitions. Strict validation lives in
    ``definition_validator.validate_definition`` and runs at publish time.
    """
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    canvas: dict[str, Any] = Field(default_factory=dict)


# ─── Workflow CRUD ───────────────────────────────────────────────────────────


class WorkflowCreateRequest(CamelModel):
    app_id: str
    workflow_type: WorkflowType
    slug: str
    name: str
    description: Optional[str] = None
    visibility: Visibility = Visibility.PRIVATE


class WorkflowUpdateRequest(CamelModel):
    name: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[Visibility] = None


class CloneSystemWorkflowRequest(CamelModel):
    """Body for POST /api/orchestration/workflows/clone.

    `source_workflow_id` must reference a system-owned workflow
    (`tenant_id == SYSTEM_TENANT_ID`). The clone is created in the caller's
    tenant under `target_app_id` with a fresh slug + name.
    """
    source_workflow_id: uuid.UUID
    new_slug: str
    new_name: str
    target_app_id: str


class WorkflowResponse(CamelORMModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    app_id: str
    workflow_type: str
    slug: str
    name: str
    description: Optional[str]
    current_published_version_id: Optional[uuid.UUID]
    created_by: uuid.UUID
    visibility: Visibility
    shared_by: Optional[uuid.UUID] = None
    shared_at: Optional[datetime] = None
    # Human-readable creator fields, resolved at the route layer via a
    # left join on ``platform.users``. Both are ``None`` for system
    # workflows whose creator is the system user, or when the creator
    # row was deleted. Operators see the display name in the listing
    # without a separate users-lookup endpoint.
    created_by_name: Optional[str] = None
    created_by_email: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Most-recent ``WorkflowRun`` for this workflow, projected here so the
    # campaigns list can render a "Last run" column + click-through without
    # a second round-trip per row. All three fields are NULL when the
    # workflow has never been run.
    last_run_id: Optional[uuid.UUID] = None
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None


# ─── Workflow Versions ───────────────────────────────────────────────────────


class WorkflowVersionCreateRequest(CamelModel):
    definition: WorkflowDefinition

    @field_validator("definition", mode="before")
    @classmethod
    def coerce_definition(cls, v: Any) -> Any:
        if isinstance(v, dict) and ("nodes" not in v or "edges" not in v):
            raise ValueError("definition must contain 'nodes' and 'edges' arrays")
        return v


class WorkflowVersionResponse(CamelORMModel):
    id: uuid.UUID
    workflow_id: uuid.UUID
    version: int
    definition: dict[str, Any]
    status: str
    published_by: Optional[uuid.UUID]
    published_at: Optional[datetime]
    created_at: datetime


# ─── Triggers ────────────────────────────────────────────────────────────────


class TriggerCreateRequest(CamelModel):
    kind: TriggerKind
    cron_expression: Optional[str] = None
    event_name: Optional[str] = None
    params: dict[str, Any] = Field(default_factory=dict)
    active: bool = True

    @model_validator(mode="after")
    def validate_kind_payload(self) -> "TriggerCreateRequest":
        if self.kind == "cron" and not self.cron_expression:
            raise ValueError("cron_expression required when kind='cron'")
        if self.kind == "event" and not self.event_name:
            raise ValueError("event_name required when kind='event'")
        return self


class TriggerUpdateRequest(CamelModel):
    active: Optional[bool] = None
    cron_expression: Optional[str] = None
    params: Optional[dict[str, Any]] = None

    @model_validator(mode="after")
    def validate_non_empty_patch(self) -> "TriggerUpdateRequest":
        if self.active is None and self.cron_expression is None and self.params is None:
            raise ValueError("at least one trigger field must be provided")
        return self


class TriggerResponse(CamelORMModel):
    id: uuid.UUID
    workflow_id: uuid.UUID
    kind: str
    cron_expression: Optional[str]
    event_name: Optional[str]
    scheduled_job_id: Optional[uuid.UUID]
    params: dict[str, Any]
    active: bool
    created_at: datetime
    updated_at: datetime


# ─── Action Templates ────────────────────────────────────────────────────────


class ActionTemplateUpsertRequest(CamelModel):
    channel: str
    slug: str
    name: str
    payload_schema: dict[str, Any]
    active: bool = True


class ActionTemplateResponse(CamelORMModel):
    id: uuid.UUID
    tenant_id: Optional[uuid.UUID]
    app_id: Optional[str]
    channel: str
    slug: str
    name: str
    payload_schema: dict[str, Any]
    active: bool


# ─── Consent ─────────────────────────────────────────────────────────────────


class ConsentSetRequest(CamelModel):
    recipient_id: str
    channel: ConsentChannel
    status: ConsentStatus
    source: str
    evidence: Optional[dict[str, Any]] = None


class ConsentResponse(CamelORMModel):
    recipient_id: str
    channel: str
    status: str
    source: str
    evidence: Optional[dict[str, Any]]
    created_at: datetime


# ─── Runs ────────────────────────────────────────────────────────────────────


class RunCreateRequest(CamelModel):
    workflow_id: uuid.UUID
    params: dict[str, Any] = Field(default_factory=dict)


class RunResponse(CamelORMModel):
    id: uuid.UUID
    workflow_id: uuid.UUID
    workflow_version_id: uuid.UUID
    triggered_by: str
    triggered_by_user_id: Optional[uuid.UUID]
    status: str
    cohort_size_at_entry: int
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    error: Optional[str]
    params: dict[str, Any]
    created_at: datetime


class RunNodeStepResponse(CamelORMModel):
    id: uuid.UUID
    node_id: str
    node_type: str
    status: str
    inputs_summary: dict[str, Any]
    outputs_summary: Optional[dict[str, Any]]
    error: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class RunOverlaySnapshotResponse(CamelModel):
    run: RunResponse
    node_steps: list[RunNodeStepResponse]


class RunListResponse(CamelModel):
    runs: list[RunResponse]
    total: int
    limit: int
    offset: int


# ─── Recipient state / actions ──────────────────────────────────────────────


class RecipientStateResponse(CamelORMModel):
    recipient_id: str
    current_node_id: Optional[str]
    status: str
    wakeup_at: Optional[datetime]
    payload: dict[str, Any]
    enrolled_at: datetime
    completed_at: Optional[datetime]
    error: Optional[str]


class ActionResponse(CamelORMModel):
    id: uuid.UUID
    recipient_id: str
    channel: str
    action_type: str
    status: str
    idempotency_key: str
    payload: dict[str, Any]
    response: Optional[dict[str, Any]]
    provider_correlation_id: Optional[str]
    provider_status: Optional[str]
    provider_terminal: bool
    error: Optional[str]
    parent_action_id: Optional[uuid.UUID]
    created_at: datetime
    completed_at: Optional[datetime]


class WorkflowActionGlobalRow(CamelORMModel):
    """Cross-run action row used by the tenant-wide ``/api/orchestration/actions``
    endpoint that powers the platform Logs page's "Workflow actions" tab. The
    per-run :class:`ActionResponse` is too narrow for the global list (callers
    need the workflow + run identity to drill into the right inspector
    overlay), so this is its denormalized cousin with the workflow name
    eagerly joined.
    """
    id: uuid.UUID
    workflow_id: uuid.UUID
    workflow_name: Optional[str]
    run_id: uuid.UUID
    recipient_id: str
    channel: str
    action_type: str
    status: str
    provider_correlation_id: Optional[str]
    provider_status: Optional[str]
    error: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]


class WorkflowActionListResponse(CamelModel):
    items: list[WorkflowActionGlobalRow]
    total: int
    limit: int
    offset: int


# ─── Overrides ───────────────────────────────────────────────────────────────


class OverrideRequest(CamelModel):
    action: OverrideAction
    target_node_id: Optional[str] = None
    reason: Optional[str] = None

    @model_validator(mode="after")
    def validate_jump_target(self) -> "OverrideRequest":
        if self.action == "jump_to_node" and not self.target_node_id:
            raise ValueError("target_node_id required when action='jump_to_node'")
        return self


class OverrideResponse(CamelORMModel):
    id: uuid.UUID
    recipient_id: str
    action: str
    target_node_id: Optional[str]
    reason: Optional[str]
    applied_by: uuid.UUID
    applied_at: datetime
    consumed_at: Optional[datetime]


# ─── Node type catalog (for frontend palette) ───────────────────────────────


# Legacy categories — preserved for the back-compat ``category`` field on
# ``NodeTypeDescriptor`` so older frontend code does not break before the
# builder picks up the Phase 11 ``displayCategory`` field.
LegacyNodeCategory = Literal["source", "filter", "logic", "action", "escalation", "sink"]


class NodeOutputEdge(CamelModel):
    """One outgoing edge slot — Phase 11 contract.

    ``id`` is the stable routing key (matches ``output_id`` on persisted
    edges). ``label`` is display-only.
    """
    id: str
    label: str
    cardinality: Literal["one", "many"] = "one"
    dynamic: bool = False


class NodeTypeDescriptor(CamelORMModel):
    """One entry per registered handler — fetched by frontend to render palette.

    Phase 11 surfaces the rich descriptor (display label, display category,
    authoring status, payload IO, output-edge metadata, graph rules, runtime
    contract). The legacy ``category`` and the original flat ``output_edges``
    list are preserved as back-compat fields so existing builder code keeps
    rendering until it migrates to the new fields.
    """
    node_type: str
    workflow_type: str  # '*' for shared

    # Phase 11 canonical fields
    display_label: str
    display_category: Literal[
        "ingress", "qualification", "routing", "suspension",
        "synchronization", "dispatch", "mutation", "termination",
    ]
    description: str
    authoring_status: Literal["active", "hidden", "experimental", "deprecated"] = "active"

    config_schema: dict[str, Any]
    editor_hints: dict[str, Any] = Field(default_factory=dict)

    required_payload_fields: list[str] = Field(default_factory=list)
    emitted_payload_fields: list[str] = Field(default_factory=list)

    output_edges: list[NodeOutputEdge] = Field(default_factory=list)

    graph_rules: dict[str, Any] = Field(default_factory=dict)
    runtime_contract: dict[str, Any] = Field(default_factory=dict)

    # Back-compat fields — populated alongside the canonical ones so the
    # frontend keeps working through the migration window.
    category: LegacyNodeCategory  # legacy bucket name (`source` / `logic` / ...)
    label: str  # mirrors `display_label`


class CohortSourceResponse(CamelModel):
    """One cohort source — surfaces the engineering-owned source catalog
    so the SourceSelector editor can populate dropdowns and field pickers
    without baking table names into the builder.

    ``kind`` discriminates between the static engineering-owned catalog
    (``"static"``) and tenant-owned dataset versions (``"dataset"``) added
    in Phase 12. The dataset shape reuses the same allowed-column lists,
    derived from the dataset's ``schema_descriptor``."""
    source_ref: str
    display_label: str
    description: str
    kind: Literal["static", "dataset"] = "static"
    workflow_types: list[str] = Field(default_factory=list)
    app_ids: list[str] = Field(default_factory=list)
    id_column: str
    allowed_payload_columns: list[str] = Field(default_factory=list)
    allowed_filter_columns: list[str] = Field(default_factory=list)
    allowed_lookback_columns: list[str] = Field(default_factory=list)
    schema_descriptor: Optional[dict[str, Any]] = None
    row_count: Optional[int] = None
    imported_at: Optional[datetime] = None


__all__ = [
    "WorkflowDefinition", "WorkflowDefinitionNode", "WorkflowDefinitionEdge",
    "WorkflowCreateRequest", "WorkflowUpdateRequest", "WorkflowResponse",
    "CloneSystemWorkflowRequest",
    "WorkflowVersionCreateRequest", "WorkflowVersionResponse",
    "TriggerCreateRequest", "TriggerUpdateRequest", "TriggerResponse",
    "ActionTemplateUpsertRequest", "ActionTemplateResponse",
    "ConsentSetRequest", "ConsentResponse",
    "RunCreateRequest", "RunResponse", "RunNodeStepResponse",
    "RunOverlaySnapshotResponse", "RunListResponse",
    "RecipientStateResponse", "ActionResponse",
    "OverrideRequest", "OverrideResponse",
    "NodeTypeDescriptor", "NodeOutputEdge",
    "CohortSourceResponse",
]
