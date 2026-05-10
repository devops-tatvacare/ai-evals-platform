"""Sherlock v3 supervisor (architecture spec §3, §9, §11).

Composes the data_specialist (P1) and retrieval_specialist (P2 — stub
placeholder) via ``as_tool``. The supervisor's job is decomposition,
fan-out, and synthesis; specialists do the bounded work.

P1 scaffold: only data_specialist is wired. retrieval_specialist arrives
in P2 along with surface_search / vector_search tooling. action_specialist
is P4.
"""
from __future__ import annotations

from typing import Any

import openai
from agents import Agent
from agents.model_settings import ModelSettings
from agents.models.openai_responses import OpenAIResponsesModel
from openai.types.shared import Reasoning

from app.auth.context import AuthContext
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.sherlock_v3.authoring_specialist import (
    CanvasTooLargeError,
    build_authoring_specialist,
    extract_authoring_specialist_output,
)
from app.services.sherlock_v3.azure_client import supervisor_model
from app.services.sherlock_v3.contracts import TASK_BRIEF_JSON_SCHEMA
from app.services.sherlock_v3.data_specialist import (
    build_data_specialist,
    extract_data_specialist_output,
)
from app.services.sherlock_v3.manifest_projection import GroundingContext


_SUPERVISOR_PROMPT = """\
Role: Sherlock — analyst-by-prompt for evaluation data.

# Personality
Sharp, observant, lightly witty. Confident and warm.

# Goal
Answer the user's data question correctly using the specialist tools available
in this app's capability pack. Never invent data. Cite evidence.

# Success criteria
- A direct answer to the user's question, in 1-3 sentences plus optional
  table/chart.
- All numbers cite SpecialistResult evidence refs.
- Compound questions get all needed specialists fired (parallel when
  independent).

# Constraints
- Only call specialist tools. Do not generate SQL, embeddings, or actions
  yourself.
- Stay in scope of this app: {app_id}. Out-of-scope topics → brief refusal
  in character.
- When `builder_context` is present you are operating with the user inside
  the orchestration workflow builder. Propose edits via
  `authoring_specialist`; the canvas state is already in your context.

# Output
- Markdown. Tables for tabular data. Bold key numbers.
- NEVER draw ASCII charts (no `█`/`▓`/`●`/`*` bar lines). The UI renders chart cards from specialist artifacts; duplicating them in prose makes the answer noisy.
- Do NOT cite "Evidence ref <uuid>" inline. Evidence is rendered separately by the UI; prose should read clean and human.
- Use phase: "commentary" for status updates.
- Use phase: "final_answer" only when synthesizing the answer.

# Stop rules
- Stop when (a) a real result lands, (b) a single clarifying question is
  needed, or (c) the capability truly cannot satisfy the ask.

<instruction_priority>
1. Tool persistence rules
2. Output contract
3. Safety / scope
4. Personality
</instruction_priority>

<tool_persistence_rules>
- If a specialist returns status=empty or status=partial, retry once with a
  broadened brief before answering.
- If a specialist returns status=needs_clarification, ask the user exactly
  one crisp clarifying question.
- For compound questions, fire independent specialists in parallel in the
  same turn. Sequence only when brief B references A's evidence.
- Authoring tools propose patches; never claim work is saved or published —
  the user reviews and saves manually.
- If the user asks both an analytics question AND an authoring action in
  the same message, call data_specialist FIRST, read the result, THEN
  call authoring_specialist. Never both in parallel.
</tool_persistence_rules>

<output_contract>
- Lead with the answer. No preamble.
- Bold key numbers and use arrows for comparisons (+5%, -12 calls).
- Abbreviate UUIDs to first 8 chars in prose.
</output_contract>
"""


def build_supervisor(
    app_id: str,
    client: openai.AsyncAzureOpenAI,
    *,
    grounding: GroundingContext | None = None,
    builder_context: BuilderSnapshot | None = None,
    auth: AuthContext | None = None,
) -> Agent:
    """Build the supervisor agent for one app.

    The supervisor is constructed per turn (not cached) so the prompt's
    ``app_id`` substitution stays correct in multi-tenant pools.

    Authoring sub-agent inclusion is **conditional** (Decision §R2):
    `authoring_specialist.as_tool(...)` is only added to `tools=[...]`
    when `builder_context is not None` AND
    `'orchestration:manage' in auth.permissions`. The LLM cannot call a
    tool that doesn't exist, so the gate happens before any token
    sampling.
    """
    data_spec = build_data_specialist(client, app_id, grounding=grounding)

    # Typed `list[Any]` because the supervisor's `tools=` list mixes
    # the SDK's `Tool` union; conditionally appending the authoring
    # sub-agent here keeps the wiring readable without invariance hacks.
    tools: list[Any] = [
        data_spec.as_tool(
            tool_name='data_specialist',
            tool_description=(
                'Answers analytics questions over evaluation facts. '
                'Pass a TaskBrief; receive a SpecialistResult.'
            ),
            # Critical: without this extractor, the SDK's default
            # ("last message from the agent will be used") swallows
            # the SpecialistResult JSON that ``submit_sql`` produced
            # and the supervisor sees only the data_specialist's
            # LLM prose. See ``data_specialist.extract_data_specialist_output``
            # for full background (2026-05-10 investigation).
            custom_output_extractor=extract_data_specialist_output,
        ),
    ]

    # Owner role bypasses permission lists; route through the canonical
    # helper so Owners see the authoring tool too.
    from app.auth.permissions import missing_permissions
    if (
        builder_context is not None
        and auth is not None
        and not missing_permissions(auth, 'orchestration:manage')
    ):
        try:
            authoring_agent = build_authoring_specialist(
                client, app_id,
                builder_context=builder_context,
                auth=auth,
            )
        except CanvasTooLargeError:
            # Phase 3 Step 8 — canvas exceeds the inline-context cap.
            # Skip authoring tool inclusion for this turn; the supervisor
            # responds in prose. No LLM round-trip for the specialist
            # was attempted.
            authoring_agent = None
        if authoring_agent is not None:
            tools.append(
                authoring_agent.as_tool(
                    tool_name='authoring_specialist',
                    tool_description=(
                        'Propose canvas edits to the active orchestration '
                        'workflow as one CanvasPatch artifact. Returns a '
                        'SpecialistResult; the user reviews and saves manually. '
                        'Authoring-only — never claim work is saved/published.'
                    ),
                    custom_output_extractor=extract_authoring_specialist_output,
                )
            )

    return Agent(
        name=f'sherlock-supervisor-{app_id}',
        instructions=_SUPERVISOR_PROMPT.format(app_id=app_id),
        model=OpenAIResponsesModel(supervisor_model(), client),
        # gpt-5.4 reasoning models reject `temperature` and `top_p`. The
        # spec's "temperature=0.3" was for non-reasoning models; for the
        # reasoning family, control behavior via reasoning effort instead.
        model_settings=ModelSettings(
            parallel_tool_calls=False,
            reasoning=Reasoning(effort='medium'),
        ),
        tools=tools,
    )


# Re-exported for the route handler so /api/chat/turn doesn't have to know
# about the contract module directly.
__all__ = ['build_supervisor', 'TASK_BRIEF_JSON_SCHEMA']
