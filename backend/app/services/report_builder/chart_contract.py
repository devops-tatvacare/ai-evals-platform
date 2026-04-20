from __future__ import annotations

from typing import Any, Literal, TypeAlias, TypedDict


ChartReasonCode = Literal[
    'CG_EMPTY',
    'CG_SINGLE_VALUE',
    'CG_FIELD_CARD',
    'CG_NO_MEASURE',
    'CG_ALL_IDS',
    'CG_DEGENERATE_MEASURE',
    'CG_HIGH_CARD',
    'CG_EMIT_FAILED',
]


class ChartPayloadBase(TypedDict, total=False):
    title: str
    source_question: str
    sql_query: str
    reason_code: ChartReasonCode | None
    warning: str | None


class ChartPayloadChart(ChartPayloadBase):
    kind: Literal['chart']
    spec: dict[str, Any]
    data: list[dict[str, Any]]


class ChartPayloadKpiValue(TypedDict, total=False):
    value: int | float | str | None
    label: str
    format: str
    semantic_type: str | None


class ChartPayloadKpi(ChartPayloadBase):
    kind: Literal['kpi']
    kpi: ChartPayloadKpiValue


class ChartSummaryField(TypedDict, total=False):
    name: str
    label: str
    value: Any
    role: str
    semantic_type: str | None


class ChartPayloadSummaryValue(TypedDict):
    fields: list[ChartSummaryField]


class ChartPayloadSummary(ChartPayloadBase):
    kind: Literal['summary']
    summary: ChartPayloadSummaryValue


class ChartTableColumn(TypedDict, total=False):
    name: str
    label: str
    role: str
    semantic_type: str | None
    data_type: str | None


class ChartPayloadTable(ChartPayloadBase):
    kind: Literal['table']
    columns: list[ChartTableColumn]
    data: list[dict[str, Any]]


class ChartPayloadEmpty(ChartPayloadBase):
    kind: Literal['empty']


ChartPayload: TypeAlias = (
    ChartPayloadChart
    | ChartPayloadKpi
    | ChartPayloadSummary
    | ChartPayloadTable
    | ChartPayloadEmpty
)
