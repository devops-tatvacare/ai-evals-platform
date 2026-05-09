"""Sherlock v3 supervisor (architecture spec §3, §9, §11).

Composes the data_specialist (P1) and retrieval_specialist (P2 — stub
placeholder) via ``as_tool``. The supervisor's job is decomposition,
fan-out, and synthesis; specialists do the bounded work.

P1 scaffold: only data_specialist is wired. retrieval_specialist arrives
in P2 along with surface_search / vector_search tooling. action_specialist
is P4.
"""
from __future__ import annotations

import openai
from agents import Agent
from agents.model_settings import ModelSettings
from agents.models.openai_responses import OpenAIResponsesModel
from openai.types.shared import Reasoning

from app.services.sherlock_v3.azure_client import supervisor_model
from app.services.sherlock_v3.contracts import TASK_BRIEF_JSON_SCHEMA
from app.services.sherlock_v3.data_specialist import build_data_specialist


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

# Output
- Markdown. Tables for tabular data. Bold key numbers.
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
</tool_persistence_rules>

<output_contract>
- Lead with the answer. No preamble.
- Bold key numbers and use arrows for comparisons (+5%, -12 calls).
- Abbreviate UUIDs to first 8 chars in prose.
</output_contract>
"""


def build_supervisor(app_id: str, client: openai.AsyncAzureOpenAI) -> Agent:
    """Build the supervisor agent for one app.

    The supervisor is constructed per turn (not cached) so the prompt's
    ``app_id`` substitution stays correct in multi-tenant pools. Per-tenant
    capability-pack wiring lands in P2 along with retrieval_specialist.

    The client comes from the route handler (one per turn, tenant-scoped via
    ``get_sherlock_azure_client``).
    """
    data_spec = build_data_specialist(client, app_id)

    return Agent(
        name=f'sherlock-supervisor-{app_id}',
        instructions=_SUPERVISOR_PROMPT.format(app_id=app_id),
        model=OpenAIResponsesModel(supervisor_model(), client),
        # gpt-5.4 reasoning models reject `temperature` and `top_p`. The
        # spec's "temperature=0.3" was for non-reasoning models; for the
        # reasoning family, control behavior via reasoning effort instead.
        model_settings=ModelSettings(
            reasoning=Reasoning(effort='medium'),
        ),
        tools=[
            data_spec.as_tool(
                tool_name='data_specialist',
                tool_description=(
                    'Answers analytics questions over evaluation facts. '
                    'Pass a TaskBrief; receive a SpecialistResult.'
                ),
                custom_output_extractor=None,
            ),
        ],
    )


# Re-exported for the route handler so /api/chat/turn doesn't have to know
# about the contract module directly.
__all__ = ['build_supervisor', 'TASK_BRIEF_JSON_SCHEMA']
