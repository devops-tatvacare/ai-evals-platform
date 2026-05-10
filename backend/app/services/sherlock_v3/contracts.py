"""Sherlock v3 data contracts (architecture spec §5).

One shape across every specialist family — no per-pack contract layers.
``TaskBrief`` flows supervisor → specialist; ``SpecialistResult`` flows
back. ``EvidenceRef`` is the cross-specialist evidence handle (resolved
against ``platform.sherlock_evidence``). ``Artifact`` is the discriminated
UI-bound payload union — its ``payload`` field is byte-identical to what
the existing chart/table/KPI render path already consumes via the
``analytics.chart.v1`` contract (§16).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ─────────────────────────── EvidenceRef ───────────────────────────

EvidenceSource = Literal[
    'sql_row',
    'vector_chunk',
    'kg_triple',
    'action_receipt',
    'doc_excerpt',
]


class EvidenceRef(BaseModel):
    """Pointer into ``platform.sherlock_evidence``. Capability-agnostic.

    The supervisor passes ``ref_id`` lists between specialists; specialists
    fetch the body if they need it. Avoids re-shipping payloads on the wire.
    """

    model_config = ConfigDict(extra='forbid')

    ref_id: uuid.UUID
    source: EvidenceSource
    locator: dict[str, Any]
    snippet: str | None = None


# ─────────────────────────── Artifact ──────────────────────────────

ArtifactKind = Literal['chart', 'kpi', 'summary', 'table', 'citation_set', 'empty']


class Artifact(BaseModel):
    """UI-bound discriminated artifact (§5.4).

    ``kind`` is the top-level discriminator the SSE handler branches on.
    ``payload`` is the existing chart/table/KPI render contract — no schema
    change needed in the frontend translator. ``Artifact.kind ==
    Artifact.payload['kind']`` is intentional duplication so SSE handlers
    can branch without inspecting the payload.
    """

    model_config = ConfigDict(extra='forbid')

    kind: ArtifactKind
    payload: dict[str, Any]


# ─────────────────────────── TaskBrief ─────────────────────────────

IntentHint = Literal['measure', 'dimension', 'record_lookup', 'grounding', 'action', 'mixed']
ExpectedKind = Literal['data', 'retrieval', 'kg', 'action']


class TimeWindow(BaseModel):
    model_config = ConfigDict(extra='forbid')

    since: datetime
    until: datetime


class Scope(BaseModel):
    model_config = ConfigDict(extra='forbid')

    app_id: str
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    chat_session_id: uuid.UUID
    time_window: TimeWindow | None = None


class Budget(BaseModel):
    model_config = ConfigDict(extra='forbid')

    max_tool_calls: int = 6
    deadline_ms: int = 20_000


class TaskBrief(BaseModel):
    """Supervisor → specialist envelope (§5.1).

    The brief is everything a specialist needs to act *without* inheriting
    the supervisor's message history (decision D2 — context isolation).
    """

    model_config = ConfigDict(extra='forbid')

    task: str
    scope: Scope
    intent_hint: IntentHint
    evidence_refs: list[uuid.UUID] = Field(default_factory=list)
    expected_kind: ExpectedKind
    budget: Budget = Field(default_factory=Budget)


# ─────────────────────────── SpecialistResult ──────────────────────

ResultKind = Literal['data', 'retrieval', 'kg', 'action', 'error']
ResultStatus = Literal['ok', 'partial', 'empty', 'needs_clarification', 'error']


class StateDelta(BaseModel):
    """Patch the supervisor will merge into ``platform.sherlock_state`` (§5.2)."""

    model_config = ConfigDict(extra='forbid')

    resolved_entities: dict[str, Any] | None = None
    active_filters: dict[str, Any] | None = None


class SpecialistMeta(BaseModel):
    model_config = ConfigDict(extra='forbid')

    confidence: float = 0.0
    latency_ms: int = 0
    source_pack_id: str = ''


class SpecialistResult(BaseModel):
    """Specialist → supervisor envelope (§5.2).

    ``evidence`` carries refs only — the bodies live in
    ``platform.sherlock_evidence``. ``artifacts`` are UI-bound and forward
    to ``artifact_emitted`` SSE events; the supervisor synthesizes the
    final answer using ``summary`` for prose and ``evidence`` for citation.
    """

    model_config = ConfigDict(extra='forbid')

    kind: ResultKind
    status: ResultStatus
    summary: str
    evidence: list[EvidenceRef] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)
    state_delta: StateDelta = Field(default_factory=StateDelta)
    meta: SpecialistMeta = Field(default_factory=SpecialistMeta)


# Convenience: JSON Schema dict for the Agents-SDK ``parameters`` arg on
# ``Agent.as_tool``. Pre-computed so callers don't pay the Pydantic dump
# cost per turn.
TASK_BRIEF_JSON_SCHEMA: dict[str, Any] = TaskBrief.model_json_schema()
SPECIALIST_RESULT_JSON_SCHEMA: dict[str, Any] = SpecialistResult.model_json_schema()
