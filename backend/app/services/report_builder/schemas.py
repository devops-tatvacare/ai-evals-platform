"""Request/response schemas for the report builder API."""
from __future__ import annotations

from app.schemas.base import CamelModel


class BuilderChatRequest(CamelModel):
    app_id: str
    session_id: str | None = None
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
    name: str
    summary: str
    detail: ToolCallDetailOut | None = None


class ChartSpecOut(CamelModel):
    type: str
    title: str
    x_key: str
    y_key: str | None = None
    series_keys: list[str] = []
    x_label: str = ""
    y_label: str = ""


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
    tool_calls: list[ToolCallOut] = []
    composed_report: ComposedReportOut | None = None
    chart: ChartOut | None = None


class BuilderSessionResponse(CamelModel):
    session_id: str
    provider: str
    model: str
