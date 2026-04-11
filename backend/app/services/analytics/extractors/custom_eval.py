"""Extractor for eval_type='custom' runs."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.services.analytics.types import (
    EvalFactRow,
    FactSet,
    RunFactRow,
)

if TYPE_CHECKING:
    from app.models import EvalRun

logger = logging.getLogger(__name__)


def extract_custom(run: EvalRun, _children: list) -> FactSet:
    """Extract analytics facts from a custom eval run."""
    eval_facts: list[EvalFactRow] = []
    result: dict = run.result or {}

    is_completed = run.status == "completed"

    eval_facts.append(EvalFactRow(
        run_id=run.id,
        app_id=run.app_id,
        tenant_id=run.tenant_id,
        eval_type=run.eval_type,
        item_id=str(run.listing_id or run.session_id or run.id),
        item_type="listing",
        evaluator_type="custom",
        evaluator_name=str(run.evaluator_id or "custom"),
        evaluator_id=run.evaluator_id,
        result_status=None,
        result_score=None,
        result_verdict=None,
        success=is_completed,
        result_detail=result.get("output", {}) if result else {},
        created_at=run.created_at,
    ))

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
        fail_count=0 if is_completed else 1,
        error_count=0,
        pass_rate=100.0 if is_completed else 0.0,
        avg_intent_accuracy=None,
        adversarial_total=None,
        adversarial_blocked=None,
        adversarial_block_rate=None,
        context={},
    )

    return FactSet(
        run_fact=run_fact,
        eval_facts=eval_facts,
        criterion_facts=[],
    )
