"""Request/response schemas for the report builder API."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Union

from pydantic import Field, model_validator

from app.schemas.base import CamelModel

RuntimeOperation = Literal['send', 'resume']
CancelTurnResult = Literal['cancelled', 'forced_interrupted', 'already_terminal']

WorkflowType = Literal['crm', 'clinical']
ViewMode = Literal['view', 'edit']


class OrchestrationBuilderPageContext(CamelModel):
    """Per-turn snapshot of the orchestration builder, sent by the FE.

    Backend treats `definition` as untrusted shape-wise (re-coerced as a
    dict) but trusted content-wise because the user is editing it on the
    frontend right now. Tenant-ownership of `workflow_id` is verified at
    the route gate via `tenant_guard.assert_workflow_owned`.

    `definition` is large (entire canvas) — the route's logging
    middleware redacts it before persisting request logs.
    """
    kind: Literal['orchestration_builder']
    workflow_id: str
    version_id: str | None = None
    workflow_type: WorkflowType
    app_id: str
    selected_node_id: str | None = None
    definition: dict[str, Any] = Field(default_factory=dict)
    data_hash: str
    view_mode: ViewMode = 'edit'


class NoPageContext(CamelModel):
    kind: Literal['none']


PageContext = Annotated[
    Union[OrchestrationBuilderPageContext, NoPageContext],
    Field(discriminator='kind'),
]


class BuilderChatRequest(CamelModel):
    app_id: str
    session_id: str | None = None
    turn_id: str | None = None
    operation: RuntimeOperation = 'send'
    resume_from_seq: int | None = None
    message: str | None = None
    provider: str | None = None
    model: str
    page_context: PageContext | None = None

    @model_validator(mode='after')
    def validate_operation(self) -> 'BuilderChatRequest':
        if self.operation == 'send':
            if not self.turn_id or not self.message:
                raise ValueError('turn_id and message are required for send')
        elif self.operation == 'resume':
            if not self.turn_id:
                raise ValueError('turn_id is required for resume')
            if self.message is not None:
                raise ValueError('resume requests cannot include message')
        return self


class ToolCallDetailOut(CamelModel):
    execution_ms: float
    sql_used: str | None = None
    row_count: int | None = None
    cache_hit: bool | None = None
    error: str | None = None


class BuilderMessageOut(CamelModel):
    id: str
    role: str
    content: str
    status: str
    error_message: str | None = None
    metadata: dict | None = None
    created_at: datetime


class BuilderSessionSnapshotResponse(CamelModel):
    session_id: str
    provider: str
    model: str
    active_turn_id: str | None = None
    last_event_seq: int
    current_turn_status: str
    messages: list[BuilderMessageOut] = []


class BuilderRuntimePartOut(CamelModel):
    seq: int
    type: str
    call_id: str | None = None
    part: dict[str, Any]
    created_at: datetime


class BuilderRuntimePartsResponse(CamelModel):
    session_id: str
    last_event_seq: int
    parts: list[BuilderRuntimePartOut] = []


class BuilderTurnCancelResponse(CamelModel):
    session_id: str
    turn_id: str
    result: CancelTurnResult
    turn_status: str
    message: str
