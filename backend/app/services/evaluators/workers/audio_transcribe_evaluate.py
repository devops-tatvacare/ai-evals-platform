"""Audio call worker: download recording → transcribe → evaluate against rubrics.

One worker per call recording. Shell handles parallelism, persistence, and
lifecycle. This module only knows how to turn one EvaluableCall + a set of
evaluators into a `WorkerOutput`.

Naming: this worker is generic by capability, not by app. Any app whose
DatasetBinding produces EvaluableCall records can reference
`audio_transcribe_evaluate` from its App.config.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.analytics.signal_taxonomy import SIGNAL_TYPES
from app.services.evaluators.output_schema_utils import primary_score
from app.services.evaluators.response_parser import _safe_parse_json
from app.services.evaluators.runner_utils import set_usage_call_purpose
from app.services.evaluators.schema_generator import generate_json_schema
from app.services.evaluators.workers.types import (
    EvaluatorOutput,
    WorkerContext,
    WorkerOutput,
)

logger = logging.getLogger(__name__)


# ── Recording-missing sentinel ───────────────────────────────────────


class RecordingMissingError(RuntimeError):
    """Raised when an EvaluableCall has no recording_url. The shell catches
    this and persists it as a per-thread error, so the run still summarises
    cleanly with one failed thread instead of crashing the whole job."""


# ── Signals contract — append the runtime-only `signals` field ──────


def _signal_field_description() -> str:
    enum_inline = ", ".join(sorted(SIGNAL_TYPES))
    return (
        "Coaching signals extracted from this call. Emit one entry per "
        "discrete signal (commitments, intents, objections, outcomes, etc.). "
        f"Use one of the controlled signal_type values: {enum_inline}. If "
        "none of the controlled types fit, use 'other_notable_signal' and "
        "describe the raw label inside attributes.signal_type_raw. Return an "
        "empty array when no signals are present in the call."
    )


def _build_signals_field_definition() -> dict[str, Any]:
    return {
        "key": "signals",
        "type": "array",
        "description": _signal_field_description(),
        "arrayItemSchema": {
            "itemType": "object",
            "properties": [
                {"key": "signal_type", "type": "string", "description": "Canonical signal type."},
                {"key": "signal_value", "type": "string", "description": "Optional canonical short value."},
                {"key": "signal_value_numeric", "type": "number", "description": "Optional numeric value."},
                {"key": "signal_at", "type": "string", "description": "Optional ISO-8601 timestamp."},
                {"key": "confidence", "type": "number", "description": "Optional 0..1 confidence."},
                {"key": "supporting_quote", "type": "string", "description": "Optional verbatim quote."},
                {"key": "attributes", "type": "object", "description": "Optional free-form metadata."},
            ],
        },
    }


def _augment_output_schema(output_schema: list[dict]) -> list[dict]:
    """Return an augmented copy with the runtime-only `signals` field appended.

    Original `output_schema` is the evaluator's stored rubric and is consumed
    by `primary_score()` / visible breakdown — it MUST NOT be mutated.
    """
    return list(output_schema or []) + [_build_signals_field_definition()]


def _normalize_signal_entry(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None
    signal_type = (raw.get("signal_type") or "").strip()
    if not signal_type:
        return None
    return {
        "signal_type": signal_type,
        "signal_value": raw.get("signal_value") or None,
        "signal_value_numeric": raw.get("signal_value_numeric"),
        "signal_at": raw.get("signal_at") or None,
        "confidence": raw.get("confidence"),
        "supporting_quote": raw.get("supporting_quote") or None,
        "attributes": raw.get("attributes") or {},
    }


def merge_signals(eval_outputs: list[EvaluatorOutput]) -> list[dict]:
    """Merge per-evaluator `output['signals']` into one canonical array.

    De-dup key: (signal_type, signal_value, signal_at, supporting_quote).
    First occurrence wins. This canonical merged array is what `populate-
    analytics` reads from `evaluation_run_thread_results.result.signals`.
    """
    merged: list[dict] = []
    seen: set[tuple] = set()
    for ev in eval_outputs or []:
        signals = (ev.output or {}).get("signals") or []
        if not isinstance(signals, list):
            continue
        for raw in signals:
            entry = _normalize_signal_entry(raw)
            if entry is None:
                continue
            key = (
                entry["signal_type"],
                entry["signal_value"],
                entry["signal_at"],
                entry["supporting_quote"],
            )
            if key in seen:
                continue
            seen.add(key)
            merged.append(entry)
    return merged


# ── Transcription prompt ─────────────────────────────────────────────


_LANG_INSTRUCTION = {
    "hi": "The call is in Hindi. Transcribe in Hindi.",
    "en": "The call is in English. Transcribe in English.",
    "hi-en": "The call is in Hindi-English (code-mixed). Transcribe in the original mix as spoken.",
    "auto": (
        "Detect the language(s) spoken and transcribe faithfully in the original "
        "language(s) — do not guess or default to any specific language."
    ),
}

_SYS_LANG = {
    "hi": "Hindi",
    "en": "English",
    "hi-en": "Hindi-English code-mixed",
    "auto": "multilingual (language auto-detected from audio)",
}


def _build_transcription_prompt(config: dict[str, Any]) -> tuple[str, str]:
    lang = config.get("language", "auto")
    diarize = config.get("speaker_diarization", config.get("speakerDiarization", True))
    preserve_cs = config.get(
        "preserve_code_switching", config.get("preserveCodeSwitching", True)
    )

    lang_instruction = _LANG_INSTRUCTION.get(
        lang, f"The call is in {lang}. Transcribe in {lang}."
    )
    sys_lang = _SYS_LANG.get(lang, lang)

    parts = ["Transcribe this sales call recording.", lang_instruction]
    if diarize:
        parts.append(
            "Identify two speakers: the sales agent and the customer/lead. "
            "Use the format [Agent]: ... and [Lead]: ... for each turn."
        )
    parts.append(
        "Include all dialogue, including small talk and greetings. "
        "Do not translate — preserve the original language exactly."
    )
    if preserve_cs:
        parts.append("Preserve code-switching between languages exactly as spoken.")

    sys_prompt = (
        f"You are an expert multilingual transcriptionist specializing in "
        f"sales calls. Language: {sys_lang}. Transcribe accurately"
        f"{', with speaker diarization (mark [Agent] and [Lead] turns)' if diarize else ''}. "
        f"Never translate — output the spoken language verbatim."
    )
    return " ".join(parts), sys_prompt


def _mime_for_url(url: str) -> str:
    return "audio/wav" if url.lower().endswith(".wav") else "audio/mpeg"


# ── Worker entry point ───────────────────────────────────────────────


async def audio_transcribe_evaluate(ctx: WorkerContext) -> WorkerOutput:
    """Transcribe the call's recording, run each evaluator, return a WorkerOutput."""
    record = ctx.record
    if not record.recording_url:
        raise RecordingMissingError(
            f"Call {record.activity_id} has no recording_url"
        )

    transcription_prompt, transcription_sys = _build_transcription_prompt(
        ctx.transcription_config
    )

    # ── Step 1: Download + Transcribe ────────────────────────────
    async with httpx.AsyncClient(timeout=60) as http:
        audio_resp = await http.get(record.recording_url)
        audio_resp.raise_for_status()
        audio_bytes = audio_resp.content

    set_usage_call_purpose(ctx.llm, "transcription", stage_index=0)
    transcript = await ctx.llm.generate_with_audio(
        prompt=transcription_prompt,
        audio_bytes=audio_bytes,
        mime_type=_mime_for_url(record.recording_url),
        system_prompt=transcription_sys,
    )
    if not transcript or not transcript.strip():
        transcript = "[Transcription returned empty result]"

    # ── Step 2: Evaluate against each rubric ─────────────────────
    eval_outputs: list[EvaluatorOutput] = []
    for evaluator in ctx.evaluators:
        prompt = evaluator.prompt.replace("{{transcript}}", transcript)
        augmented = _augment_output_schema(evaluator.output_schema)
        json_schema = generate_json_schema(augmented)

        set_usage_call_purpose(ctx.llm, "evaluation", stage_index=1)
        raw_result = await ctx.llm.generate_json(
            prompt=prompt,
            json_schema=json_schema,
        )
        parsed = (
            _safe_parse_json(raw_result)[0]
            if isinstance(raw_result, str)
            else raw_result
        )
        if not parsed:
            parsed = {"error": "Failed to parse LLM response"}

        eval_outputs.append(
            EvaluatorOutput(
                evaluator_id=str(evaluator.id),
                evaluator_name=evaluator.name,
                output=parsed,
                score=primary_score(parsed, evaluator.output_schema),
            )
        )

    return WorkerOutput(
        transcript=transcript,
        evaluator_outputs=eval_outputs,
        signals=merge_signals(eval_outputs),
    )


__all__ = [
    "RecordingMissingError",
    "audio_transcribe_evaluate",
    "merge_signals",
]
