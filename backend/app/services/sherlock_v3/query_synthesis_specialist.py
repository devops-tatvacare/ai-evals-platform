"""Sherlock v3 query_synthesis_specialist — rewrite + classify + decompose.

The supervisor calls this specialist first on every turn (see design spec
§3). It owns three jobs:

  1. **Rewrite** the user message into a self-contained question — no
     pronouns, no implicit conversational deixis. Future specialists see
     the rewrite in isolation, so resolution has to land here.
  2. **Classify** the question as one of ``answerable``, ``ambiguous``,
     ``non_data``, ``non_sql_data`` (see ``contracts.SynthesisClassification``).
  3. **Decompose** answerable questions into one or more ``SubQuestion``
     entries, each tagged with the target specialist
     (``data_specialist`` / ``authoring_specialist``).

The toolbelt available to the supervisor changes per turn — authoring
is only wired in when a builder snapshot is open AND the caller has the
right permission. Synthesis only emits targets from
``available_targets``; the extractor re-validates this constraint and
substitutes a refusal brief if the LLM cheated.

This module ships **no Python orchestration outside the SDK**: the
supervisor invokes synthesis via ``Agent.as_tool``; one
``Runner.run_streamed`` call on the supervisor drives the whole turn.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

import openai
from agents import Agent
from agents.model_settings import ModelSettings
from agents.models.openai_responses import OpenAIResponsesModel
from openai.types.shared import Reasoning

from app.services.sherlock_v3.contracts import (
    SubQuestion,
    SynthesisBrief,
    SynthesisTarget,
)

logger = logging.getLogger(__name__)


_PERSONALITY = """\
You are Sherlock's query_synthesis_specialist.

Your job — and the only job — is to receive the user's message plus
conversation history and emit ONE SynthesisBrief JSON object. You do
not answer questions. You do not write SQL. You do not draft content.
You rewrite, classify, and decompose.

Return a single SynthesisBrief with these fields:

  - rewritten_question: a fully self-contained restatement of the
     user's request. Resolve pronouns ("them", "those") against the
     conversation. Resolve relative time ("this week") to explicit
     bounds against CURRENT_DATE when the user clearly intends that. If the question is
     ambiguous, write the LITERAL question the user asked (do not
     invent intent).

  - classification: one of
      * "answerable"     — you can name a valid decomposition;
      * "ambiguous"      — you need a clarifying answer from the user
        before any specialist could act; populate suggested_followups
        with 1–3 crisp questions;
      * "non_data"       — the user is chatting / off-topic; refuse
        politely (no decomposition, no follow-ups required);
      * "non_sql_data"   — the user wants data the current pipeline
        cannot serve (e.g., free-text search across uploaded files);
        leave decomposition empty.

  - reason: one short sentence explaining your classification choice.

  - suggested_followups: ≥ 1 entry when classification == "ambiguous";
    empty otherwise.

  - available_targets: echo the AVAILABLE_TARGETS list below. The
    supervisor re-pins it to runtime truth, so this is an audit
    field, not a control field.

  - decomposition: ordered list of SubQuestion. Required when
    classification == "answerable". Empty otherwise.

