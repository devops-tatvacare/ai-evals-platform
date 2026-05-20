"""SpecialistResult — specialist→supervisor envelope carrying full attempt history + artifacts."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.sherlock_v3.contracts.artifact import Artifact
from app.services.sherlock_v3.contracts.brief import Attempt
from app.services.sherlock_v3.contracts.evidence import EvidenceRef


ResultKind = Literal['data', 'retrieval', 'kg', 'action', 'error']
ResultStatus = Literal['ok', 'partial', 'empty', 'needs_clarification', 'error']


class StateDelta(BaseModel):
    """DORMANT — patch shape for cross-turn state; no producer wires writes today."""

    model_config = ConfigDict(extra='forbid', frozen=True)

    resolved_entities: dict[str, Any] | None = None
    active_filters: dict[str, Any] | None = None


class SpecialistMeta(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)

    confidence: float = 0.0
    latency_ms: int = 0
    source_pack_id: str = ''


class SpecialistResult(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)

    kind: ResultKind
    status: ResultStatus
    summary: str
    attempts: list[Attempt] = Field(default_factory=list)
    evidence: list[EvidenceRef] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)
    state_delta: StateDelta = Field(default_factory=StateDelta)
    meta: SpecialistMeta = Field(default_factory=SpecialistMeta)
