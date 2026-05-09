"""Sherlock v3 data_specialist (architecture spec §10.1).

P1 ships this as a **scaffold with stub tools**. The supervisor wiring,
SSE event surface, and contract validation are real; the SQL execution
path is a placeholder that returns ``status='empty'`` so end-to-end tests
exercise the whole loop without touching the analytics DB.

Replace the stub tool bodies in P1.X follow-ups before flipping the
``SHERLOCK_V3_ENABLED`` feature flag for real users. The replacement
plumbs into the existing chartability pipeline:

  result_set_typer.type_result_set
    → chartability_gate.evaluate
    → chart_type_picker.pick
    → vega_lite_emitter.emit

…producing an ``Artifact(kind='chart', payload=…)`` byte-identical to
today's analytics.chart.v1 contract (architecture spec §16).
"""
from __future__ import annotations

import time

import openai
from agents import Agent
from agents.model_settings import ModelSettings
from agents.models.openai_responses import OpenAIResponsesModel

from app.services.sherlock_v3.azure_client import specialist_model
from app.services.sherlock_v3.contracts import (
    SpecialistMeta,
    SpecialistResult,
    StateDelta,
    TaskBrief,
)


_INSTRUCTIONS_SCAFFOLD = """\
You are Sherlock's data_specialist. You answer one analytics question at
a time using the SQL toolset bound to the manifest slice in your context.
Always return a SpecialistResult shape. Cite evidence by ref_id.

THIS IS A P1 SCAFFOLD. The SQL tools are stubs — return status='empty'
with summary='data_specialist scaffold; SQL tools land in P1.X' until the
real implementation lands.
"""


def build_data_specialist(client: openai.AsyncAzureOpenAI) -> Agent:
    """Construct the data_specialist Agent.

    P1 scaffold has no tools wired. The supervisor's ``as_tool(...)`` call
    still works because ``as_tool`` only requires the agent itself — the
    specialist's *internal* tools fire when the supervisor invokes it.

    The client comes from the route handler (per-turn, tenant-scoped) so we
    don't reach into ``get_sherlock_azure_client`` from inside the builder
    — that helper is async and the agent constructor isn't.
    """
    return Agent(
        name='sherlock-data-specialist',
        instructions=_INSTRUCTIONS_SCAFFOLD,
        model=OpenAIResponsesModel(specialist_model(), client),
        model_settings=ModelSettings(temperature=0.0),
    )


def stub_specialist_result(brief: TaskBrief, started_at: float) -> SpecialistResult:
    """Synthetic ``SpecialistResult`` returned by the scaffold path.

    Used only while ``SHERLOCK_V3_ENABLED`` is off and the route handler is
    smoke-testing the contract round-trip without hitting the model.
    """
    return SpecialistResult(
        kind='data',
        status='empty',
        summary='data_specialist scaffold; SQL tools land in P1.X',
        evidence=[],
        artifacts=[],
        state_delta=StateDelta(),
        meta=SpecialistMeta(
            confidence=0.0,
            latency_ms=int((time.monotonic() - started_at) * 1000),
            source_pack_id=brief.scope.app_id,
        ),
    )
