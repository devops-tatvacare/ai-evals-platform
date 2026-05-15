"""SignalExtractor — populate ``analytics.fact_lead_signal`` from eval-run signals.

Roadmap 01 §8.4 contract:

  LLM structured output → ``platform.evaluation_run_thread_results.result.signals``
                       → ``populate-analytics`` → ``analytics.fact_lead_signal``

The extractor reads ONLY the canonical merged top-level
``result.signals`` array (produced by
``workers.audio_transcribe_evaluate.merge_signals``). Nested per-evaluator
copies in ``result.evaluations[*].output.signals`` are intentionally
ignored; the worker is responsible for merging + de-duping them into
the canonical array before the runner shell persists.

Pure function over already-loaded thread results — no LLM I/O. Re-running
``populate-analytics`` is therefore deterministic.

Lead linkage comes from ``result.call_metadata.lead_id``;
``source_activity_id`` comes from the thread's ``thread_id`` (which is
the LSQ ``ProspectActivityId`` for inside-sales call evaluations).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable
from uuid import UUID

from app.models.analytics_lead_facts import FactLeadSignal
from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult
from app.services.analytics.signal_taxonomy import coerce_signal_type


def _coerce_decimal(raw: Any) -> Decimal | None:
    """Best-effort numeric coercion. Drops strings that don't parse."""
    if raw is None or raw == "":
        return None
    try:
        if isinstance(raw, bool):
            return None
        return Decimal(str(raw))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _coerce_signal_at(raw: Any) -> datetime | None:
    """Parse ISO-8601 timestamps; tolerate ``Z`` and naive variants."""
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    text = str(raw).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def build_signal_rows(
    run: EvaluationRun, threads: Iterable[EvaluationRunThreadResult]
) -> list[dict[str, Any]]:
    """Project per-thread ``result.signals`` arrays into fact-row dicts.

    ``ordinal`` is the array index, preserving runner-side ordering so
    the ``UNIQUE (..., signal_type, ordinal)`` constraint is satisfied
    even when one thread emits multiple rows of the same ``signal_type``.

    Returns row dicts ready for ``FactLeadSignal(**row)``.
    """
    # Phase 11B — every framework signal row carries ``detected_at`` (the
    # framework dedup key). For eval-run signals it is the run's
    # completion moment: stable per run, so re-running ``populate-analytics``
    # produces the same key. ``signal_at`` (per-signal source moment)
    # stays distinct.
    detected_at = _coerce_signal_at(
        getattr(run, "completed_at", None) or getattr(run, "created_at", None)
    ) or datetime.now(timezone.utc)

    rows: list[dict[str, Any]] = []
    for thread in threads or []:
        result: dict[str, Any] = thread.result or {}
        signals = result.get("signals") or []
        if not isinstance(signals, list) or not signals:
            continue
        call_metadata = result.get("call_metadata") or {}
        lead_id_raw = call_metadata.get("lead_id") or ""
        lead_id = lead_id_raw.strip() or None
        # The thread_id IS the LSQ ProspectActivityId for inside-sales
        # call evaluations (set by the runner from ``call.activityId``).
        source_activity_id = (str(thread.thread_id) or "").strip() or None
        for ordinal, raw in enumerate(signals):
            if not isinstance(raw, dict):
                continue
            raw_type = (raw.get("signal_type") or "").strip()
            if not raw_type:
                continue
            attributes = raw.get("attributes") or {}
            if not isinstance(attributes, dict):
                attributes = {"raw_attributes": attributes}
            signal_type, attributes = coerce_signal_type(
                raw_type, attributes=attributes
            )
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "tenant_id": run.tenant_id,
                    "app_id": run.app_id,
                    "eval_run_id": run.id,
                    "thread_evaluation_id": thread.id,
                    "lead_id": lead_id,
                    "source_activity_id": source_activity_id,
                    "detected_at": detected_at,
                    "signal_type": signal_type,
                    "signal_value": (raw.get("signal_value") or None),
                    "signal_value_numeric": _coerce_decimal(
                        raw.get("signal_value_numeric")
                    ),
                    "signal_at": _coerce_signal_at(raw.get("signal_at")),
                    "confidence": _coerce_decimal(raw.get("confidence")),
                    "supporting_quote": (
                        raw.get("supporting_quote") or None
                    ),
                    "ordinal": ordinal,
                    "attributes": attributes,
                }
            )
    return rows


__all__ = ["build_signal_rows"]


# Re-export for tests / typing.
_FactLeadSignal = FactLeadSignal
_UUID = UUID
