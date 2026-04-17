"""Extractor for eval_type='call_quality' runs."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING
from uuid import UUID

from app.services.analytics.types import (
    EvalFactRow,
    FactSet,
    RunFactRow,
)
from app.services.analytics.extractors.semantic_fields import (
    extract_call_quality_semantics,
    extract_run_semantics,
)

if TYPE_CHECKING:
    from app.models import EvalRun, ThreadEvaluation

logger = logging.getLogger(__name__)


def extract_call_quality(run: EvalRun, threads: list[ThreadEvaluation]) -> FactSet:
    """Extract analytics facts from a call_quality run."""
    eval_facts: list[EvalFactRow] = []
    score_totals: list[float] = []

    for thread in threads:
        item_id = str(thread.thread_id)
        result: dict = thread.result or {}
        created_at = thread.created_at

        if not result:
            continue

        semantic_fields = extract_call_quality_semantics(result)
        # Build context from call_metadata
        call_meta = result.get("call_metadata", {}) or {}
        context: dict = {}
        if semantic_fields.agent:
            context["agent"] = semantic_fields.agent
        if semantic_fields.direction:
            context["direction"] = semantic_fields.direction
        if semantic_fields.duration_seconds is not None:
            context["duration"] = semantic_fields.duration_seconds

        # One EvalFactRow per evaluator in evaluations[]
        try:
            for ev in result.get("evaluations", []):
                output = ev.get("output", {}) or {}
                overall_score = output.get("overall_score")
                if overall_score is not None:
                    try:
                        score_totals.append(float(overall_score))
                    except (TypeError, ValueError):
                        pass

                evaluator_id: UUID | None = None
                try:
                    evaluator_id = UUID(ev["evaluator_id"])
                except (KeyError, ValueError, AttributeError):
                    pass

                eval_facts.append(EvalFactRow(
                    run_id=run.id,
                    app_id=run.app_id,
                    tenant_id=run.tenant_id,
                    eval_type=run.eval_type,
                    item_id=item_id,
                    item_type="recording",
                    evaluator_type="call_rubric",
                    evaluator_name=ev.get("evaluator_name", "Unknown"),
                    evaluator_id=evaluator_id,
                    result_status=None,
                    result_score=float(overall_score) if overall_score is not None else None,
                    result_verdict=None,
                    success=None,
                    agent=semantic_fields.agent,
                    direction=semantic_fields.direction,
                    duration_seconds=semantic_fields.duration_seconds,
                    result_detail=output,
                    context=context,
                    created_at=created_at,
                ))
        except Exception:
            logger.warning("Malformed evaluations for thread %s", item_id, exc_info=True)

    # --- Run fact ---
    thread_count = len(threads)
    avg_score = (
        sum(score_totals) / len(score_totals)
        if score_totals
        else None
    )
    run_semantics = extract_run_semantics(batch_metadata=run.batch_metadata, avg_score=avg_score)
    run_context: dict = {}
    if run_semantics.avg_score is not None:
        run_context["avg_score"] = run_semantics.avg_score

    run_fact = RunFactRow(
        run_id=run.id,
        app_id=run.app_id,
        tenant_id=run.tenant_id,
        user_id=run.user_id,
        eval_type=run.eval_type,
        status=run.status,
        created_at=run.created_at,
        completed_at=run.completed_at,
        duration_ms=run.duration_ms,
        thread_count=thread_count,
        pass_count=0,
        fail_count=0,
        error_count=0,
        pass_rate=None,
        avg_intent_accuracy=None,
        adversarial_total=None,
        adversarial_blocked=None,
        adversarial_block_rate=None,
        run_name=run_semantics.run_name,
        avg_score=run_semantics.avg_score,
        context=run_context,
    )

    return FactSet(
        run_fact=run_fact,
        eval_facts=eval_facts,
        criterion_facts=[],
    )
