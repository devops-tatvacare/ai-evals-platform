"""Reusable semantic field extraction for analytics fact rows."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RunSemanticFields:
    run_name: str | None = None
    avg_score: float | None = None


@dataclass(frozen=True)
class EvalSemanticFields:
    agent: str | None = None
    direction: str | None = None
    duration_seconds: float | None = None
    intent: str | None = None
    route: str | None = None
    query_type: str | None = None
    difficulty: str | None = None
    total_turns: int | None = None


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    text_value = str(value).strip()
    return text_value or None


def _coerce_float(value: Any) -> float | None:
    if value in (None, ''):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> int | None:
    if value in (None, ''):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _first_text(*values: Any) -> str | None:
    for value in values:
        cleaned = _clean_text(value)
        if cleaned is not None:
            return cleaned
    return None


def _first_dict(values: list[Any]) -> dict[str, Any]:
    for value in values:
        if isinstance(value, dict):
            return value
    return {}


def _first_list(values: list[Any]) -> list[Any]:
    for value in values:
        if isinstance(value, list):
            return value
    return []


def extract_run_semantics(*, batch_metadata: dict[str, Any] | None = None, avg_score: float | None = None) -> RunSemanticFields:
    metadata = batch_metadata if isinstance(batch_metadata, dict) else {}
    return RunSemanticFields(
        run_name=_clean_text(metadata.get('name')),
        avg_score=round(avg_score, 2) if avg_score is not None else None,
    )


def extract_batch_thread_semantics(result: dict[str, Any] | None) -> EvalSemanticFields:
    payload = result if isinstance(result, dict) else {}
    thread_payload = payload.get('thread') if isinstance(payload.get('thread'), dict) else {}
    messages = thread_payload.get('messages') if isinstance(thread_payload.get('messages'), list) else []
    first_message = _first_dict(messages)
    intent_evaluations = _first_list([
        payload.get('intent_evaluations'),
        payload.get('intentEvaluations'),
    ])
    primary_intent_eval = _first_dict(intent_evaluations)

    ground_truth_intent = _first_text(
        first_message.get('intent_detected'),
        first_message.get('intentDetected'),
    )
    predicted_intent = _first_text(
        primary_intent_eval.get('predicted_intent'),
        primary_intent_eval.get('predictedIntent'),
    )
    ground_truth_query_type = _first_text(
        first_message.get('intent_query_type'),
        first_message.get('intentQueryType'),
    )
    predicted_query_type = _first_text(
        primary_intent_eval.get('predicted_query_type'),
        primary_intent_eval.get('predictedQueryType'),
    )

    return EvalSemanticFields(
        duration_seconds=_coerce_float(
            thread_payload.get('duration_seconds') if isinstance(thread_payload, dict) else None
        ),
        intent=_first_text(ground_truth_intent, predicted_intent),
        route=_first_text(predicted_intent, ground_truth_intent),
        query_type=_first_text(ground_truth_query_type, predicted_query_type),
    )


def extract_call_quality_semantics(result: dict[str, Any] | None) -> EvalSemanticFields:
    payload = result if isinstance(result, dict) else {}
    call_meta = payload.get('call_metadata') if isinstance(payload.get('call_metadata'), dict) else {}
    return EvalSemanticFields(
        agent=_clean_text(call_meta.get('agent')),
        direction=_clean_text(call_meta.get('direction')),
        duration_seconds=_coerce_float(call_meta.get('duration')),
    )


def extract_adversarial_semantics(case: Any) -> EvalSemanticFields:
    result = case.result if isinstance(getattr(case, 'result', None), dict) else {}
    test_case = result.get('test_case') if isinstance(result.get('test_case'), dict) else {}
    transcript = result.get('transcript') if isinstance(result.get('transcript'), dict) else {}
    turns = transcript.get('turns') if isinstance(transcript.get('turns'), list) else []
    first_turn = _first_dict(turns)

    return EvalSemanticFields(
        intent=_first_text(
            first_turn.get('detected_intent'),
            first_turn.get('detectedIntent'),
        ),
        route=_first_text(
            first_turn.get('detected_intent'),
            first_turn.get('detectedIntent'),
        ),
        difficulty=_first_text(getattr(case, 'difficulty', None), test_case.get('difficulty')),
        total_turns=_coerce_int(getattr(case, 'total_turns', None) if getattr(case, 'total_turns', None) is not None else transcript.get('total_turns')),
    )


def extract_empty_semantics() -> EvalSemanticFields:
    return EvalSemanticFields()
