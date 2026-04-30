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

from app.schemas.base import CamelModel, CamelORMModel


WorkflowType = Literal["crm", "clinical"]
TriggerKind = Literal["cron", "event", "manual"]
WorkflowVersionStatus = Literal["draft", "published", "archived"]
RunStatus = Literal["pending", "running", "waiting", "completed", "failed", "cancelled"]
OverrideAction = Literal["pause", "resume", "jump_to_node", "remove", "complete"]
ConsentChannel = Literal["wa", "voice", "sms", "email"]
ConsentStatus = Literal["opted_in", "opted_out", "unknown"]


class WorkflowDefinition(CamelModel):
    """The JSONB shape stored in workflow_versions.definition."""
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


class WorkflowUpdateRequest(CamelModel):
    name: Optional[str] = None
    description: Optional[str] = None


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
    created_at: datetime
    updated_at: datetime


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
    error: Optional[str]
    parent_action_id: Optional[uuid.UUID]
    created_at: datetime
    completed_at: Optional[datetime]


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


class NodeTypeDescriptor(CamelORMModel):
    """One entry per registered handler — fetched by frontend to render palette."""
    node_type: str
    workflow_type: str  # '*' for shared
    category: Literal["source", "filter", "logic", "action", "escalation", "sink"]
    label: str
    description: str
    output_edges: list[str]
    config_schema: dict[str, Any]


__all__ = [
    "WorkflowDefinition",
    "WorkflowCreateRequest", "WorkflowUpdateRequest", "WorkflowResponse",
    "WorkflowVersionCreateRequest", "WorkflowVersionResponse",
    "TriggerCreateRequest", "TriggerResponse",
    "ActionTemplateUpsertRequest", "ActionTemplateResponse",
    "ConsentSetRequest", "ConsentResponse",
    "RunCreateRequest", "RunResponse",
    "RecipientStateResponse", "ActionResponse",
    "OverrideRequest", "OverrideResponse",
    "NodeTypeDescriptor",
]
