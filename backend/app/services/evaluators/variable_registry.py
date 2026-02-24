"""Backend variable registry — single source of truth for template variables.

Provides metadata for all {{variable}} tokens used in custom evaluator prompts.
The runtime resolver (prompt_resolver.py) handles actual value substitution;
this module handles discovery, validation, and API exposure.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class VariableDefinition:
    """Metadata for a single template variable (no braces)."""

    key: str                                # "transcript", "chat_transcript", etc.
    display_name: str                       # "Transcript Text"
    description: str                        # Human-readable explanation
    category: str                           # "transcript", "audio", "structured_data", "context"
    value_type: str                         # "text", "json", "file", "number"
    app_ids: list[str] = field(default_factory=list)  # ["voice-rx"] or ["kaira-bot"]
    requires_audio: bool = False            # True → triggers generate_with_audio
    requires_eval_output: bool = False      # True → needs a prior evaluation's output
    source_types: list[str] | None = None   # ["upload"], ["api"], or None for all
    example: str = ""                       # Example value for UI display


# ── Registry ─────────────────────────────────────────────────────────


class VariableRegistry:
    """Authoritative registry of all template variables."""

    def __init__(self) -> None:
        self._variables: dict[str, VariableDefinition] = {}
        self._register_voice_rx_variables()
        self._register_kaira_variables()

    # ── Public API ───────────────────────────────────────────────

    def get_for_app(self, app_id: str, source_type: str | None = None) -> list[VariableDefinition]:
        """Return variables available for *app_id*, optionally filtered by *source_type*."""
        results = []
        for v in self._variables.values():
            if app_id not in v.app_ids:
                continue
            if source_type and v.source_types and source_type not in v.source_types:
                continue
            results.append(v)
        return sorted(results, key=lambda v: (v.category, v.key))

    def validate_prompt(self, prompt: str, app_id: str, source_type: str | None = None) -> dict:
        """Validate ``{{var}}`` tokens in *prompt* against the registry."""
        used = set(re.findall(r"\{\{([a-zA-Z0-9_.]+)\}\}", prompt))
        available = {v.key for v in self.get_for_app(app_id, source_type)}

        known: set[str] = set()
        unknown: set[str] = set()
        for k in used:
            if k in available or (k.startswith("rx.") and app_id == "voice-rx"):
                known.add(k)
            else:
                unknown.add(k)

        return {
            "valid": len(unknown) == 0,
            "used_variables": sorted(known),
            "unknown_variables": sorted(unknown),
            "requires_audio": any(
                self._variables.get(k) and self._variables[k].requires_audio for k in known
            ),
            "requires_eval_output": any(
                self._variables.get(k) and self._variables[k].requires_eval_output for k in known
            ),
        }

    # ── Registration (mirrors prompt_resolver._resolve_single) ───

    def _register(self, v: VariableDefinition) -> None:
        self._variables[v.key] = v

    def _register_voice_rx_variables(self) -> None:
        r = self._register
        # ── input category ────────────────────────────────────────
        r(VariableDefinition(
            "audio", "Audio Recording",
            "The audio recording. Triggers audio-capable LLM call.",
            "input", "file", ["voice-rx"], requires_audio=True, example="[Audio file attached]",
        ))
        r(VariableDefinition(
            "transcript", "Uploaded Transcript",
            "Full transcript as [Speaker]: text lines from the uploaded listing data.",
            "input", "text", ["voice-rx"],
            example="[Doctor]: How are you feeling?\n[Patient]: I've been having headaches.",
        ))
        r(VariableDefinition(
            "api_response", "Full API Response",
            "Complete API response as JSON, including all metadata.",
            "input", "json", ["voice-rx"], source_types=["api"],
        ))
        # ── transcript_detail category ────────────────────────────
        r(VariableDefinition(
            "segment_count", "Segment Count",
            "Number of time-aligned segments in the uploaded transcript.",
            "transcript_detail", "number", ["voice-rx"], source_types=["upload"],
        ))
        r(VariableDefinition(
            "speaker_list", "Speaker List",
            "Comma-separated list of speakers in the uploaded transcript.",
            "transcript_detail", "text", ["voice-rx"], source_types=["upload"],
        ))
        r(VariableDefinition(
            "time_windows", "Time Windows",
            "Time windows from uploaded transcript for segment-aligned transcription.",
            "transcript_detail", "text", ["voice-rx"], source_types=["upload"],
        ))
        # ── api_data category (documentation entry; actual paths are dynamic) ─
        r(VariableDefinition(
            "rx.*", "API Fields (dot-path)",
            "Access any field in the API response via dot notation. "
            "Examples: {{input}} for transcript, {{rx}} for structured data, "
            "{{rx.vitals.temperature}} for specific values.",
            "api_data", "dynamic", ["voice-rx"], source_types=["api"],
            example="{{rx.vitals.bloodPressure}} → '120/80'",
        ))
        # ── standard_eval category ────────────────────────────────
        r(VariableDefinition(
            "eval_transcript", "Standard Eval Transcript",
            "Transcript generated by the standard evaluation pipeline. "
            "Requires a prior standard evaluation to have been run.",
            "standard_eval", "text", ["voice-rx"], requires_eval_output=True,
        ))
        r(VariableDefinition(
            "eval_structured", "Standard Eval Structured Data",
            "Structured data extracted by the standard evaluation pipeline. "
            "Requires a prior standard evaluation to have been run.",
            "standard_eval", "json", ["voice-rx"], requires_eval_output=True,
        ))

    def _register_kaira_variables(self) -> None:
        self._register(VariableDefinition(
            "chat_transcript", "Chat Transcript",
            "Full conversation formatted as User: / Bot: lines.",
            "transcript", "text", ["kaira-bot"],
            example="User: I had rice and dal for lunch\nBot: Sure! Let me log that meal for you.",
        ))


# ── Singleton ────────────────────────────────────────────────────────

_registry: VariableRegistry | None = None


def get_registry() -> VariableRegistry:
    """Return the global VariableRegistry instance (created on first call)."""
    global _registry
    if _registry is None:
        _registry = VariableRegistry()
    return _registry
