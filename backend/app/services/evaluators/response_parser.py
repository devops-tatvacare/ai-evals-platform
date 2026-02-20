"""Response parsing utilities for voice-rx evaluation results.

Ported from src/services/llm/evaluationService.ts — handles JSON repair,
transcript parsing, and critique parsing for the two-call evaluation pipeline.
"""
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def repair_truncated_json(text: str) -> str:
    """Try to repair truncated JSON by closing open brackets/braces."""
    repaired = text.strip()

    open_braces = 0
    open_brackets = 0
    in_string = False
    escape_next = False

    for char in repaired:
        if escape_next:
            escape_next = False
            continue
        if char == "\\":
            escape_next = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if not in_string:
            if char == "{":
                open_braces += 1
            elif char == "}":
                open_braces -= 1
            elif char == "[":
                open_brackets += 1
            elif char == "]":
                open_brackets -= 1

    if in_string:
        repaired += '"'

    while open_brackets > 0:
        repaired += "]"
        open_brackets -= 1

    while open_braces > 0:
        repaired += "}"
        open_braces -= 1

    return repaired


def extract_json(text: str) -> str:
    """Extract valid JSON object from text that may have extra content."""
    trimmed = text.strip()

    brace_count = 0
    start_index = -1
    end_index = -1
    in_string = False
    escape_next = False

    for i, char in enumerate(trimmed):
        if escape_next:
            escape_next = False
            continue
        if char == "\\" and in_string:
            escape_next = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if not in_string:
            if char == "{":
                if start_index == -1:
                    start_index = i
                brace_count += 1
            elif char == "}":
                brace_count -= 1
                if brace_count == 0 and start_index != -1:
                    end_index = i + 1
                    break

    if start_index != -1 and end_index != -1:
        return trimmed[start_index:end_index]

    return trimmed


def _safe_parse_json(text: str) -> tuple[dict, bool]:
    """Parse JSON with fallback to extraction and repair.

    Returns:
        Tuple of (parsed_dict, was_repaired).
        was_repaired is True if the JSON needed truncation repair.
    """
    # Try direct parse
    try:
        return json.loads(text.strip()), False
    except json.JSONDecodeError:
        pass

    # Try extracting JSON boundaries
    extracted = extract_json(text)
    try:
        return json.loads(extracted), False
    except json.JSONDecodeError:
        pass

    # Try repairing truncated JSON
    try:
        repaired = repair_truncated_json(extracted)
        result = json.loads(repaired)
        logger.warning("Repaired truncated JSON response")
        return result, True
    except json.JSONDecodeError as e:
        logger.error("Failed to parse JSON response: %s", text[:500])
        raise ValueError(f"Invalid JSON in response: {e}") from e


def _validate_severity(value) -> str:
    valid = ("none", "minor", "moderate", "critical")
    s = str(value).lower() if value is not None else "none"
    return s if s in valid else "none"


def _validate_likely_correct(value) -> str:
    valid = ("original", "judge", "both", "unclear")
    s = str(value).lower() if value is not None else "unclear"
    return s if s in valid else "unclear"


def _validate_confidence(value) -> Optional[str]:
    if not value:
        return None
    valid = ("high", "medium", "low")
    s = str(value).lower()
    return s if s in valid else None


# ── Transcript parsing ───────────────────────────────────────────


def parse_transcript_response(text: str) -> dict:
    """Parse LLM response into TranscriptData shape (camelCase keys for frontend compat).

    Returns dict matching the frontend TranscriptData type:
    {
        "formatVersion": "1.0",
        "generatedAt": "...",
        "metadata": {...},
        "speakerMapping": {},
        "segments": [...],
        "fullTranscript": "..."
    }
    """
    parsed, _repaired = _safe_parse_json(text)

    segments = []
    for idx, seg in enumerate(parsed.get("segments", [])):
        segments.append({
            "speaker": str(seg.get("speaker", "Unknown")),
            "text": str(seg.get("text", "")),
            "startTime": str(seg.get("startTime", seg.get("start_time", idx))),
            "endTime": str(seg.get("endTime", seg.get("end_time", idx + 1))),
            "startSeconds": seg.get("startTime") if isinstance(seg.get("startTime"), (int, float)) else None,
            "endSeconds": seg.get("endTime") if isinstance(seg.get("endTime"), (int, float)) else None,
        })

    full_transcript = "\n".join(f"[{s['speaker']}]: {s['text']}" for s in segments)
    now = datetime.now(timezone.utc).isoformat()

    return {
        "formatVersion": "1.0",
        "generatedAt": now,
        "metadata": {
            "recordingId": "ai-generated",
            "jobId": f"eval-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "processedAt": now,
        },
        "speakerMapping": {},
        "segments": segments,
        "fullTranscript": full_transcript,
    }


