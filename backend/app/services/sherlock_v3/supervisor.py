"""Sherlock v3 supervisor — pure router over three specialists.

The supervisor is a thin LLM that runs the turn lifecycle via the Agents
SDK. Its responsibilities are limited to:

  1. Call ``query_synthesis_specialist`` FIRST on every turn.
  2. Honor the returned ``SynthesisBrief``:
     * refuse with ``suggested_followups`` when classification != answerable;
     * dispatch each sub-question to the named target specialist;
     * never call a specialist that is absent from the toolbelt this turn.
  3. Compose the final answer for the user.

Toolbelt composition is decided per-turn:

  * ``data_specialist`` is always present.
  * ``authoring_specialist`` is present only when ``builder_context`` is
    in edit mode AND the caller holds ``orchestration:manage``
    (Owner role bypass routed through ``missing_permissions``).
  * ``query_synthesis_specialist`` is always present and always called
    first per the supervisor prompt.

The supervisor itself runs inside ONE ``Runner.run_streamed`` call from
``runtime.run_turn``. No pre-Python orchestration, no parallel runners,
no intent classifier — those died in Phase 4.
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
from app.services.sherlock_v3.contracts import (
    SYNTHESIS_BRIEF_JSON_SCHEMA,
    SynthesisTarget,
)
from app.services.sherlock_v3.data_specialist import (
    build_data_specialist,
    extract_data_specialist_output,
)
from app.services.sherlock_v3.query_synthesis_specialist import (
    build_query_synthesis_specialist,
    make_synthesis_output_extractor,
)


_SUPERVISOR_PROMPT = """\
Role: Sherlock — analyst-by-prompt for evaluation data.

# Personality
Sharp, observant, lightly witty. Confident and warm.

# Playbook (mandatory, in this order)

1. **Always call ``query_synthesis_specialist`` first** on every user
   turn — even short / simple ones. It returns a SynthesisBrief with
   ``rewritten_question``, ``classification``, ``decomposition``, and
   ``suggested_followups``. You may NOT skip this step.

2. **Refuse politely when classification is not "answerable":**
   - ``ambiguous``     → ask ONE crisp clarifying question drawn from
     ``suggested_followups``. End the turn.
   - ``non_data``      → respond briefly in character and end the turn.
   - ``non_sql_data``  → explain that this Sherlock surface answers SQL
     analytics questions only; end the turn.

3. **Dispatch the decomposition when classification == "answerable":**
   For each sub-question, call ONLY the target specialist named in the
   SubQuestion's ``target`` field. If a sub-question depends on an
   earlier one, wait for that sub-question's result before dispatching.

4. **Never call a specialist absent from your toolbelt this turn.** The
   tools available to you are listed below under AVAILABLE_TOOLS.
   Query synthesis was instructed to only emit targets from your
   available toolbelt; if a returned target is unavailable anyway,
   refuse with a short explanation rather than improvising.

5. **Compose the final answer** from the specialists' summaries +
   artifacts. Be honest about cardinality — if ``more_rows_exist`` is
   true on a SpecialistResult, say "top N of more" not "N".

# Success criteria
- A direct answer in 1-3 sentences plus optional table/chart artifacts.
- Numbers cite the artifact, never invented.
- Mixed asks are handled by the synthesis-driven decomposition, not by
  improvising parallel tool calls.

# Constraints
- Only call the tools listed below. Do not generate SQL, embeddings, or
  actions yourself.
- Stay in scope of this app: {app_id}. Out-of-scope topics → brief
  refusal in character (synthesis classifies these as ``non_data``).
- Authoring tools propose patches; never claim work is saved or published
  — the user reviews and saves manually.

# Hidden-mirror recovery
The raw CRM mirror tables (``analytics.crm_call_record``,
``analytics.crm_lead_record``) are deliberately not in the analytics
catalog: they hold PII and dirty source payloads and are replaced by
``analytics.fact_lead_activity`` (filtered by ``activity_type`` when
relevant) and ``analytics.dim_lead`` respectively. If the user explicitly
names ``crm_call_record`` or ``crm_lead_record`` in their question,
treat that as a reference to the corresponding fact / dim surface,
dispatch the specialist against the correct table, and acknowledge the
translation in your answer so the user can correct the prompt next time.
Example: "I read calls from ``fact_lead_activity`` (filtered to
``activity_type = 'call'``) rather than the raw ``crm_call_record``
mirror — same call universe."

# AVAILABLE_TOOLS this turn
{available_tools_block}

# Output
- Markdown. Tables for tabular data. Bold key numbers.
- NEVER draw ASCII charts (no `█`/`▓`/`●`/`*` bar lines). The UI renders
  chart cards from specialist artifacts; duplicating them in prose makes
  the answer noisy.
- Do NOT cite "Evidence ref <uuid>" inline. Evidence is rendered
  separately by the UI; prose should read clean and human.
