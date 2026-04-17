"""Extractor for eval_type='full_evaluation' (voice-rx) runs."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.services.analytics.types import (
    EvalFactRow,
    FactSet,
    RunFactRow,
)
from app.services.analytics.extractors.semantic_fields import (
    extract_empty_semantics,
    extract_run_semantics,
)

if TYPE_CHECKING:
    from app.models import EvalRun

logger = logging.getLogger(__name__)


def extract_full_eval(run: EvalRun, _children: list) -> FactSet:
    """Extract analytics facts from a full_evaluation run."""
    eval_facts: list[EvalFactRow] = []
    result: dict = run.result or {}
    semantic_fields = extract_empty_semantics()

    is_completed = run.status == "completed"
    is_cancelled = run.status == "cancelled"
    success = True if is_completed else (None if is_cancelled else False)
    fail_count = 0 if is_completed or is_cancelled else 1
    pass_rate = 100.0 if is_completed else (None if is_cancelled else 0.0)

    eval_facts.append(EvalFactRow(
        run_id=run.id,
        app_id=run.app_id,
        tenant_id=run.tenant_id,
        eval_type=run.eval_type,
        item_id=str(run.listing_id or run.id),
        item_type="listing",
        evaluator_type="critique",
        evaluator_name="Voice Rx Critique",
        evaluator_id=None,
        result_status=result.get("status") or run.status,
        result_score=None,
        result_verdict=None,
        success=success,
        agent=semantic_fields.agent,
        direction=semantic_fields.direction,
        duration_seconds=semantic_fields.duration_seconds,
        intent=semantic_fields.intent,
        route=semantic_fields.route,
        query_type=semantic_fields.query_type,
        difficulty=semantic_fields.difficulty,
        total_turns=semantic_fields.total_turns,
        result_detail=result.get("critique", {}) or {},
        created_at=run.created_at,
    ))

    run_semantics = extract_run_semantics(batch_metadata=run.batch_metadata)
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
        thread_count=1,
        pass_count=1 if is_completed else 0,
        fail_count=fail_count,
        error_count=0,
        pass_rate=pass_rate,
        avg_intent_accuracy=None,
        adversarial_total=None,
        adversarial_blocked=None,
        adversarial_block_rate=None,
        run_name=run_semantics.run_name,
        context={},
    )

    return FactSet(
        run_fact=run_fact,
        eval_facts=eval_facts,
        criterion_facts=[],
    )
