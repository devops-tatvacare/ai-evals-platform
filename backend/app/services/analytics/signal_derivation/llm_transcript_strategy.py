"""Signal derivation framework — the ``llm_transcript`` strategy plugin.

Phase 11B of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

Projects the canonical merged ``result.signals`` array — produced by the
eval runner and persisted on ``evaluation_run_thread_results`` — into
``DerivedSignal`` objects. The LLM already ran inside the eval runner;
this strategy is a pure projection, no provider I/O.

Invoked **per-eval-run** by ``fact_populator`` when an eval completes
(``ctx.eval_run`` is the ``EvaluationRun``; ``source_rows`` are its
``EvaluationRunThreadResult`` children) — not by the scheduled pass,
because eval-run signals must appear with the eval, not a day later.

The projection itself stays in ``signal_extractor.build_signal_rows`` (its
unit tests live there); this strategy is the thin registry adapter.
"""
from __future__ import annotations

from typing import Any, Mapping, Sequence

from app.services.analytics.signal_derivation.base import (
    DerivedSignal,
    SignalStrategy,
    SignalStrategyError,
    StrategyContext,
)
from app.services.analytics.signal_extractor import build_signal_rows


class LlmTranscriptStrategy(SignalStrategy):
    """Pure projection of eval-run ``result.signals`` into the framework."""

    key = "llm_transcript"

    def validate(self, definition: Mapping[str, Any]) -> None:
        # The projection logic is fixed; the definition body carries no
        # tunable config today. Reject a non-mapping so a malformed seed
        # fails loud rather than silently.
        if not isinstance(definition, Mapping):
            raise SignalStrategyError(
                "llm_transcript definition body must be an object"
            )

    def attribute_schemas(
        self, definition: Mapping[str, Any]
    ) -> dict[str, dict[str, Any]]:
        # Eval-run signals carry their payload structurally
        # (signal_value / signal_value_numeric / confidence /
        # supporting_quote), not in the JSONB attributes bag. Declares no
        # per-signal_type keys — the manifest's ``_default`` covers them.
        return {}

    async def derive(
        self,
        *,
        definition: Mapping[str, Any],
        source_rows: Sequence[Any],
        ctx: StrategyContext,
    ) -> list[DerivedSignal]:
        if ctx.eval_run is None:
            raise SignalStrategyError(
                "llm_transcript.derive requires ctx.eval_run"
            )
        # source_rows are EvaluationRunThreadResult objects; build_signal_rows
        # owns the projection + signal_type coercion + timestamp parsing.
        fact_dicts = build_signal_rows(ctx.eval_run, source_rows)
        return [
            DerivedSignal(
                lead_id=row["lead_id"],
                signal_type=row["signal_type"],
                detected_at=row["detected_at"],
                signal_value=row.get("signal_value"),
                signal_value_numeric=row.get("signal_value_numeric"),
                signal_at=row.get("signal_at"),
                confidence=row.get("confidence"),
                supporting_quote=row.get("supporting_quote"),
                ordinal=row.get("ordinal", 0),
                attributes=row.get("attributes") or {},
                source_activity_id=row.get("source_activity_id"),
                eval_run_id=row.get("eval_run_id"),
                thread_evaluation_id=row.get("thread_evaluation_id"),
            )
            for row in fact_dicts
            # A signal with no lead_id can't be keyed into fact_lead_signal.
            if row.get("lead_id")
        ]