# ── Critique parsing ────────────────────────────────────────────


def parse_critique_response(
    text: str,
    original_segments: list[dict],
    llm_segments: list[dict],
    model: str,
    total_segments: int = 0,
) -> dict:
    """Parse LLM response into EvaluationCritique shape (camelCase keys).

    Args:
        total_segments: Known total segment count from source data. If provided,
            statistics are computed server-side using this as the denominator.

    Returns dict matching the frontend EvaluationCritique type:
    {
        "segments": [...],
        "overallAssessment": "...",
        "assessmentReferences": [...] | None,
        "statistics": {...} | None,
        "generatedAt": "...",
        "model": "..."
    }
    """
    parsed, _repaired = _safe_parse_json(text)

    segments = []
    for idx, seg in enumerate(parsed.get("segments", [])):
        seg_idx = seg.get("segmentIndex", idx) if isinstance(seg.get("segmentIndex"), int) else idx
        segments.append({
            "segmentIndex": seg_idx,
            "originalText": str(seg.get("originalText", "")),
            "judgeText": str(seg.get("judgeText", seg.get("llmText", ""))),
            "discrepancy": str(seg.get("discrepancy", seg.get("critique", ""))),
            "likelyCorrect": _validate_likely_correct(seg.get("likelyCorrect")),
            "confidence": _validate_confidence(seg.get("confidence")),
            "severity": _validate_severity(seg.get("severity")),
            "category": str(seg["category"]) if seg.get("category") else None,
        })

    # Back-fill originalText / judgeText from source segments when missing
    for s in segments:
        si = s["segmentIndex"]
        if not s["originalText"] and si < len(original_segments):
            s["originalText"] = original_segments[si].get("text", "")
        if not s["judgeText"] and si < len(llm_segments):
            s["judgeText"] = llm_segments[si].get("text", "")

    # Assessment references
    assessment_refs = None
    raw_refs = parsed.get("assessmentReferences", [])
    if raw_refs and isinstance(raw_refs, list):
        refs = []
        for ref in raw_refs:
            if isinstance(ref.get("segmentIndex"), int):
                refs.append({
                    "segmentIndex": int(ref["segmentIndex"]),
                    "timeWindow": str(ref.get("timeWindow", "")),
                    "issue": str(ref.get("issue", "")),
                    "severity": _validate_severity(ref.get("severity")),
                })
        if refs:
            assessment_refs = refs

    # Server-side statistics (always compute from known data)
    actual_total = total_segments or max(len(original_segments), len(llm_segments)) or len(segments)
    critique_indices = {s["segmentIndex"] for s in segments}
    match_count = actual_total - len(critique_indices)

    stats = {
        "totalSegments": actual_total,
        "criticalCount": sum(1 for s in segments if s["severity"] == "critical"),
        "moderateCount": sum(1 for s in segments if s["severity"] == "moderate"),
        "minorCount": sum(1 for s in segments if s["severity"] == "minor"),
        "matchCount": match_count,
        "originalCorrectCount": sum(1 for s in segments if s["likelyCorrect"] == "original"),
        "judgeCorrectCount": sum(1 for s in segments if s["likelyCorrect"] == "judge"),
        "unclearCount": sum(1 for s in segments if s["likelyCorrect"] == "unclear"),
    }

    return {
        "segments": segments,
        "overallAssessment": str(parsed.get("overallAssessment", "")),
        "assessmentReferences": assessment_refs,
        "statistics": stats,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": model,
    }


def parse_api_critique_response(text: str, model: str) -> dict:
    """Parse API-flow critique response.

    The LLM response shape depends on the evaluation schema provided.
    We store the full parsed output and also map well-known keys for
    backward compatibility with the frontend ApiEvaluationCritique type.
    """
    parsed, _repaired = _safe_parse_json(text)

    # Try well-known keys first; fall back to full parsed output
    overall = (
        parsed.get("overallAssessment")
        or parsed.get("summary")
        or parsed.get("overall_assessment")
        or ""
    )

    result = {
        "transcriptComparison": parsed.get("transcriptComparison"),
        "structuredComparison": parsed.get("structuredComparison"),
        "overallAssessment": str(overall),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": model,
        # Store full LLM output so the UI can render schema-driven responses
        "rawOutput": parsed,
    }

    return result
