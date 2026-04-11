"""Extractor for eval_type='batch_thread' runs."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING
from uuid import UUID

from app.services.analytics.types import (
    CriterionFactRow,
    EvalFactRow,
    FactSet,
    RunFactRow,
)

if TYPE_CHECKING:
    from app.models import EvalRun, ThreadEvaluation

logger = logging.getLogger(__name__)

_EVIDENCE_MAX = 500
_INTENT_PASS_THRESHOLD = 0.8
_EFFICIENT_VERDICTS = frozenset({"EFFICIENT", "ACCEPTABLE"})


def extract_batch_thread(run: EvalRun, threads: list[ThreadEvaluation]) -> FactSet:
    """Extract analytics facts from a batch_thread run."""
    eval_facts: list[EvalFactRow] = []
    criterion_facts: list[CriterionFactRow] = []

    pass_count = 0
    fail_count = 0
    error_count = 0
    intent_scores: list[float] = []

    for thread in threads:
        item_id = str(thread.thread_id)
        result: dict = thread.result or {}
        created_at = thread.created_at

        # Detect empty / broken results
        if not result:
            error_count += 1
            continue

        # --- Intent ---
        if thread.intent_accuracy is not None:
            intent_scores.append(thread.intent_accuracy)
            eval_facts.append(EvalFactRow(
                run_id=run.id,
                app_id=run.app_id,
                tenant_id=run.tenant_id,
                eval_type=run.eval_type,
                item_id=item_id,
                item_type="thread",
                evaluator_type="intent",
                evaluator_name="Intent Accuracy",
                evaluator_id=None,
                result_status=None,
                result_score=thread.intent_accuracy,
                result_verdict=None,
                success=thread.intent_accuracy >= _INTENT_PASS_THRESHOLD,
                created_at=created_at,
            ))

        # --- Correctness ---
        if thread.worst_correctness is not None:
            is_pass = thread.worst_correctness == "PASS"
            if is_pass:
                pass_count += 1
            else:
                fail_count += 1

            eval_facts.append(EvalFactRow(
                run_id=run.id,
                app_id=run.app_id,
                tenant_id=run.tenant_id,
                eval_type=run.eval_type,
                item_id=item_id,
                item_type="thread",
                evaluator_type="correctness",
                evaluator_name="Correctness",
                evaluator_id=None,
                result_status=thread.worst_correctness,
                result_score=None,
                result_verdict=None,
                success=is_pass,
                created_at=created_at,
            ))

            # Criterion rows from correctness evaluations
            try:
                for corr_eval in result.get("correctness_evaluations", []):
                    for rule in corr_eval.get("rule_compliance", []):
                        criterion_facts.append(CriterionFactRow(
                            run_id=run.id,
                            app_id=run.app_id,
                            tenant_id=run.tenant_id,
                            item_id=item_id,
                            criterion_source="rule_catalog",
                            criterion_id=rule.get("rule_id", ""),
                            criterion_label=rule.get("section"),
                            evaluator_type="correctness",
                            status=rule.get("status", "UNKNOWN"),
                            passed=rule.get("followed") is True,
                            evidence=(rule.get("evidence", "") or "")[:_EVIDENCE_MAX],
                            created_at=created_at,
                        ))
            except Exception:
                logger.warning("Malformed correctness_evaluations for thread %s", item_id, exc_info=True)

        # --- Efficiency ---
        if thread.efficiency_verdict is not None:
            eval_facts.append(EvalFactRow(
                run_id=run.id,
                app_id=run.app_id,
                tenant_id=run.tenant_id,
                eval_type=run.eval_type,
                item_id=item_id,
                item_type="thread",
                evaluator_type="efficiency",
                evaluator_name="Efficiency",
                evaluator_id=None,
                result_status=thread.efficiency_verdict,
                result_score=None,
                result_verdict=None,
                success=thread.efficiency_verdict in _EFFICIENT_VERDICTS,
                created_at=created_at,
            ))

            # Criterion rows from efficiency evaluation
            try:
                eff_eval = result.get("efficiency_evaluation") or {}
                for rule in eff_eval.get("rule_compliance", []):
                    criterion_facts.append(CriterionFactRow(
                        run_id=run.id,
                        app_id=run.app_id,
                        tenant_id=run.tenant_id,
                        item_id=item_id,
                        criterion_source="rule_catalog",
                        criterion_id=rule.get("rule_id", ""),
                        criterion_label=rule.get("section"),
                        evaluator_type="efficiency",
                        status=rule.get("status", "UNKNOWN"),
                        passed=rule.get("followed") is True,
                        evidence=(rule.get("evidence", "") or "")[:_EVIDENCE_MAX],
                        created_at=created_at,
                    ))
            except Exception:
                logger.warning("Malformed efficiency_evaluation for thread %s", item_id, exc_info=True)

        # --- Custom evaluations ---
        try:
            for key, value in (result.get("custom_evaluations") or {}).items():
                evaluator_id: UUID | None = None
                try:
                    evaluator_id = UUID(key)
                except (ValueError, AttributeError):
                    pass

                eval_facts.append(EvalFactRow(
                    run_id=run.id,
                    app_id=run.app_id,
                    tenant_id=run.tenant_id,
                    eval_type=run.eval_type,
                    item_id=item_id,
                    item_type="thread",
                    evaluator_type="custom",
                    evaluator_name=key,
                    evaluator_id=evaluator_id,
                    result_status=None,
                    result_score=None,
                    result_verdict=None,
                    success=None,
                    result_detail=value.get("output", {}) if isinstance(value, dict) else {},
                    created_at=created_at,
                ))
        except Exception:
            logger.warning("Malformed custom_evaluations for thread %s", item_id, exc_info=True)

    # --- Run fact ---
    thread_count = len(threads)
    avg_intent = (
        sum(intent_scores) / len(intent_scores)
        if intent_scores
        else None
    )
    pass_rate = (
        pass_count / thread_count * 100
        if thread_count > 0
        else None
    )
    context: dict = {}
    if run.batch_metadata:
        context["run_name"] = run.batch_metadata.get("name")

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
        pass_count=pass_count,
        fail_count=fail_count,
        error_count=error_count,
        pass_rate=pass_rate,
        avg_intent_accuracy=avg_intent,
        adversarial_total=None,
        adversarial_blocked=None,
        adversarial_block_rate=None,
        context=context,
    )

    return FactSet(
        run_fact=run_fact,
        eval_facts=eval_facts,
        criterion_facts=criterion_facts,
    )
