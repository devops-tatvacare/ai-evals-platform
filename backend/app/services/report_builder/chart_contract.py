"""Phase 6 — Pydantic-rooted discriminated union for the analytics chart
artifact payload.

Plan §735: every variant is a concrete ``BaseModel``; the union is keyed
on ``kind`` via ``Field(discriminator='kind')``. ``ChartPayload.model_validate``
runs at backend egress (``chat_handler._build_chart_payload``) and on every
persisted-artifact read path. The JSON Schema emitted by ``model_json_schema``
is the single source the frontend codegen consumes.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


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


KpiFormat = Literal['integer', 'decimal', 'percent', 'currency', 'duration_ms']


class _ChartPayloadBase(BaseModel):
    """Common optional fields shared across every ``ChartPayload`` variant."""

    model_config = ConfigDict(extra='forbid')

    title: str | None = None
    source_question: str | None = None
    sql_query: str | None = None
    reason_code: ChartReasonCode | None = None
    warning: str | None = None


class ChartPayloadChart(_ChartPayloadBase):
    kind: Literal['chart']
    spec: dict[str, Any]
    data: list[dict[str, Any]]


class ChartPayloadKpiValue(BaseModel):
    model_config = ConfigDict(extra='forbid')

    value: int | float | str | None = None
    label: str
    format: KpiFormat
    semantic_type: str | None = None


class ChartPayloadKpi(_ChartPayloadBase):
    kind: Literal['kpi']
    kpi: ChartPayloadKpiValue


class ChartSummaryField(BaseModel):
    model_config = ConfigDict(extra='forbid')

    name: str
    label: str
    value: Any = None
    role: str
    semantic_type: str | None = None


class ChartPayloadSummaryValue(BaseModel):
    model_config = ConfigDict(extra='forbid')

    fields: list[ChartSummaryField]


class ChartPayloadSummary(_ChartPayloadBase):
    kind: Literal['summary']
    summary: ChartPayloadSummaryValue


class ChartTableColumn(BaseModel):
    model_config = ConfigDict(extra='forbid')

    name: str
    label: str
    role: str
    semantic_type: str | None = None
    data_type: str | None = None


class ChartPayloadTable(_ChartPayloadBase):
    kind: Literal['table']
    columns: list[ChartTableColumn]
    data: list[dict[str, Any]]


class ChartPayloadEmpty(_ChartPayloadBase):
    kind: Literal['empty']


ChartPayload = Annotated[
    ChartPayloadChart
    | ChartPayloadKpi
    | ChartPayloadSummary
    | ChartPayloadTable
    | ChartPayloadEmpty,
    Field(discriminator='kind'),
]


# ``TypeAdapter`` lets callers validate an incoming dict against the union
# without having to branch on ``kind`` themselves. Plan §737 wires this into
# ``_build_chart_payload``.
CHART_PAYLOAD_ADAPTER: TypeAdapter[
    ChartPayloadChart
    | ChartPayloadKpi
    | ChartPayloadSummary
    | ChartPayloadTable
    | ChartPayloadEmpty
] = TypeAdapter(ChartPayload)


def chart_payload_json_schema() -> dict[str, Any]:
    """Emit the JSON Schema the frontend codegen (and ajv) consumes.

    Stable across invocations — Pydantic produces deterministic output
    for a frozen model set, which is what the byte-identical gate at
    plan §764 relies on.
    """

    return CHART_PAYLOAD_ADAPTER.json_schema()
