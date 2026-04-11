"""Extractor for eval_type='batch_adversarial' runs."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.services.analytics.types import (
    CriterionFactRow,
    EvalFactRow,
    FactSet,
    RunFactRow,
)

if TYPE_CHECKING:
    from app.models import AdversarialEvaluation, EvalRun

logger = logging.getLogger(__name__)

_EVIDENCE_MAX = 500


def extract_adversarial(run: EvalRun, cases: list[AdversarialEvaluation]) -> FactSet:
    """Extract analytics facts from a batch_adversarial run."""
    eval_facts: list[EvalFactRow] = []
    criterion_facts: list[CriterionFactRow] = []

    blocked_count = 0
    breached_count = 0

    for case in cases:
        item_id = str(case.id)
        result: dict = case.result or {}
        created_at = case.created_at

        goal_achieved = case.goal_achieved if case.goal_achieved is not None else result.get("goal_achieved", False)
        is_blocked = not goal_achieved

        if is_blocked:
            blocked_count += 1
        else:
            breached_count += 1

        verdict = case.verdict or result.get("verdict")

        eval_facts.append(EvalFactRow(
            run_id=run.id,
            app_id=run.app_id,
            tenant_id=run.tenant_id,
            eval_type=run.eval_type,
            item_id=item_id,
            item_type="adversarial_case",
            evaluator_type="adversarial_judge",
            evaluator_name="Adversarial Judge",
            evaluator_id=None,
            result_status=verdict,
            result_score=None,
            result_verdict=None,
            success=is_blocked,
            context={"difficulty": case.difficulty, "total_turns": case.total_turns},
            created_at=created_at,
        ))

        # Criterion rows from rule_compliance (top-level in result)
        try:
            for rule in result.get("rule_compliance", []):
                criterion_facts.append(CriterionFactRow(
                    run_id=run.id,
                    app_id=run.app_id,
                    tenant_id=run.tenant_id,
                    item_id=item_id,
                    criterion_source="adversarial_rule",
                    criterion_id=rule.get("rule_id", ""),
                    criterion_label=rule.get("section"),
                    evaluator_type="adversarial_judge",
                    status=rule.get("status", "UNKNOWN"),
                    passed=rule.get("followed") is True,
                    evidence=(rule.get("evidence", "") or "")[:_EVIDENCE_MAX],
                    created_at=created_at,
                ))
        except Exception:
            logger.warning("Malformed rule_compliance for case %s", item_id, exc_info=True)

    # --- Run fact ---
    total = len(cases)
    block_rate = (blocked_count / total * 100) if total > 0 else None

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
        thread_count=total,
        pass_count=blocked_count,
        fail_count=breached_count,
        error_count=0,
        pass_rate=block_rate,
        avg_intent_accuracy=None,
        adversarial_total=total,
        adversarial_blocked=blocked_count,
        adversarial_block_rate=block_rate,
        context={},
    )

    return FactSet(
        run_fact=run_fact,
        eval_facts=eval_facts,
        criterion_facts=criterion_facts,
    )
