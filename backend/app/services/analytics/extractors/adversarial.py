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
from app.services.analytics.extractors.semantic_fields import (
    extract_adversarial_semantics,
    extract_run_semantics,
)

if TYPE_CHECKING:
    from app.models import AdversarialEvaluation, EvalRun

logger = logging.getLogger(__name__)

_EVIDENCE_MAX = 500


_PERSONA_RULE_PREFIX = "persona."


def _split_criterion_source(rule_id: str) -> tuple[str, str]:
    """Return (criterion_source, persona_id_or_empty).

    Prod rules → ("adversarial_rule", ""). Persona expectation rules namespaced
    ``persona.<persona_id>.<rule_name>`` → ("persona.<persona_id>", persona_id).
    """
    rid = str(rule_id or "")
    if rid.startswith(_PERSONA_RULE_PREFIX):
        parts = rid.split(".", 2)
        if len(parts) >= 3:
            return (f"persona.{parts[1]}", parts[1])
    return ("adversarial_rule", "")


def extract_adversarial(run: EvalRun, cases: list[AdversarialEvaluation]) -> FactSet:
    """Extract analytics facts from a batch_adversarial run.

    Persona-aware: persona expectation rules (rule_ids starting
    ``persona.<persona_id>.``) flow into analytics_criterion_facts with
    ``criterion_source='persona.<persona_id>'`` so Sherlock and reports can
    filter them independently of prod rules. Per-case persona tactic
    aggregates (from result_data.persona_tactic_summary) are stored on
    analytics_eval_facts.context, and a run-level persona_posture rollup
    lands on analytics_run_facts.context.
    """
    eval_facts: list[EvalFactRow] = []
    criterion_facts: list[CriterionFactRow] = []

    blocked_count = 0
    breached_count = 0

    # Run-level persona-posture accumulators, keyed by persona_id.
    posture: dict[str, dict] = {}

    def _persona_slot(persona_id: str) -> dict:
        return posture.setdefault(
            persona_id,
            {
                "rules_total": 0,
                "rules_followed": 0,
                "rules_violated": 0,
                "tactics": {},
            },
        )

    for case in cases:
        item_id = str(case.id)
        result: dict = case.result or {}
        created_at = case.created_at
        semantic_fields = extract_adversarial_semantics(case)

        goal_achieved = case.goal_achieved if case.goal_achieved is not None else result.get("goal_achieved", False)
        is_blocked = not goal_achieved

        if is_blocked:
            blocked_count += 1
        else:
            breached_count += 1

        verdict = case.verdict or result.get("verdict")

        # Per-case persona tactic summary (from adversarial_runner.
        # _summarize_persona_tactics). Legacy cases without the summary
        # simply emit empty lists — downstream charts show no bars for them.
        tactic_summary = result.get("persona_tactic_summary") or {}
        tactics_attempted = list(tactic_summary.get("tactics_attempted", []) or [])
        tactics_landed = list(tactic_summary.get("tactics_landed", []) or [])
        turn_tactic_sequence = list(tactic_summary.get("turn_tactic_sequence", []) or [])

        active_persona_ids: list[str] = []
        active_traits = list(getattr(case, "active_traits", []) or [])
        difficulty_lc = (case.difficulty or "").strip().lower()
        # Heuristic: only adversarial personas currently emit expectation rules,
        # so derive active_persona_ids from criterion_source prefixes below. We
        # also include the case's difficulty label when it matches a known
        # persona (e.g. "moriarty").
        if difficulty_lc:
            active_persona_ids.append(difficulty_lc)

        eval_context: dict = {
            "difficulty": case.difficulty,
            "total_turns": case.total_turns,
            "persona_tactics_attempted": tactics_attempted,
            "persona_tactics_landed": tactics_landed,
            "persona_turn_tactic_sequence": turn_tactic_sequence,
            "active_persona_ids": active_persona_ids,
            "active_traits": active_traits,
        }

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
            intent=semantic_fields.intent,
            route=semantic_fields.route,
            difficulty=semantic_fields.difficulty,
            total_turns=semantic_fields.total_turns,
            context=eval_context,
            created_at=created_at,
        ))

        # Criterion rows — persona.<id>.* rules get their own criterion_source
        # so analytics can filter them without regex on the id.
        try:
            for rule in result.get("rule_compliance", []):
                rule_id = str(rule.get("rule_id", ""))
                status = rule.get("status", "UNKNOWN")
                source, persona_id = _split_criterion_source(rule_id)
                criterion_facts.append(CriterionFactRow(
                    run_id=run.id,
                    app_id=run.app_id,
                    tenant_id=run.tenant_id,
                    item_id=item_id,
                    criterion_source=source,
                    criterion_id=rule_id,
                    criterion_label=rule.get("section"),
                    evaluator_type="adversarial_judge",
                    status=status,
                    passed=rule.get("followed") is True,
                    evidence=(rule.get("evidence", "") or "")[:_EVIDENCE_MAX],
                    created_at=created_at,
                ))
                if persona_id:
                    slot = _persona_slot(persona_id)
                    slot["rules_total"] += 1
                    if status == "FOLLOWED":
                        slot["rules_followed"] += 1
                    elif status == "VIOLATED":
                        slot["rules_violated"] += 1
        except Exception:
            logger.warning("Malformed rule_compliance for case %s", item_id, exc_info=True)

        # Roll per-case tactic counts into the run-level posture.
        for persona_id in {difficulty_lc} if difficulty_lc else set():
            slot = _persona_slot(persona_id)
            for entry in turn_tactic_sequence:
                tactic_id = str(entry.get("persona_tactic") or "")
                if not tactic_id or tactic_id == "none":
                    continue
                tactic_slot = slot["tactics"].setdefault(
                    tactic_id, {"attempted": 0, "landed": 0}
                )
                tactic_slot["attempted"] += 1
                if tactic_id in tactics_landed:
                    tactic_slot["landed"] += 1

    # --- Run fact ---
    total = len(cases)
    block_rate = (blocked_count / total * 100) if total > 0 else None

    # Derive rules_held_rate per persona for cheap dashboard reads.
    for slot in posture.values():
        evaluated = slot["rules_followed"] + slot["rules_violated"]
        slot["rules_held_rate"] = (
            slot["rules_followed"] / evaluated if evaluated > 0 else None
        )

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
        thread_count=total,
        pass_count=blocked_count,
        fail_count=breached_count,
        error_count=0,
        pass_rate=block_rate,
        avg_intent_accuracy=None,
        adversarial_total=total,
        adversarial_blocked=blocked_count,
        adversarial_block_rate=block_rate,
        run_name=run_semantics.run_name,
        context={"persona_posture": posture} if posture else {},
    )

    return FactSet(
        run_fact=run_fact,
        eval_facts=eval_facts,
        criterion_facts=criterion_facts,
    )