SubQuestion shape:
  - sub_question: a self-contained question (no pronouns, no "the
    same as above"). The target specialist receives this string in
    isolation.
  - target: ONE of the targets in AVAILABLE_TARGETS. Never name a
    target outside that list.
  - depends_on_sub_question: 0-based index of an earlier sub-question
    whose result the supervisor must fold into context before
    dispatching this one. Use sparingly; only when later sub-questions
    literally cannot be expressed without the prior result.

Rules:
  * Never invent data values. If a question references a person ("Show
    me Himani's calls"), keep the literal name in the rewrite.
  * Mixed data+authoring requests decompose into TWO sub-questions
     when authoring_specialist is in AVAILABLE_TARGETS, the first
     targeting data_specialist and the second authoring_specialist
     with depends_on_sub_question=0.
  * If authoring is NOT in AVAILABLE_TARGETS and the user asks for both
    data and authoring, keep classification="answerable", emit only the
    data_specialist sub-question, and add a suggested_followup explaining
    that authoring requires opening the workflow builder.
  * If authoring is NOT in AVAILABLE_TARGETS and the user asks only for
    an authoring action, classification="ambiguous" with a suggested
    follow-up explaining that authoring requires opening the workflow builder.
  * Do not output anything except the SynthesisBrief.
"""


def _available_targets_block(targets: list[SynthesisTarget]) -> str:
    if not targets:
        return 'AVAILABLE_TARGETS: []  (no specialists wired this turn)'
    rendered = ', '.join(f'"{t}"' for t in targets)
    return f'AVAILABLE_TARGETS: [{rendered}]'


def build_query_synthesis_specialist(
    client: openai.AsyncOpenAI,
    app_id: str,
    *,
    model: str,
    available_targets: list[SynthesisTarget],
) -> Agent:
    """Construct the query_synthesis_specialist agent for one turn.

    The agent is constructed per-turn (not cached) so the
    ``AVAILABLE_TARGETS`` block in the system prompt stays in sync with
    whatever the supervisor actually wired in for this turn.
    """
    system_prompt = (
        _PERSONALITY
        + '\n\nAPP SCOPE: ' + app_id
        + '\nCURRENT_DATE: ' + date.today().isoformat()
        + '\n\n' + _available_targets_block(available_targets)
        + '\n'
    )

    return Agent(
        name='sherlock-query-synthesis-specialist',
        instructions=system_prompt,
        model=OpenAIResponsesModel(model, client),
        model_settings=ModelSettings(
            parallel_tool_calls=False,
            reasoning=Reasoning(effort='low'),
        ),
        output_type=SynthesisBrief,
        tools=[],
    )


def _refusal_brief(
    *,
    rewritten_question: str,
    reason: str,
    available_targets: list[SynthesisTarget],
) -> SynthesisBrief:
    """Substitute a deterministic refusal brief when synthesis output is
    unusable (malformed or targets an unavailable specialist).

    The supervisor sees this as a normal SynthesisBrief with
    classification='ambiguous'; it refuses the turn and surfaces the
    reason. This is the no-silent-fallback contract: bad synthesis output
    never reaches a downstream specialist.
    """
    return SynthesisBrief(
        rewritten_question=rewritten_question or '(unparseable)',
        classification='ambiguous',
        reason=reason,
        suggested_followups=[
            'Could you rephrase your question with more specifics?',
        ],
        available_targets=list(available_targets),
        decomposition=[],
    )


def make_synthesis_output_extractor(
    available_targets: list[SynthesisTarget],
) -> Any:
    """Build the ``custom_output_extractor`` for the synthesis specialist.

    The SDK calls this with the synthesis Agent's RunResult. We pull
    ``final_output`` (a ``SynthesisBrief`` when ``output_type`` works,
    otherwise a string we try to parse), re-validate against the runtime
    ``available_targets``, and return the JSON the supervisor LLM should
    see. Validation failure produces a refusal brief — never a silent
    pass-through.
    """

    async def _extract(run_result: Any) -> str:
        final = getattr(run_result, 'final_output', None)
        raw: Any
        if isinstance(final, SynthesisBrief):
            raw = final.model_dump()
        elif isinstance(final, dict):
            raw = final
        elif isinstance(final, str) and final.strip():
            try:
                raw = json.loads(final)
            except json.JSONDecodeError:
                return _refusal_brief(
                    rewritten_question='',
                    reason='synthesis returned non-JSON output',
                    available_targets=available_targets,
                ).model_dump_json()
        else:
            return _refusal_brief(
                rewritten_question='',
                reason='synthesis returned no output',
                available_targets=available_targets,
            ).model_dump_json()

        try:
            brief = SynthesisBrief.model_validate_with_targets(
                raw, available_targets=available_targets,
            )
        except (ValueError, TypeError) as exc:
            logger.warning(
                'sherlock_v3 synthesis brief failed validation: %s; '
                'substituting refusal brief',
                exc,
            )
            rewritten = ''
            if isinstance(raw, dict):
                rewritten = str(raw.get('rewritten_question') or '')
            return _refusal_brief(
                rewritten_question=rewritten,
                reason=f'synthesis output invalid: {exc}',
                available_targets=available_targets,
            ).model_dump_json()
        return brief.model_dump_json()

    return _extract


__all__ = [
    'SubQuestion',
    'SynthesisBrief',
    'SynthesisTarget',
    'build_query_synthesis_specialist',
    'make_synthesis_output_extractor',
]
