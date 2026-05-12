"""Sherlock v3 data contracts.

Supervisor → specialist dispatch ships raw ``sub_question`` strings from
a ``SynthesisBrief`` (workbench-era flow), so no envelope type is needed
on that side. ``SpecialistResult`` describes what specialists return.
``EvidenceRef`` is the cross-specialist evidence handle resolved against
``platform.sherlock_evidence``. ``Artifact`` is the discriminated
UI-bound payload union — its ``payload`` field is byte-identical to what
the existing chart/table/KPI render path already consumes via the
``analytics.chart.v1`` contract.
"""
from __future__ import annotations

import uuid
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


# ─────────────────────────── SynthesisBrief (Phase 3) ──────────────
#
# The query_synthesis_specialist returns this strict shape. The supervisor
# always calls synthesis first, then dispatches each sub-question to the
# named target specialist. ``available_targets`` is computed from the
# supervisor's actual toolbelt for the turn so synthesis can never name a
# specialist that isn't wired in (e.g., authoring without builder context
# or permission). See design spec §3 / §9 Decision 14.

SynthesisTarget = Literal['data_specialist', 'authoring_specialist']
SynthesisClassification = Literal[
    'answerable',       # decomposition is valid; dispatch
    'ambiguous',        # ask the user one clarifying question
    'non_data',         # out-of-scope chitchat / refuse politely
    'non_sql_data',     # data question that the current pipeline can't serve
]


class SubQuestion(BaseModel):
    """One self-contained sub-question routed to a single specialist.

    ``sub_question`` must be self-contained — no pronouns, no implicit
    "the same as above". The target specialist receives this string in
    isolation, so resolution against the conversation has to happen
    upstream in synthesis.

    ``depends_on_sub_question`` is the index (0-based) of an earlier
    sub-question whose result the supervisor should fold into context
    before dispatching this one. The supervisor honors the order but
    does not deep-merge result payloads; it summarizes the prior
    result into the next sub_question's brief when needed.
    """

    model_config = ConfigDict(extra='forbid')

    sub_question: str
    target: SynthesisTarget
    depends_on_sub_question: int | None = None


class SynthesisBrief(BaseModel):
    """query_synthesis_specialist's strict structured output.

    Field invariants enforced by validators below:
      * ``rewritten_question`` is non-empty;
      * when ``classification == 'answerable'``, ``decomposition`` is non-empty
        and every sub-question's ``target`` lives in ``available_targets``;
      * when ``classification == 'ambiguous'``, ``decomposition`` MUST be empty
        and ``suggested_followups`` MUST be non-empty;
      * ``available_targets`` is the toolbelt the supervisor exposed for this
        turn — synthesis must respect it.
    """

    model_config = ConfigDict(extra='forbid')

    rewritten_question: str
    classification: SynthesisClassification
    reason: str = ''
    suggested_followups: list[str] = Field(default_factory=list)
    available_targets: list[SynthesisTarget] = Field(default_factory=list)
    decomposition: list[SubQuestion] = Field(default_factory=list)

    @classmethod
    def model_validate_with_targets(
        cls,
        raw: Any,
        *,
        available_targets: list[SynthesisTarget],
    ) -> 'SynthesisBrief':
        """Validate then enforce target-availability + classification invariants.

        Pydantic's plain validation can't reason about "synthesis emitted a
        target the supervisor didn't expose this turn" because the truth
        lives outside the payload. This helper takes the runtime
        ``available_targets`` and refuses any brief that targets something
        unavailable or violates the classification shape rules.
        """
        brief = cls.model_validate(raw)
        # Re-pin available_targets to the runtime truth — the model may
        # have made it up; we ignore whatever it returned and use the
        # supervisor's actual toolbelt.
        brief = brief.model_copy(update={'available_targets': list(available_targets)})

        if not brief.rewritten_question.strip():
            raise ValueError('SynthesisBrief.rewritten_question must be non-empty')

        targets_allowed = set(available_targets)
        if brief.classification == 'answerable':
            if not brief.decomposition:
                raise ValueError(
                    "SynthesisBrief.classification='answerable' requires "
                    'a non-empty decomposition'
                )
            for idx, sq in enumerate(brief.decomposition):
                if sq.target not in targets_allowed:
                    raise ValueError(
                        f'SynthesisBrief.decomposition[{idx}].target='
                        f'{sq.target!r} is not in available_targets='
                        f'{sorted(targets_allowed)}'
                    )
                if sq.depends_on_sub_question is not None and (
                    sq.depends_on_sub_question < 0
                    or sq.depends_on_sub_question >= idx
                ):
                    raise ValueError(
                        f'SynthesisBrief.decomposition[{idx}].depends_on_sub_question'
                        f'={sq.depends_on_sub_question} must reference an earlier index'
                    )
        elif brief.classification == 'ambiguous':
            if brief.decomposition:
                raise ValueError(
                    "SynthesisBrief.classification='ambiguous' must have an empty decomposition"
                )
            if not brief.suggested_followups:
                raise ValueError(
                    "SynthesisBrief.classification='ambiguous' requires "
                    'non-empty suggested_followups'
                )
        else:  # non_data / non_sql_data
            if brief.decomposition:
                raise ValueError(
                    f"SynthesisBrief.classification={brief.classification!r} "
                    'must have an empty decomposition'
                )
        return brief


# Convenience: JSON Schema dicts for the Agents-SDK ``parameters`` arg on
# ``Agent.as_tool``. Pre-computed so callers don't pay the Pydantic dump
# cost per turn.
SYNTHESIS_BRIEF_JSON_SCHEMA: dict[str, Any] = SynthesisBrief.model_json_schema()