- Use phase: "commentary" for status updates.
- Use phase: "final_answer" only when synthesizing the answer.

# Stop rules
- Stop when (a) a real result lands, (b) a single clarifying question is
  needed, or (c) the capability truly cannot satisfy the ask.

<instruction_priority>
1. Synthesis-first playbook (above)
2. Tool persistence rules
3. Output contract
4. Safety / scope
5. Personality
</instruction_priority>

<tool_persistence_rules>
- If a specialist returns status=empty or status=partial, retry once
  with a broadened brief before answering.
- If a specialist returns status=needs_clarification, ask the user
  exactly one crisp clarifying question.
- For compound questions, dispatch sub-questions in the order produced
  by query synthesis. Parallel dispatch is allowed ONLY when two
  sub-questions have no ``depends_on_sub_question`` link to each other.
- Authoring tools propose patches; never claim work is saved or
  published — the user reviews and saves manually.
</tool_persistence_rules>

<output_contract>
- Lead with the answer. No preamble.
- Bold key numbers and use arrows for comparisons (+5%, -12 calls).
- Abbreviate UUIDs to first 8 chars in prose.
</output_contract>
"""


def _format_available_tools(available_targets: list[SynthesisTarget]) -> str:
    """Render the AVAILABLE_TOOLS block for the supervisor prompt.

    Synthesis is always available and listed first because the playbook
    requires it on every turn. Specialist targets follow.
    """
    lines = ['- query_synthesis_specialist  (always called first)']
    if 'data_specialist' in available_targets:
        lines.append('- data_specialist            (SQL analytics over curated catalog)')
    if 'authoring_specialist' in available_targets:
        lines.append('- authoring_specialist       (workflow-builder canvas edits)')
    return '\n'.join(lines)


def build_supervisor(
    app_id: str,
    client: openai.AsyncAzureOpenAI,
    *,
    grounding: Any | None = None,
    builder_context: BuilderSnapshot | None = None,
    auth: AuthContext | None = None,
) -> Agent:
    """Build the supervisor agent for one turn.

    The supervisor is constructed per turn (not cached) so the available-
    tools block stays in sync with the per-turn permission/context gating.

    Authoring sub-agent inclusion is **conditional** (Decision §R2):
    ``authoring_specialist.as_tool(...)`` is only added to ``tools=[...]``
    when the route provided an editable builder context and the caller
    has ``orchestration:manage``. The LLM cannot call a tool that doesn't
    exist, so the gate happens before any token sampling.

    The available-target list passed to ``query_synthesis_specialist``
    mirrors the supervisor's actual toolbelt 1:1 — synthesis can only
    emit targets the supervisor can dispatch.
    """
    # ── decide the toolbelt for this turn ─────────────────────────────
    available_targets: list[SynthesisTarget] = ['data_specialist']
    authoring_agent = None

    # Owner role bypasses permission lists; route through the canonical
    # helper so Owners see the authoring tool too.
    from app.auth.permissions import missing_permissions
    if (
        builder_context is not None
        and builder_context.view_mode == 'edit'
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
            available_targets.append('authoring_specialist')

    # ── build specialists ─────────────────────────────────────────────
    data_spec = build_data_specialist(
        client, app_id,
        grounding=grounding,
    )
    synthesis_spec = build_query_synthesis_specialist(
        client, app_id, available_targets=available_targets,
    )

    # Typed ``list[Any]`` because the supervisor's ``tools=`` list mixes
    # the SDK's ``Tool`` union; conditionally appending the authoring
    # sub-agent here keeps the wiring readable without invariance hacks.
    tools: list[Any] = [
        synthesis_spec.as_tool(
            tool_name='query_synthesis_specialist',
            tool_description=(
                'Rewrite, classify, and decompose the user\'s question into a '
                'SynthesisBrief. ALWAYS call this first on every turn. Returns '
                'a SynthesisBrief JSON; refuse the turn if classification != '
                'answerable.'
            ),
            custom_output_extractor=make_synthesis_output_extractor(available_targets),
        ),
        data_spec.as_tool(
            tool_name='data_specialist',
            tool_description=(
                'Answers analytics questions over evaluation facts. '
                'Pass the sub-question text from the SynthesisBrief; '
                'receive a SpecialistResult.'
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
        instructions=_SUPERVISOR_PROMPT.format(
            app_id=app_id,
            available_tools_block=_format_available_tools(available_targets),
        ),
        model=OpenAIResponsesModel(supervisor_model(), client),
        # gpt-5.4 reasoning models reject ``temperature`` and ``top_p``.
        # Control behavior via reasoning effort instead.
        model_settings=ModelSettings(
            parallel_tool_calls=False,
            reasoning=Reasoning(effort='medium'),
        ),
        tools=tools,
    )


__all__ = [
    'build_supervisor',
    'SYNTHESIS_BRIEF_JSON_SCHEMA',
]
