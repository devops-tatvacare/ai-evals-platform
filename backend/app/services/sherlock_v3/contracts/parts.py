"""SherlockPart discriminated union — used VERBATIM in DB payload, SSE wire, and React props."""
from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.services.sherlock_v3.contracts.artifact import Artifact
from app.services.sherlock_v3.contracts.brief import Attempt, SpecialistBrief
from app.services.sherlock_v3.contracts.evidence import EvidenceRef
from app.services.sherlock_v3.contracts.result import ResultStatus


PartID = str
CallID = str


class _PartBase(BaseModel):
    """Shared identifier shape — Parts are mutable; ToolPart transitions state across part_updated."""

    model_config = ConfigDict(extra='forbid')

    id: PartID
    chat_session_id: str
    seq: int
    created_at: int


class UserMessagePart(_PartBase):
    type: Literal['user_message'] = 'user_message'
    text: str


class AssistantTextPart(_PartBase):
    type: Literal['assistant_text'] = 'assistant_text'
    text: str = ''
    final: bool = False


class ReasoningPart(_PartBase):
    type: Literal['reasoning'] = 'reasoning'
    text: str = ''
    final: bool = False


class SubtaskResult(BaseModel):
    """Lean projection of a specialist's return — uniform across specialists; sql/row_count populated for data."""

    model_config = ConfigDict(extra='forbid')

    status: ResultStatus
    summary: str = ''
    sql: str | None = None
    row_count: int | None = None


class SubtaskStateRunning(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: Literal['running'] = 'running'
    started_at: int = 0


class SubtaskStateCompleted(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: Literal['completed'] = 'completed'
    started_at: int = 0
    ended_at: int = 0
    result: SubtaskResult


class SubtaskStateError(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: Literal['error'] = 'error'
    started_at: int = 0
    ended_at: int = 0
    error: str = ''


SubtaskState = Annotated[
    Union[SubtaskStateRunning, SubtaskStateCompleted, SubtaskStateError],
    Field(discriminator='status'),
]


class SubtaskPart(_PartBase):
    """Supervisor → specialist dispatch carrying the typed brief and a lifecycle state.

    state transitions running→completed|error in place (mirrors ToolPart). Optional
    so subtask rows persisted before the lifecycle existed still hydrate.
    """

    type: Literal['subtask'] = 'subtask'
    specialist: str
    call_id: CallID
    brief: SpecialistBrief
    state: SubtaskState | None = None


class RetryPart(_PartBase):
    """In-stream retry marker — supervisor emits before re-dispatching with prior_attempts populated."""

    type: Literal['retry'] = 'retry'
    specialist: str
    attempt_number: int
    failed_attempt: Attempt


class ToolStatePending(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: Literal['pending'] = 'pending'
    input: dict[str, Any] = Field(default_factory=dict)
    raw: str = ''


class ToolStateRunning(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: Literal['running'] = 'running'
    input: dict[str, Any] = Field(default_factory=dict)
    title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    started_at: int


class ToolStateCompleted(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: Literal['completed'] = 'completed'
    input: dict[str, Any] = Field(default_factory=dict)
    output: str = ''
    title: str = ''
    metadata: dict[str, Any] = Field(default_factory=dict)
    started_at: int
    ended_at: int


class ToolStateError(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: Literal['error'] = 'error'
    input: dict[str, Any] = Field(default_factory=dict)
    error: str = ''
    metadata: dict[str, Any] = Field(default_factory=dict)
    started_at: int
    ended_at: int


ToolState = Annotated[
    Union[ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError],
    Field(discriminator='status'),
]


class ToolPart(_PartBase):
    """One tool invocation — call_id is the Agents SDK tool_call_id; state transitions pending→completed|error."""

    type: Literal['tool'] = 'tool'
    call_id: CallID
    tool: str
    state: ToolState


class ChartPart(_PartBase):
    """Typed chart payload artifact."""

    type: Literal['chart'] = 'chart'
    artifact: Artifact


class EvidencePart(_PartBase):
    type: Literal['evidence'] = 'evidence'
    refs: list[EvidenceRef] = Field(default_factory=list)


class ErrorPart(_PartBase):
    type: Literal['error'] = 'error'
    source: str
    message: str
    recoverable: bool = False


class CompactionPart(_PartBase):
    """Responses-API server-side compaction marker."""

    type: Literal['compaction'] = 'compaction'
    summary: str = ''
    tokens_before: int | None = None


class StepStartPart(_PartBase):
    type: Literal['step_start'] = 'step_start'
    turn_id: str


class StepFinishPart(_PartBase):
    type: Literal['step_finish'] = 'step_finish'
    turn_id: str
    status: str
    last_response_id: str | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None


SherlockPart = Annotated[
    Union[
        UserMessagePart,
        AssistantTextPart,
        ReasoningPart,
        SubtaskPart,
        RetryPart,
        ToolPart,
        ChartPart,
        EvidencePart,
        ErrorPart,
        CompactionPart,
        StepStartPart,
        StepFinishPart,
    ],
    Field(discriminator='type'),
]


def new_part_id() -> PartID:
    """Generate a fresh Part identifier with a typed prefix."""
    return f'prt_{uuid.uuid4().hex}'


SHERLOCK_PART_ADAPTER: TypeAdapter[Any] = TypeAdapter(SherlockPart)


def sherlock_part_json_schema() -> dict[str, Any]:
    """Emit the JSON Schema the frontend codegen + ajv validator consume.

    Stable across invocations — Pydantic produces deterministic output for
    a frozen model set, which is what the byte-identical drift gate relies
    on (mirrors ``chart_payload_json_schema`` in chart_contract.py).
    """
    return SHERLOCK_PART_ADAPTER.json_schema()
