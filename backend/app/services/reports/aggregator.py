"""Pure data aggregation — no DB access, no LLM calls.

Receives loaded ORM instances, returns structured analytics as Pydantic models.
All methods are sync (no async needed for computation).
"""

from __future__ import annotations

import re
from itertools import combinations

from app.models.eval_run import AdversarialEvaluation, ThreadEvaluation
from app.services.evaluators.adversarial_canonical import build_canonical_adversarial_case
from app.services.evaluators.thread_canonical import build_canonical_thread_evaluation

from .schemas import (
    AdversarialBreakdown,
    AdversarialGoalResult,
    AdversarialDifficultyResult,
    CoFailure,
    Exemplars,
    ExemplarThread,
    FrictionAnalysis,
    FrictionPattern,
    FrictionTurn,
    IntentHistogram,
    RuleComplianceEntry,
    RuleComplianceMatrix,
    RuleViolation,
    TranscriptMessage,
    VerdictDistributions,
)

# --- Ordinal maps for composite scoring ---

CORRECTNESS_ORDINAL: dict[str, float] = {
    "PASS": 1.0,
    "NOT APPLICABLE": 0.8,
    "NOT_APPLICABLE": 0.8,
    "SOFT FAIL": 0.5,
    "SOFT_FAIL": 0.5,
    "HARD FAIL": 0.2,
    "HARD_FAIL": 0.2,
    "CRITICAL": 0.0,
}

EFFICIENCY_ORDINAL: dict[str, float] = {
    "EFFICIENT": 1.0,
    "ACCEPTABLE": 0.8,
    "NOT APPLICABLE": 0.8,
    "NOT_APPLICABLE": 0.8,
    "INCOMPLETE": 0.6,
    "FRICTION": 0.3,
    "BROKEN": 0.0,
}

DIFFICULTY_ORDER = ["EASY", "MEDIUM", "HARD"]

MAX_TRANSCRIPT_CHARS = 500


def _canonical_adversarial_case(ae: AdversarialEvaluation) -> dict:
    return build_canonical_adversarial_case(
        getattr(ae, "result", {}) or {},
        row_verdict=getattr(ae, "verdict", None),
        row_goal_achieved=getattr(ae, "goal_achieved", None),
        row_goal_flow=getattr(ae, "goal_flow", []) or [],
        row_active_traits=getattr(ae, "active_traits", []) or [],
        row_total_turns=getattr(ae, "total_turns", 0),
    )


def _canonical_rule_compliance(case: dict) -> list[dict]:
    return [
        {
            "rule_id": outcome.get("ruleId", ""),
            "section": outcome.get("section", ""),
            "followed": True if outcome.get("status") == "FOLLOWED" else False if outcome.get("status") == "VIOLATED" else None,
            "status": outcome.get("status"),
            "evidence": outcome.get("evidence", ""),
        }
        for outcome in case.get("judge", {}).get("ruleOutcomes", [])
    ]


def _canonical_thread_evaluation(thread: ThreadEvaluation) -> dict:
    return build_canonical_thread_evaluation(
        getattr(thread, "result", {}) or {},
        row_intent_accuracy=getattr(thread, "intent_accuracy", None),
        row_worst_correctness=getattr(thread, "worst_correctness", None),
        row_efficiency_verdict=getattr(thread, "efficiency_verdict", None),
        row_success_status=getattr(thread, "success_status", None),
    )


def _canonical_thread_rule_outcomes(thread: ThreadEvaluation) -> list[dict]:
    canonical = _canonical_thread_evaluation(thread)
    return list(canonical.get("derived", {}).get("canonicalRuleOutcomes", []))


