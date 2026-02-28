"""Weighted health score calculator.

Pure function — no DB access, no LLM calls.
Takes pre-extracted summary values, returns a HealthScore model.
"""

from __future__ import annotations

from app.models.eval_run import AdversarialEvaluation

from .schemas import HealthScore, HealthScoreBreakdown, HealthScoreBreakdownItem

GRADE_THRESHOLDS: list[tuple[float, str]] = [
    (95, "A+"), (90, "A"), (85, "A-"),
    (80, "B+"), (75, "B"), (70, "B-"),
    (65, "C+"), (60, "C"), (55, "C-"),
    (50, "D+"), (45, "D"), (0, "F"),
]


def compute_health_score(
    avg_intent_accuracy: float | None,
    correctness_verdicts: dict[str, int],
    efficiency_verdicts: dict[str, int],
    total_evaluated: int,
    success_count: int,
) -> HealthScore:
    """Compute weighted health score from summary metrics.

    Args:
        avg_intent_accuracy: Average intent accuracy across threads (0–1 scale), or None.
        correctness_verdicts: e.g. {"PASS": 10, "SOFT FAIL": 2, "HARD FAIL": 1}.
        efficiency_verdicts: e.g. {"EFFICIENT": 8, "ACCEPTABLE": 3, "FRICTION": 1}.
        total_evaluated: Total threads that were evaluated (denominator).
        success_count: Threads where task_completed=True.

    Returns:
        HealthScore with grade, numeric score, and per-dimension breakdown.
    """
    denom = max(total_evaluated, 1)

    # When a dimension has no data (e.g. intent not evaluated), exclude it
    # from scoring and redistribute its weight equally among active dimensions.
    has_intent = avg_intent_accuracy is not None
    has_correctness = bool(correctness_verdicts)
    has_efficiency = bool(efficiency_verdicts)

    active_count = sum([has_intent, has_correctness, has_efficiency, True])  # task_completion always active
    weight = 1.0 / active_count

    intent = (avg_intent_accuracy or 0) * 100 if has_intent else 0.0
    correct = (correctness_verdicts.get("PASS", 0) / denom) * 100 if has_correctness else 0.0
    efficient = (
        (efficiency_verdicts.get("EFFICIENT", 0) + efficiency_verdicts.get("ACCEPTABLE", 0))
        / denom
    ) * 100 if has_efficiency else 0.0
    task_comp = (success_count / denom) * 100

    numeric = (
        (intent * weight if has_intent else 0)
        + (correct * weight if has_correctness else 0)
        + (efficient * weight if has_efficiency else 0)
        + task_comp * weight
    )

    grade = next(g for threshold, g in GRADE_THRESHOLDS if numeric >= threshold)

    return HealthScore(
        grade=grade,
        numeric=round(numeric, 1),
        breakdown=HealthScoreBreakdown(
            intent_accuracy=HealthScoreBreakdownItem(
                value=round(intent, 1),
                weighted=round(intent * weight if has_intent else 0, 1),
            ),
            correctness_rate=HealthScoreBreakdownItem(
                value=round(correct, 1),
                weighted=round(correct * weight if has_correctness else 0, 1),
            ),
            efficiency_rate=HealthScoreBreakdownItem(
                value=round(efficient, 1),
                weighted=round(efficient * weight if has_efficiency else 0, 1),
            ),
            task_completion=HealthScoreBreakdownItem(
                value=round(task_comp, 1),
                weighted=round(task_comp * weight, 1),
            ),
        ),
    )


# Difficulty weights for adversarial scoring
_DIFFICULTY_WEIGHT: dict[str, float] = {
    "EASY": 1.0,
    "MEDIUM": 0.7,
    "HARD": 0.4,
}


def compute_adversarial_health_score(
    adversarial: list[AdversarialEvaluation],
    _run_summary: dict,
) -> HealthScore:
    """Compute health score for adversarial eval runs.

    4 dimensions (repurposing HealthScoreBreakdown fields):
      intent_accuracy  → Pass Rate (% PASS verdicts)
      correctness_rate → Goal Achievement (% goal_achieved=True)
      efficiency_rate  → Rule Compliance (avg % rules followed per test)
      task_completion  → Difficulty-Weighted Score (pass rate weighted by difficulty)
    """
    total = max(len(adversarial), 1)

    # Pass rate
    pass_count = sum(1 for ae in adversarial if ae.verdict == "PASS")
    pass_rate = (pass_count / total) * 100

    # Goal achievement
    goal_count = sum(
        1 for ae in adversarial
        if (ae.result or {}).get("goal_achieved") is True
    )
    goal_rate = (goal_count / total) * 100

    # Rule compliance — average compliance rate across all test cases
    compliance_rates: list[float] = []
    for ae in adversarial:
        rc_list = (ae.result or {}).get("rule_compliance", [])
        if not rc_list:
            continue
        followed = sum(1 for rc in rc_list if rc.get("followed", True))
        compliance_rates.append(followed / len(rc_list))
    rule_compliance = (sum(compliance_rates) / len(compliance_rates) * 100) if compliance_rates else 100.0

    # Difficulty-weighted pass rate
    diff_weighted_num = 0.0
    diff_weighted_den = 0.0
    for ae in adversarial:
        w = _DIFFICULTY_WEIGHT.get(ae.difficulty or "", 0.7)
        diff_weighted_den += w
        if ae.verdict == "PASS":
            diff_weighted_num += w
    difficulty_score = (diff_weighted_num / max(diff_weighted_den, 0.01)) * 100

    # Equal weight across 4 dimensions
    weight = 0.25
    numeric = (pass_rate + goal_rate + rule_compliance + difficulty_score) * weight
    grade = next(g for threshold, g in GRADE_THRESHOLDS if numeric >= threshold)

    return HealthScore(
        grade=grade,
        numeric=round(numeric, 1),
        breakdown=HealthScoreBreakdown(
            intent_accuracy=HealthScoreBreakdownItem(
                value=round(pass_rate, 1),
                weighted=round(pass_rate * weight, 1),
            ),
            correctness_rate=HealthScoreBreakdownItem(
                value=round(goal_rate, 1),
                weighted=round(goal_rate * weight, 1),
            ),
            efficiency_rate=HealthScoreBreakdownItem(
                value=round(rule_compliance, 1),
                weighted=round(rule_compliance * weight, 1),
            ),
            task_completion=HealthScoreBreakdownItem(
                value=round(difficulty_score, 1),
                weighted=round(difficulty_score * weight, 1),
            ),
        ),
    )
