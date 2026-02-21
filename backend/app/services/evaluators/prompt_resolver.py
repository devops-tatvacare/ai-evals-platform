"""Prompt template variable resolver for evaluations.

Ported from src/services/templates/variableResolver.ts — resolves
{{variable}} tokens in prompt text using listing/evaluation context.
Supports both voice-rx (listing-based) and kaira-bot (session-based) variables.
"""
import json
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


def format_chat_transcript(messages: list[dict]) -> str:
    """Format chat messages as a readable User/Bot transcript.

    Filters to user/assistant roles and outputs plain text.
    """
    lines = []
    for msg in messages:
        role = msg.get("role", "").lower()
        content = msg.get("content", "")
        if role == "user":
            lines.append(f"User: {content}")
        elif role in ("assistant", "bot"):
            lines.append(f"Bot: {content}")
    return "\n".join(lines)


def _format_transcript_as_text(transcript: dict) -> str:
    """Format TranscriptData segments as readable text."""
    segments = transcript.get("segments", [])
    return "\n".join(f"[{s.get('speaker', 'Unknown')}]: {s.get('text', '')}" for s in segments)


def _extract_speakers(transcript: dict) -> list[str]:
    """Extract unique speaker names from transcript."""
    seen = set()
    speakers = []
    for seg in transcript.get("segments", []):
        speaker = seg.get("speaker", "Unknown")
        if speaker not in seen:
            seen.add(speaker)
            speakers.append(speaker)
    return speakers


def _extract_time_windows(transcript: dict) -> str:
    """Extract time windows from transcript for segment-aligned transcription."""
    lines = []
    for idx, seg in enumerate(transcript.get("segments", [])):
        start = seg.get("startTime", "00:00:00")
        end = seg.get("endTime", "00:00:00")
        speaker = seg.get("speaker", "Unknown")
        lines.append(f"{idx + 1}. [{start} - {end}] Speaker hint: {speaker}")
    return "\n".join(lines)


def _get_nested_value(data: dict, path: str):
    """Get a nested value from a dict using dot notation (e.g. 'rx.vitals.temperature')."""
    current = data
    for key in path.split("."):
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return None
    return current


def resolve_prompt(
    prompt_text: str,
    context: dict,
) -> dict:
    """Resolve template variables in a prompt string.

    Args:
        prompt_text: Prompt with {{variable}} placeholders.
        context: Dict with keys:
            - listing: dict (Listing row data) — for voice-rx
            - ai_eval: dict | None (existing AIEvaluation)
            - prerequisites: dict | None (language, targetScript, etc.)
            - messages: list[dict] — for kaira-bot (chat messages)

    Returns:
        Dict with:
            - prompt: Resolved prompt string
            - resolved_variables: dict of key → resolved value
            - unresolved_variables: list of unresolved variable keys
    """
    listing = context.get("listing", {})
    ai_eval = context.get("ai_eval")
    prerequisites = context.get("prerequisites", {})

    # Find all {{variable}} tokens
    variables = set(re.findall(r"\{\{[a-zA-Z0-9_.]+\}\}", prompt_text))

    resolved = {}
    unresolved = []
    result = prompt_text

    for var_key in variables:
        inner = var_key[2:-2]  # strip {{ and }}
        value = _resolve_single(inner, listing, ai_eval, prerequisites, context)

        if value is not None:
            resolved[var_key] = value
            result = result.replace(var_key, value)
        else:
            # Try API JSON path variables (e.g., rx.vitals.temperature)
            api_response = listing.get("api_response") or listing.get("apiResponse")
            if api_response and isinstance(api_response, dict):
                nested = _get_nested_value(api_response, inner)
                if nested is not None:
                    str_val = json.dumps(nested, indent=2) if isinstance(nested, (dict, list)) else str(nested)
                    resolved[var_key] = str_val
                    result = result.replace(var_key, str_val)
                    continue
            unresolved.append(var_key)

    return {
        "prompt": result,
        "resolved_variables": resolved,
        "unresolved_variables": unresolved,
    }


def _resolve_single(
    key: str,
    listing: dict,
    ai_eval: Optional[dict],
    prerequisites: dict,
    context: Optional[dict] = None,
) -> Optional[str]:
    """Resolve a single variable key (without braces)."""
    # Kaira-bot variable: chat transcript
    if key == "chat_transcript":
        messages = (context or {}).get("messages", [])
        if messages:
            return format_chat_transcript(messages)
        return None

    transcript = listing.get("transcript")
    api_response = listing.get("api_response") or listing.get("apiResponse")

    if key == "audio":
        # Audio is handled by the runner (sent as actual file data).
        # Return None so it lands in unresolved_variables — the runner
        # replaces {{audio}} with a marker after resolution.
        return None

    if key == "transcript":
        if transcript:
            return _format_transcript_as_text(transcript)
        return None

    if key == "llm_transcript":
        judge_output = None
        if ai_eval:
            judge_output = ai_eval.get("judgeOutput") or ai_eval.get("judge_output")
        if judge_output:
            # judgeOutput has 'transcript' (string) directly
            if isinstance(judge_output, dict) and "transcript" in judge_output:
                return judge_output["transcript"]
            return _format_transcript_as_text(judge_output)
        return None

    if key == "script_preference":
        output_script = prerequisites.get("outputScript")
        if output_script:
            return output_script
        return prerequisites.get("targetScript", prerequisites.get("target_script", "roman"))

    if key == "language_hint":
        return prerequisites.get("language", "Not specified")

    if key == "preserve_code_switching":
        val = prerequisites.get("preserveCodeSwitching", prerequisites.get("preserve_code_switching", True))
        return "yes" if val else "no"

    if key == "original_script":
        # We don't have the script detector on backend; return "auto" as default
        return prerequisites.get("sourceScript", prerequisites.get("source_script", "auto"))

    # Segment-dependent variables: only resolve when use_segments is True
    use_segments = (context or {}).get("use_segments", True)

    if key == "segment_count":
        if not use_segments:
            return None
        if transcript:
            return str(len(transcript.get("segments", [])))
        return None

    if key == "speaker_list":
        if not use_segments:
            return None
        if transcript:
            return ", ".join(_extract_speakers(transcript))
        return None

    if key == "time_windows":
        if not use_segments:
            return None
        if transcript and transcript.get("segments"):
            return _extract_time_windows(transcript)
        return None

    if key == "structured_output":
        if api_response and isinstance(api_response, dict):
            rx = api_response.get("rx")
            if rx:
                return json.dumps(rx, indent=2)
        return None

    if key == "api_input":
        if api_response and isinstance(api_response, dict):
            inp = api_response.get("input")
            if inp is not None:
                return inp if isinstance(inp, str) else json.dumps(inp, indent=2)
        return None

    if key == "api_rx":
        if api_response:
            return json.dumps(api_response, indent=2)
        return None

    if key == "llm_structured":
        if ai_eval:
            judge_output = ai_eval.get("judgeOutput") or ai_eval.get("judge_output")
            if judge_output and judge_output.get("structuredData"):
                return json.dumps(judge_output["structuredData"], indent=2)
        return None

    # Unknown variable
    return None
