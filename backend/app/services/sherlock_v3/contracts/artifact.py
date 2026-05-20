"""Artifact — UI-bound chart payload, typed by the shared chart contract."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.services.report_builder.chart_contract import ChartPayload


ArtifactKind = Literal['chart', 'kpi', 'summary', 'table', 'empty']


class Artifact(BaseModel):
    model_config = ConfigDict(extra='forbid')

    kind: ArtifactKind
    payload: ChartPayload