class ReportAggregator:
    """Stateless aggregator. Instantiate with raw data, call methods to get sections.

    Usage:
        agg = ReportAggregator(threads, adversarial, summary)
        distributions = agg.compute_distributions()
        compliance = agg.compute_rule_compliance()
        friction = agg.compute_friction_analysis()
        exemplars = agg.select_exemplars()
        adversarial = agg.compute_adversarial_breakdown()
    """

    def __init__(
        self,
        threads: list[ThreadEvaluation],
        adversarial: list[AdversarialEvaluation],
        run_summary: dict,
    ):
        self.threads = threads
        self.adversarial = adversarial
        self.summary = run_summary or {}

    # ------------------------------------------------------------------
    # Verdict Distributions
    # ------------------------------------------------------------------

    def compute_distributions(self) -> VerdictDistributions:
        correctness = self.summary.get("correctness_verdicts", {})
        efficiency = self.summary.get("efficiency_verdicts", {})

        return VerdictDistributions(
            correctness=correctness,
            efficiency=efficiency,
            adversarial=self._adversarial_verdict_dist(),
            intent_histogram=self._build_intent_histogram(),
            custom_evaluations={},
        )

    def _build_intent_histogram(self) -> IntentHistogram:
        buckets = ["0-20", "20-40", "40-60", "60-80", "80-100"]
        counts = [0, 0, 0, 0, 0]
        for t in self.threads:
            if t.intent_accuracy is None:
                continue
            pct = t.intent_accuracy * 100
            idx = min(int(pct // 20), 4)  # clamp 100% to last bucket
            counts[idx] += 1
        return IntentHistogram(buckets=buckets, counts=counts)

    def _adversarial_verdict_dist(self) -> dict[str, int] | None:
        if not self.adversarial:
            return None
        dist: dict[str, int] = {}
        for ae in self.adversarial:
            v = ae.verdict or "UNKNOWN"
            dist[v] = dist.get(v, 0) + 1
        return dist

    # ------------------------------------------------------------------
    # Rule Compliance Matrix
    # ------------------------------------------------------------------

    def compute_rule_compliance(self) -> RuleComplianceMatrix:
        rule_stats: dict[str, dict] = {}
        co_failure_tracker: dict[frozenset[str], int] = {}

        for thread in self.threads:
            thread_failures: set[str] = set()
            self._tally_rule_compliance(
                _canonical_thread_rule_outcomes(thread), rule_stats, thread_failures,
            )

            # Track co-failures
            if len(thread_failures) >= 2:
                for pair in combinations(sorted(thread_failures), 2):
                    key = frozenset(pair)
                    co_failure_tracker[key] = co_failure_tracker.get(key, 0) + 1

        # Build entries sorted by worst compliance first
        rules = []
        for rule_id, stats in rule_stats.items():
            total = stats["passed"] + stats["failed"]
            rate = stats["passed"] / total if total > 0 else 0
            rules.append(RuleComplianceEntry(
                rule_id=rule_id,
                section=stats["section"],
                passed=stats["passed"],
                failed=stats["failed"],
                rate=round(rate, 3),
                severity=_classify_severity(rate, stats["failed"]),
            ))
        rules.sort(key=lambda r: r.rate)

        # Build co-failure pairs (meaningful correlations only)
        co_failures = []
        for pair, count in co_failure_tracker.items():
            if count < 2:
                continue
            pair_list = sorted(pair)
            a_fails = rule_stats[pair_list[0]]["failed"]
            b_fails = rule_stats[pair_list[1]]["failed"]
            min_fails = min(a_fails, b_fails)
            co_rate = count / min_fails if min_fails > 0 else 0
            if co_rate >= 0.3:
                co_failures.append(CoFailure(
                    rule_a=pair_list[0],
                    rule_b=pair_list[1],
                    co_occurrence_rate=round(co_rate, 2),
                ))
        co_failures.sort(key=lambda c: c.co_occurrence_rate, reverse=True)

        return RuleComplianceMatrix(rules=rules, co_failures=co_failures[:5])

    @staticmethod
    def _tally_rule_compliance(
        rc_list: list[dict],
        rule_stats: dict[str, dict],
        thread_failures: set[str],
    ) -> None:
        for rc in rc_list:
            rule_id = rc.get("rule_id") or rc.get("ruleId") or ""
            if not rule_id:
                continue
            status = rc.get("status")
            if status not in ("FOLLOWED", "VIOLATED", "NOT_EVALUATED"):
                continue
            if rule_id not in rule_stats:
                rule_stats[rule_id] = {
                    "passed": 0,
                    "failed": 0,
                    "not_evaluated": 0,
                    "section": rc.get("section", ""),
                }
            if status == "FOLLOWED":
                rule_stats[rule_id]["passed"] += 1
            elif status == "VIOLATED":
                rule_stats[rule_id]["failed"] += 1
                thread_failures.add(rule_id)
            elif status == "NOT_EVALUATED":
                rule_stats[rule_id]["not_evaluated"] += 1

    # ------------------------------------------------------------------
    # Friction Analysis
    # ------------------------------------------------------------------

    def compute_friction_analysis(self) -> FrictionAnalysis:
        bot_turns = 0
        user_turns = 0
        recovery_dist: dict[str, int] = {}
        verdict_turn_lists: dict[str, list[int]] = {}
        pattern_tracker: dict[str, dict] = {}

        for thread in self.threads:
            result = thread.result or {}
            eff = result.get("efficiency_evaluation") or {}

            # Count friction turns by cause (normalize to lowercase —
            # efficiency_evaluator._parse_result uppercases to "BOT"/"USER")
            for ft in eff.get("friction_turns", []):
                cause = ft.get("cause", "bot").lower()
                if cause == "bot":
                    bot_turns += 1
                else:
                    user_turns += 1

                # Track friction patterns
                desc = ft.get("description", "").strip()
                if desc:
                    key = _normalize_pattern(desc)
                    if key not in pattern_tracker:
                        pattern_tracker[key] = {"count": 0, "threads": [], "description": desc}
                    pattern_tracker[key]["count"] += 1
                    if thread.thread_id not in pattern_tracker[key]["threads"]:
                        pattern_tracker[key]["threads"].append(thread.thread_id)

            # Recovery quality (canonical format uses spaces: "NOT NEEDED")
            rq = eff.get("recovery_quality", "NOT NEEDED")
            recovery_dist[rq] = recovery_dist.get(rq, 0) + 1

            # Avg turns by verdict — each ChatMessage is one full exchange (query + response)
            verdict = thread.efficiency_verdict or "UNKNOWN"
            messages = result.get("thread", {}).get("messages", [])
            turn_count = max(len(messages), 1)
            verdict_turn_lists.setdefault(verdict, []).append(turn_count)

        avg_turns = {
            v: round(sum(turns) / len(turns), 1)
            for v, turns in verdict_turn_lists.items()
            if turns
        }

        top_patterns = sorted(
            pattern_tracker.values(), key=lambda p: p["count"], reverse=True,
        )[:5]

        return FrictionAnalysis(
            total_friction_turns=bot_turns + user_turns,
            by_cause={"bot": bot_turns, "user": user_turns},
            recovery_quality=recovery_dist,
            avg_turns_by_verdict=avg_turns,
            top_patterns=[
                FrictionPattern(
                    description=p["description"],
                    count=p["count"],
                    example_thread_ids=p["threads"][:3],
                )
                for p in top_patterns
            ],
        )

    # ------------------------------------------------------------------
    # Exemplar Selection
    # ------------------------------------------------------------------

    def select_exemplars(
        self,
        k: int = 5,
        custom_scores: dict[str, float] | None = None,
    ) -> Exemplars:
        scored = [
            (self._compute_composite_score(t, custom_scores), t)
            for t in self.threads
        ]
        scored.sort(key=lambda x: x[0], reverse=True)

        best = [self._build_exemplar(score, t) for score, t in scored[:k]]
        worst = [self._build_exemplar(score, t) for score, t in scored[-k:]]
        worst.reverse()  # worst first

        return Exemplars(best=best, worst=worst)

    @staticmethod
    def _compute_composite_score(
        thread: ThreadEvaluation,
        custom_scores: dict[str, float] | None = None,
    ) -> float:
        intent = thread.intent_accuracy if thread.intent_accuracy is not None else 0.5
        correctness = CORRECTNESS_ORDINAL.get(thread.worst_correctness or "", 0.5)
        efficiency = EFFICIENCY_ORDINAL.get(thread.efficiency_verdict or "", 0.5)
        task = 1.0 if thread.success_status else 0.0

        # When custom eval scores are available, allocate 20% to custom dimension
        if custom_scores and thread.thread_id in custom_scores:
            custom = custom_scores[thread.thread_id]
            return (
                (intent * 0.20) + (correctness * 0.20)
                + (efficiency * 0.20) + (task * 0.20) + (custom * 0.20)
            )

        return (intent * 0.25) + (correctness * 0.25) + (efficiency * 0.25) + (task * 0.25)

    def _build_exemplar(self, score: float, thread: ThreadEvaluation) -> ExemplarThread:
        result = thread.result or {}
        canonical = _canonical_thread_evaluation(thread)

        # Extract transcript — ChatMessage objects have query_text / final_response_message
        messages = result.get("thread", {}).get("messages", [])
        transcript: list[TranscriptMessage] = []
        for m in messages:
            query = m.get("query_text", "")
            if query:
                transcript.append(TranscriptMessage(
                    role="user",
                    content=query[:MAX_TRANSCRIPT_CHARS],
                ))
            response = m.get("final_response_message", "")
            if response:
                transcript.append(TranscriptMessage(
                    role="assistant",
                    content=response[:MAX_TRANSCRIPT_CHARS],
                ))

        # Extract rule violations (failed rules across all evaluators)
        violations = self._extract_violations(result)

        # Extract friction turns
        eff = canonical.get("evaluators", {}).get("efficiency", {})
        friction_turns = [
            FrictionTurn(
                turn=ft.get("turn", 0),
                cause=ft.get("cause", "bot"),
                description=ft.get("description", ""),
            )
            for ft in eff.get("frictionTurns", [])
        ]

        return ExemplarThread(
            thread_id=thread.thread_id,
            composite_score=round(score, 3),
            intent_accuracy=thread.intent_accuracy,
            correctness_verdict=thread.worst_correctness,
            efficiency_verdict=thread.efficiency_verdict,
            task_completed=bool(thread.success_status),
            transcript=transcript,
            rule_violations=violations,
            friction_turns=friction_turns,
        )

    @staticmethod
    def _extract_violations(result: dict) -> list[RuleViolation]:
        violations: list[RuleViolation] = []
        seen: set[str] = set()
        canonical = build_canonical_thread_evaluation(result or {})
        for rc in canonical.get("derived", {}).get("canonicalRuleOutcomes", []):
            if rc.get("status") != "VIOLATED":
                continue
            rule_id = rc.get("ruleId", "")
            if rule_id and rule_id not in seen:
                seen.add(rule_id)
                violations.append(RuleViolation(
                    rule_id=rule_id,
                    evidence=rc.get("evidence", ""),
                ))

        return violations

    # ------------------------------------------------------------------
    # Adversarial Breakdown
    # ------------------------------------------------------------------

    def compute_adversarial_breakdown(self) -> AdversarialBreakdown | None:
        if not self.adversarial:
            return None

        goal_stats: dict[str, dict[str, int]] = {}
        difficulty_stats: dict[str, dict[str, int]] = {}

        for ae in self.adversarial:
            # Aggregate by each goal in goal_flow
            goal_flow = ae.goal_flow or []
            if not goal_flow:
                goal_flow = ["unknown"]
            diff = ae.difficulty or "UNKNOWN"
            is_pass = ae.verdict == "PASS"

            for goal_id in goal_flow:
                gs = goal_stats.setdefault(goal_id, {"passed": 0, "total": 0})
                gs["total"] += 1
                if is_pass:
                    gs["passed"] += 1

            ds = difficulty_stats.setdefault(diff, {"passed": 0, "total": 0})
            ds["total"] += 1
            if is_pass:
                ds["passed"] += 1

        by_goal = sorted(
            [
                AdversarialGoalResult(
                    goal=goal_id,
                    passed=s["passed"],
                    total=s["total"],
                    pass_rate=round(s["passed"] / s["total"], 3) if s["total"] > 0 else 0,
                )
                for goal_id, s in goal_stats.items()
            ],
            key=lambda x: x.pass_rate,
        )

        by_difficulty = [
            AdversarialDifficultyResult(
                difficulty=diff,
                passed=s["passed"],
                total=s["total"],
            )
            for diff, s in sorted(
                difficulty_stats.items(),
                key=lambda x: DIFFICULTY_ORDER.index(x[0]) if x[0] in DIFFICULTY_ORDER else 99,
            )
        ]

        return AdversarialBreakdown(by_goal=by_goal, by_difficulty=by_difficulty)


ADVERSARIAL_VERDICT_ORDINAL: dict[str, float] = {
    "PASS": 1.0,
    "SOFT_FAIL": 0.5,
    "SOFT FAIL": 0.5,
    "FAIL": 0.0,
    "HARD_FAIL": 0.0,
    "HARD FAIL": 0.0,
}


class AdversarialAggregator:
    """Aggregator for batch_adversarial eval runs.

    Mirrors ReportAggregator interface so report_service can call the same
    methods regardless of eval_type.
    """

    def __init__(
        self,
        adversarial: list[AdversarialEvaluation],
        run_summary: dict,
    ):
        self.case_records = [
            (ae, _canonical_adversarial_case(ae))
            for ae in adversarial
        ]
        self.adversarial = [
            ae for ae, case in self.case_records
            if not case.get("derived", {}).get("isInfraFailure")
        ]
        self.error_count = sum(
            1 for _ae, case in self.case_records
            if case.get("derived", {}).get("isInfraFailure")
        )
        self.summary = run_summary or {}

    # ------------------------------------------------------------------
    # Verdict Distributions
    # ------------------------------------------------------------------

    def compute_distributions(self) -> VerdictDistributions:
        adv_dist: dict[str, int] = {}
        for ae, case in self.case_records:
            if case.get("derived", {}).get("isInfraFailure"):
                continue
            v = case.get("judge", {}).get("verdict") or ae.verdict or "UNKNOWN"
            adv_dist[v] = adv_dist.get(v, 0) + 1

        # Surface error count as a separate segment
        if self.error_count > 0:
            adv_dist["ERROR"] = self.error_count

        return VerdictDistributions(
            correctness={},
            efficiency={},
            adversarial=adv_dist if adv_dist else None,
            intent_histogram=IntentHistogram(buckets=[], counts=[]),
            custom_evaluations={},
        )

    # ------------------------------------------------------------------
    # Rule Compliance Matrix
    # ------------------------------------------------------------------

    def compute_rule_compliance(self) -> RuleComplianceMatrix:
        rule_stats: dict[str, dict] = {}
        co_failure_tracker: dict[frozenset[str], int] = {}

        for ae, case in self.case_records:
            test_failures: set[str] = set()

            rc_list = _canonical_rule_compliance(case)
            ReportAggregator._tally_rule_compliance(rc_list, rule_stats, test_failures)

            if len(test_failures) >= 2:
                for pair in combinations(sorted(test_failures), 2):
                    key = frozenset(pair)
                    co_failure_tracker[key] = co_failure_tracker.get(key, 0) + 1

        rules = []
        for rule_id, stats in rule_stats.items():
            total = stats["passed"] + stats["failed"]
            rate = stats["passed"] / total if total > 0 else 0
            rules.append(RuleComplianceEntry(
                rule_id=rule_id,
                section=stats["section"],
                passed=stats["passed"],
                failed=stats["failed"],
                not_evaluated=stats["not_evaluated"],
                rate=round(rate, 3),
                severity=_classify_severity(rate, stats["failed"]),
            ))
        rules.sort(key=lambda r: ((r.passed + r.failed) == 0, r.rate, r.rule_id))

        co_failures = []
        for pair, count in co_failure_tracker.items():
            if count < 2:
                continue
            pair_list = sorted(pair)
            a_fails = rule_stats[pair_list[0]]["failed"]
            b_fails = rule_stats[pair_list[1]]["failed"]
            min_fails = min(a_fails, b_fails)
            co_rate = count / min_fails if min_fails > 0 else 0
            if co_rate >= 0.3:
                co_failures.append(CoFailure(
                    rule_a=pair_list[0],
                    rule_b=pair_list[1],
                    co_occurrence_rate=round(co_rate, 2),
                ))
        co_failures.sort(key=lambda c: c.co_occurrence_rate, reverse=True)

        return RuleComplianceMatrix(rules=rules, co_failures=co_failures[:5])

    # ------------------------------------------------------------------
    # Friction Analysis (not applicable to adversarial — return empty)
    # ------------------------------------------------------------------

    def compute_friction_analysis(self) -> FrictionAnalysis:
        return FrictionAnalysis(
            total_friction_turns=0,
            by_cause={},
            recovery_quality={},
            avg_turns_by_verdict={},
            top_patterns=[],
        )

    # ------------------------------------------------------------------
    # Exemplar Selection
    # ------------------------------------------------------------------

    def select_exemplars(
        self,
        k: int = 5,
        custom_scores: dict[str, float] | None = None,
    ) -> Exemplars:
        scored = [
            (self._compute_adversarial_score(ae), ae)
            for ae in self.adversarial
        ]
        scored.sort(key=lambda x: x[0], reverse=True)

        best = [self._build_adversarial_exemplar(score, ae) for score, ae in scored[:k]]
        worst = [self._build_adversarial_exemplar(score, ae) for score, ae in scored[-k:]]
        worst.reverse()

        return Exemplars(best=best, worst=worst)

    @staticmethod
    def _compute_adversarial_score(ae: AdversarialEvaluation) -> float:
        case = _canonical_adversarial_case(ae)
        verdict_score = ADVERSARIAL_VERDICT_ORDINAL.get(case.get("judge", {}).get("verdict") or ae.verdict or "", 0.5)
        goal_score = 1.0 if case.get("judge", {}).get("goalAchieved") else 0.0

        rc_list = _canonical_rule_compliance(case)
        evaluated = [rc for rc in rc_list if rc.get("followed") is not None]
        if evaluated:
            followed = sum(1 for rc in evaluated if rc.get("followed"))
            rc_score = followed / len(evaluated)
        else:
            rc_score = 0.5

        return (verdict_score * 0.4) + (goal_score * 0.3) + (rc_score * 0.3)

    def _build_adversarial_exemplar(
        self, score: float, ae: AdversarialEvaluation,
    ) -> ExemplarThread:
        case = _canonical_adversarial_case(ae)

        # Extract transcript from adversarial result
        transcript: list[TranscriptMessage] = []
        turns = case.get("facts", {}).get("transcript", {}).get("turns", [])
        for turn in turns:
            user_msg = turn.get("user_message", "")
            if user_msg:
                transcript.append(TranscriptMessage(
                    role="user",
                    content=user_msg[:MAX_TRANSCRIPT_CHARS],
                ))
            bot_msg = turn.get("bot_response", "")
            if bot_msg:
                transcript.append(TranscriptMessage(
                    role="assistant",
                    content=bot_msg[:MAX_TRANSCRIPT_CHARS],
                ))

        # Extract rule violations
        violations: list[RuleViolation] = []
        for rc in _canonical_rule_compliance(case):
            if not rc.get("followed", True):
                rule_id = rc.get("rule_id", "")
                if rule_id:
                    violations.append(RuleViolation(
                        rule_id=rule_id,
                        evidence=rc.get("evidence", ""),
                    ))

        return ExemplarThread(
            thread_id=str(ae.id),
            composite_score=round(score, 3),
            intent_accuracy=None,
            correctness_verdict=case.get("judge", {}).get("verdict") or ae.verdict,
            efficiency_verdict=None,
            task_completed=bool(case.get("judge", {}).get("goalAchieved")),
            transcript=transcript,
            rule_violations=violations,
            friction_turns=[],
            goal_flow=ae.goal_flow or [],
            active_traits=ae.active_traits or [],
            difficulty=ae.difficulty,
            failure_modes=case.get("judge", {}).get("failureModes", []),
            reasoning=case.get("judge", {}).get("reasoning"),
            goal_achieved=case.get("judge", {}).get("goalAchieved"),
        )

    # ------------------------------------------------------------------
    # Adversarial Breakdown (reuse ReportAggregator logic)
    # ------------------------------------------------------------------

    def compute_adversarial_breakdown(self) -> AdversarialBreakdown | None:
        if not self.adversarial:
            return None

        goal_stats: dict[str, dict[str, int]] = {}
        difficulty_stats: dict[str, dict[str, int]] = {}

        for ae, case in self.case_records:
            goal_verdicts = case.get("judge", {}).get("goalVerdicts", [])
            if not goal_verdicts:
                goal_verdicts = [
                    {"goalId": goal_id, "achieved": False}
                    for goal_id in (ae.goal_flow or ["unknown"])
                ]
            diff = ae.difficulty or "UNKNOWN"
            is_pass = case.get("judge", {}).get("verdict") == "PASS"

            for goal_verdict in goal_verdicts:
                goal_id = goal_verdict.get("goalId", "unknown")
                gs = goal_stats.setdefault(goal_id, {"passed": 0, "total": 0})
                gs["total"] += 1
                if goal_verdict.get("achieved"):
                    gs["passed"] += 1

            ds = difficulty_stats.setdefault(diff, {"passed": 0, "total": 0})
            ds["total"] += 1
            if is_pass:
                ds["passed"] += 1

        by_goal = sorted(
            [
                AdversarialGoalResult(
                    goal=goal_id,
                    passed=s["passed"],
                    total=s["total"],
                    pass_rate=round(s["passed"] / s["total"], 3) if s["total"] > 0 else 0,
                )
                for goal_id, s in goal_stats.items()
            ],
            key=lambda x: x.pass_rate,
        )

        by_difficulty = [
            AdversarialDifficultyResult(
                difficulty=diff,
                passed=s["passed"],
                total=s["total"],
            )
            for diff, s in sorted(
                difficulty_stats.items(),
                key=lambda x: DIFFICULTY_ORDER.index(x[0]) if x[0] in DIFFICULTY_ORDER else 99,
            )
        ]

        return AdversarialBreakdown(by_goal=by_goal, by_difficulty=by_difficulty)


# ------------------------------------------------------------------
# Module-level helpers
# ------------------------------------------------------------------

def _classify_severity(rate: float, fail_count: int) -> str:
    if fail_count == 0:
        return "LOW"
    if rate < 0.5:
        return "CRITICAL"
    if rate < 0.7:
        return "HIGH"
    if rate < 0.85:
        return "MEDIUM"
    return "LOW"


def _normalize_pattern(desc: str) -> str:
    """Rough grouping key — lowercase, strip punctuation, first 6 words."""
    cleaned = re.sub(r'[^\w\s]', '', desc.lower())
    words = cleaned.split()[:6]
    return ' '.join(words)
