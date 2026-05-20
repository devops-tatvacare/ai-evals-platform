"""Closed registry of LLM call sites. Capability-named only — never app-named.

Adding a call site requires:
  1. an entry here (with required + optional capability tags),
  2. a platform-default row seeded in migration 0051 (or a follow-on migration),
  3. every consuming code path calling ``resolve_llm_call`` with this id.

Capability tag vocabulary mirrors the README — the same 11 tags computed by
``app.services.llm_credentials.capabilities.compute_capabilities`` from the
``analytics.ref_llm_models_catalog`` columns. Match is set inclusion:
``required_capabilities <= model.capabilities`` must hold at resolve time.
"""
from __future__ import annotations

from dataclasses import dataclass


# Tags consumed/produced by ``compute_capabilities``. Used here only to fail
# loudly if a CallSiteSpec lists an unknown tag.
CAPABILITY_VOCABULARY: frozenset[str] = frozenset(
    {
        "text_input",
        "text_output",
        "image_input",
        "audio_input",
        "audio_output",
        "video_input",
        "pdf_input",
        "reasoning",
        "tool_call",
        "structured_output",
        "attachment",
    }
)


@dataclass(frozen=True)
class CallSiteSpec:
    id: str
    required_capabilities: frozenset[str]
    optional_capabilities: frozenset[str]
    description: str
    # Capability surface / job / route where this call site is consumed.
    # Capability-named only — never app-named.
    reference: str

    def __post_init__(self) -> None:
        unknown_required = self.required_capabilities - CAPABILITY_VOCABULARY
        unknown_optional = self.optional_capabilities - CAPABILITY_VOCABULARY
        if unknown_required or unknown_optional:
            raise ValueError(
                f"CallSiteSpec '{self.id}' references unknown capability tags: "
                f"required={sorted(unknown_required)} optional={sorted(unknown_optional)}"
            )


class UnknownCallSiteError(RuntimeError):
    """Raised when ``resolve_llm_call`` is asked for a call site not in the registry."""

    def __init__(self, call_site_id: str):
        self.call_site_id = call_site_id
        super().__init__(
            f"Unknown LLM call site '{call_site_id}'. "
            f"Register it in app/services/llm_credentials/call_sites.py first."
        )


CALL_SITES: dict[str, CallSiteSpec] = {
    "chat_text": CallSiteSpec(
        id="chat_text",
        required_capabilities=frozenset({"text_input", "text_output"}),
        optional_capabilities=frozenset({"tool_call"}),
        description="Plain text chat.",
        reference="Batch, adversarial, and custom evaluation runner replies.",
    ),
    "chat_vision": CallSiteSpec(
        id="chat_vision",
        required_capabilities=frozenset({"text_input", "text_output", "image_input"}),
        optional_capabilities=frozenset({"tool_call"}),
        description="Multimodal chat with image input.",
        reference="Registered — no runtime consumer yet.",
    ),
    "chat_reasoning": CallSiteSpec(
        id="chat_reasoning",
        required_capabilities=frozenset({"text_input", "text_output", "reasoning"}),
        optional_capabilities=frozenset({"tool_call"}),
        description="Chat that benefits from explicit reasoning support.",
        reference="Registered — no runtime consumer yet.",
    ),
    "audio_transcription": CallSiteSpec(
        id="audio_transcription",
        required_capabilities=frozenset({"audio_input", "text_output"}),
        optional_capabilities=frozenset(),
        description="Speech-to-text.",
        reference="Transcription stage of the audio evaluation runner.",
    ),
    "audio_synthesis": CallSiteSpec(
        id="audio_synthesis",
        required_capabilities=frozenset({"text_input", "audio_output"}),
        optional_capabilities=frozenset(),
        description="Text-to-speech.",
        reference="Registered — no runtime consumer yet.",
    ),
    "evaluator_draft": CallSiteSpec(
        id="evaluator_draft",
        required_capabilities=frozenset({"text_input", "text_output", "structured_output"}),
        optional_capabilities=frozenset({"attachment"}),
        description="Drafting evaluator rubrics from user intent.",
        reference="generate-evaluator-draft job.",
    ),
    "lead_signal_extraction": CallSiteSpec(
        id="lead_signal_extraction",
        required_capabilities=frozenset({"text_input", "text_output", "structured_output"}),
        optional_capabilities=frozenset(),
        description="Structured extraction of CRM lead signals.",
        reference="backfill-lead-signals job.",
    ),
    "report_generation": CallSiteSpec(
        id="report_generation",
        required_capabilities=frozenset({"text_input", "text_output"}),
        optional_capabilities=frozenset(),
        description="Report-builder prose synthesis.",
        reference="generate-report job.",
    ),
    "analytics_supervisor": CallSiteSpec(
        id="analytics_supervisor",
        required_capabilities=frozenset({"text_input", "text_output", "tool_call"}),
        optional_capabilities=frozenset({"reasoning"}),
        description="Sherlock supervisor agent (decomposes turns into specialist tool calls).",
        reference="Analytics chat — supervisor turn.",
    ),
    "analytics_specialist": CallSiteSpec(
        id="analytics_specialist",
        required_capabilities=frozenset({"text_input", "text_output", "structured_output"}),
        optional_capabilities=frozenset({"tool_call"}),
        description="Sherlock specialist agents (data / authoring / query-synthesis).",
        reference="Analytics chat — specialist subtasks.",
    ),
    "assist_prompt_or_schema": CallSiteSpec(
        id="assist_prompt_or_schema",
        required_capabilities=frozenset({"text_input", "text_output", "structured_output"}),
        optional_capabilities=frozenset({"audio_input"}),
        description="Prompt, schema, and extract-structured assist.",
        reference="/api/llm/assist/* endpoints.",
    ),
}


def get_call_site(call_site_id: str) -> CallSiteSpec:
    spec = CALL_SITES.get(call_site_id)
    if spec is None:
        raise UnknownCallSiteError(call_site_id)
    return spec


def list_call_sites() -> list[CallSiteSpec]:
    """Stable-ordered list for /api/llm/call-sites and tests."""
    return [CALL_SITES[k] for k in sorted(CALL_SITES.keys())]
