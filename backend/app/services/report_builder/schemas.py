"""Request/response schemas for the report builder API."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import model_validator

from app.schemas.base import CamelModel

RuntimeOperation = Literal['send', 'resume']


class BuilderChatRequest(CamelModel):
    app_id: str
    session_id: str | None = None
    turn_id: str | None = None
    operation: RuntimeOperation = 'send'
    resume_from_seq: int | None = None
    message: str | None = None
    provider: str | None = None
    model: str

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


class LegacyBuilderChatRequest(CamelModel):
    app_id: str
    session_id: str | None = None
    resume_from_seq: int | None = None
    message: str
    provider: str
    model: str


class BuilderSectionOut(CamelModel):
    id: str
    type: str
    title: str
    variant: str = ""


class ComposedReportOut(CamelModel):
    report_name: str
    sections: list[BuilderSectionOut]


class ToolCallDetailOut(CamelModel):
    execution_ms: float
    sql_used: str | None = None
    row_count: int | None = None
    cache_hit: bool | None = None
    error: str | None = None


class ToolCallOut(CamelModel):
    tool_call_id: str | None = None
    name: str
    summary: str
    detail: ToolCallDetailOut | None = None


class ChartSeriesItemOut(CamelModel):
    data_key: str
    type: str
    stack_id: str | None = None


class ChartSpecOut(CamelModel):
    type: str
    title: str
    x_key: str
    y_key: str | None = None
    series_keys: list[str] = []
    x_label: str = ""
    y_label: str = ""
    legend_position: str = "bottom"
    alternatives: list[str] = []
    series: list[ChartSeriesItemOut] = []


class ChartOut(CamelModel):
    spec: ChartSpecOut
    data: list[dict] = []
    sql_query: str = ""
    source_question: str = ""


class BuilderChatResponse(CamelModel):
    session_id: str
    provider: str | None = None
    model: str | None = None
    role: str = "assistant"
    content: str
    terminal_status: str | None = None
    tool_calls: list[ToolCallOut] = []
    composed_report: ComposedReportOut | None = None
    chart: ChartOut | None = None
    warnings: list[str] = []


class BuilderSessionResponse(CamelModel):
    session_id: str
    provider: str
    model: str


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


class BuilderRuntimeEventOut(CamelModel):
    seq: int
    event_type: str
    payload: dict[str, Any]
    created_at: datetime


class BuilderRuntimeEventsResponse(CamelModel):
    session_id: str
    last_event_seq: int
    events: list[BuilderRuntimeEventOut] = []
