"""Cross-run aggregate analytics — pure computation, no DB, no LLM.

Receives loaded report_cache dicts from multiple EvalRuns,
computes cross-run trends, heatmaps, and aggregated insights.
"""

from __future__ import annotations

from app.schemas.base import CamelModel

# ------------------------------------------------------------------
# Grade helper (same thresholds as health_score.py)
# ------------------------------------------------------------------

GRADE_THRESHOLDS: list[tuple[float, str]] = [
    (95, "A+"), (90, "A"), (85, "A-"),
    (80, "B+"), (75, "B"), (70, "B-"),
    (65, "C+"), (60, "C"), (55, "C-"),
    (50, "D+"), (45, "D"), (0, "F"),
]

SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2}


def _grade_for(score: float) -> str:
    return next(g for threshold, g in GRADE_THRESHOLDS if score >= threshold)


# ------------------------------------------------------------------
# Response schemas
# ------------------------------------------------------------------

class RunSlice(CamelModel):
    """Minimal run metadata for heatmap column headers."""
    run_id: str
    run_name: str | None
    eval_type: str
    created_at: str
    health_score: float
    grade: str
    total_threads: int


class CrossRunStats(CamelModel):
    total_runs: int
    all_runs: int
    total_threads: int
    total_adversarial_tests: int
    avg_health_score: float
    avg_grade: str
    avg_breakdown: dict[str, float]
    adversarial_pass_rate: float | None


class HealthTrendPoint(CamelModel):
    run_id: str
    run_name: str | None
    eval_type: str
    created_at: str
    health_score: float
    grade: str
    breakdown: dict[str, float]


class RuleHeatmapRow(CamelModel):
    rule_id: str
    section: str
    avg_rate: float
    worst_severity: str
    cells: list[float | None]


class RuleComplianceHeatmap(CamelModel):
    runs: list[RunSlice]
    rows: list[RuleHeatmapRow]


class AdversarialHeatmapRow(CamelModel):
    goal: str
    avg_pass_rate: float
    cells: list[float | None]


class AdversarialHeatmap(CamelModel):
    runs: list[RunSlice]
    rows: list[AdversarialHeatmapRow]


class AggregatedIssue(CamelModel):
    area: str
    descriptions: list[str]
    total_affected: int
    run_count: int
    worst_rank: int


class AggregatedRecommendation(CamelModel):
    area: str
    highest_priority: str
    actions: list[str]
    run_count: int
    estimated_impacts: list[str]


class IssuesAndRecommendations(CamelModel):
    issues: list[AggregatedIssue]
    recommendations: list[AggregatedRecommendation]
    runs_with_narrative: int
    runs_without_narrative: int


class CrossRunAISummary(CamelModel):
    executive_summary: str
    trend_analysis: str
    critical_patterns: list[str]
    strategic_recommendations: list[str]


class CrossRunAnalytics(CamelModel):
    stats: CrossRunStats
    health_trend: list[HealthTrendPoint]
    rule_compliance_heatmap: RuleComplianceHeatmap
    adversarial_heatmap: AdversarialHeatmap | None
    issues_and_recommendations: IssuesAndRecommendations


# ------------------------------------------------------------------
# Aggregator
# ------------------------------------------------------------------

class CrossRunAggregator:
    """Aggregates report_cache data across multiple EvalRuns.

    Constructor args:
        runs_data: list of (run_meta, report_cache) tuples.
            run_meta = {"id": str, "eval_type": str, "created_at": str, "batch_metadata": dict|None}
            report_cache = full cached ReportPayload dict (camelCase keys)
        all_runs_count: total number of eval runs for this app (for coverage indicator)
    """

    def __init__(
        self,
        runs_data: list[tuple[dict, dict]],
        all_runs_count: int,
    ):
        self.runs_data = runs_data
        self.all_runs_count = all_runs_count

    def aggregate(self) -> CrossRunAnalytics:
        # Sort chronologically (oldest first) for heatmap columns
        sorted_runs = sorted(
            self.runs_data,
            key=lambda x: x[0].get("created_at", ""),
        )

        run_slices = self._build_run_slices(sorted_runs)
        stats = self._compute_stats(sorted_runs, run_slices)
        health_trend = self._compute_health_trend(sorted_runs)
        rule_heatmap = self._compute_rule_heatmap(sorted_runs, run_slices)
        adv_heatmap = self._compute_adversarial_heatmap(sorted_runs)
        issues_recs = self._compute_issues_and_recommendations(sorted_runs)

        return CrossRunAnalytics(
            stats=stats,
            health_trend=health_trend,
            rule_compliance_heatmap=rule_heatmap,
            adversarial_heatmap=adv_heatmap,
            issues_and_recommendations=issues_recs,
        )

    # ------------------------------------------------------------------
    # Run slices
    # ------------------------------------------------------------------

    @staticmethod
    def _build_run_slices(sorted_runs: list[tuple[dict, dict]]) -> list[RunSlice]:
        slices: list[RunSlice] = []
        for meta, cache in sorted_runs:
            hs = cache.get("healthScore", cache.get("health_score", {}))
            md = cache.get("metadata", {})
            batch_meta = meta.get("batch_metadata") or {}

            slices.append(RunSlice(
                run_id=meta["id"],
                run_name=batch_meta.get("name") or md.get("runName") or md.get("run_name"),
                eval_type=meta.get("eval_type", md.get("evalType", md.get("eval_type", ""))),
                created_at=meta.get("created_at", md.get("createdAt", md.get("created_at", ""))),
                health_score=hs.get("numeric", 0),
                grade=hs.get("grade", "F"),
                total_threads=md.get("totalThreads", md.get("total_threads", 0)),
            ))
        return slices

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    def _compute_stats(
        self,
        sorted_runs: list[tuple[dict, dict]],
        run_slices: list[RunSlice],
    ) -> CrossRunStats:
        total_threads = sum(s.total_threads for s in run_slices)
        health_scores = [s.health_score for s in run_slices]
        avg_hs = sum(health_scores) / len(health_scores) if health_scores else 0

        # Dynamic avg breakdown
        breakdown_accum: dict[str, list[float]] = {}
        for _meta, cache in sorted_runs:
            hs = cache.get("healthScore", cache.get("health_score", {}))
            bd = hs.get("breakdown", {})
            for key, item in bd.items():
                val = item.get("value", 0) if isinstance(item, dict) else item
                breakdown_accum.setdefault(key, []).append(val)

        avg_breakdown = {
            key: round(sum(vals) / len(vals), 1)
            for key, vals in breakdown_accum.items()
            if vals
        }

        # Adversarial pass rate
        total_adv_tests = 0
        total_adv_passed = 0
        for _meta, cache in sorted_runs:
            adv = cache.get("adversarial")
            if not adv:
                continue
            for goal_entry in adv.get("byGoal", adv.get("by_goal", [])):
                total_adv_tests += goal_entry.get("total", 0)
                total_adv_passed += goal_entry.get("passed", 0)

        adv_pass_rate = (
            round(total_adv_passed / total_adv_tests * 100, 1)
            if total_adv_tests > 0
            else None
        )

        return CrossRunStats(
            total_runs=len(sorted_runs),
            all_runs=self.all_runs_count,
            total_threads=total_threads,
            total_adversarial_tests=total_adv_tests,
            avg_health_score=round(avg_hs, 1),
            avg_grade=_grade_for(avg_hs),
            avg_breakdown=avg_breakdown,
            adversarial_pass_rate=adv_pass_rate,
        )

    # ------------------------------------------------------------------
    # Health trend
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_health_trend(
        sorted_runs: list[tuple[dict, dict]],
    ) -> list[HealthTrendPoint]:
        points: list[HealthTrendPoint] = []
        for meta, cache in sorted_runs:
            hs = cache.get("healthScore", cache.get("health_score", {}))
            md = cache.get("metadata", {})
            bd = hs.get("breakdown", {})
            batch_meta = meta.get("batch_metadata") or {}

            breakdown: dict[str, float] = {}
            for key, item in bd.items():
                val = item.get("value", 0) if isinstance(item, dict) else item
                breakdown[key] = val

            points.append(HealthTrendPoint(
                run_id=meta["id"],
                run_name=batch_meta.get("name") or md.get("runName") or md.get("run_name"),
                eval_type=meta.get("eval_type", md.get("evalType", md.get("eval_type", ""))),
                created_at=meta.get("created_at", md.get("createdAt", md.get("created_at", ""))),
                health_score=hs.get("numeric", 0),
                grade=hs.get("grade", "F"),
                breakdown=breakdown,
            ))
        return points

    # ------------------------------------------------------------------
    # Rule compliance heatmap
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_rule_heatmap(
        sorted_runs: list[tuple[dict, dict]],
        run_slices: list[RunSlice],
    ) -> RuleComplianceHeatmap:
        # Collect rules per run
        rules_per_run: list[dict[str, dict]] = []
        for _meta, cache in sorted_runs:
            rc = cache.get("ruleCompliance", cache.get("rule_compliance", {}))
            rules_list = rc.get("rules", [])
            rules_map: dict[str, dict] = {}
            for r in rules_list:
                rid = r.get("ruleId", r.get("rule_id", ""))
                if rid:
                    rules_map[rid] = {
                        "rate": r.get("rate", 0),
                        "severity": r.get("severity", "LOW"),
                        "section": r.get("section", ""),
                    }
            rules_per_run.append(rules_map)

        # Union of all rule IDs
        all_rule_ids: set[str] = set()
        for rm in rules_per_run:
            all_rule_ids.update(rm.keys())

        if not all_rule_ids:
            return RuleComplianceHeatmap(runs=run_slices, rows=[])

        # Build rows
        rows: list[RuleHeatmapRow] = []
        for rule_id in all_rule_ids:
            cells: list[float | None] = []
            severities: list[str] = []
            section = ""

            for rm in rules_per_run:
                if rule_id in rm:
                    cells.append(rm[rule_id]["rate"])
                    severities.append(rm[rule_id]["severity"])
                    if not section:
                        section = rm[rule_id]["section"]
                else:
                    cells.append(None)

            non_null = [c for c in cells if c is not None]
            avg_rate = sum(non_null) / len(non_null) if non_null else 0

            worst_sev = min(
                severities,
                key=lambda s: SEVERITY_ORDER.get(s, 99),
                default="LOW",
            )

            rows.append(RuleHeatmapRow(
                rule_id=rule_id,
                section=section,
                avg_rate=round(avg_rate, 3),
                worst_severity=worst_sev,
                cells=cells,
            ))

        # Sort by worst avg_rate first
        rows.sort(key=lambda r: r.avg_rate)

        return RuleComplianceHeatmap(runs=run_slices, rows=rows)

    # ------------------------------------------------------------------
    # Adversarial heatmap
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_adversarial_heatmap(
        sorted_runs: list[tuple[dict, dict]],
    ) -> AdversarialHeatmap | None:
        # Filter to adversarial runs
        adv_runs: list[tuple[dict, dict, int]] = []
        for idx, (meta, cache) in enumerate(sorted_runs):
            adv = cache.get("adversarial")
            if adv:
                adv_runs.append((meta, cache, idx))

        if not adv_runs:
            return None

        # Build run slices for adversarial runs only
        adv_slices: list[RunSlice] = []
        goals_per_run: list[dict[str, float]] = []

        for meta, cache, _idx in adv_runs:
            hs = cache.get("healthScore", cache.get("health_score", {}))
            md = cache.get("metadata", {})
            batch_meta = meta.get("batch_metadata") or {}

            adv_slices.append(RunSlice(
                run_id=meta["id"],
                run_name=batch_meta.get("name") or md.get("runName") or md.get("run_name"),
                eval_type=meta.get("eval_type", md.get("evalType", md.get("eval_type", ""))),
                created_at=meta.get("created_at", md.get("createdAt", md.get("created_at", ""))),
                health_score=hs.get("numeric", 0),
                grade=hs.get("grade", "F"),
                total_threads=md.get("totalThreads", md.get("total_threads", 0)),
            ))

            adv = cache.get("adversarial", {})
            by_goal = adv.get("byGoal", adv.get("by_goal", []))
            goal_map: dict[str, float] = {}
            for goal_entry in by_goal:
                goal_name = goal_entry.get("goal", "")
                pass_rate = goal_entry.get("passRate", goal_entry.get("pass_rate", 0))
                if goal_name:
                    goal_map[goal_name] = pass_rate
            goals_per_run.append(goal_map)

        # Union of all goals
        all_goals: set[str] = set()
        for gm in goals_per_run:
            all_goals.update(gm.keys())

        if not all_goals:
            return AdversarialHeatmap(runs=adv_slices, rows=[])

        rows: list[AdversarialHeatmapRow] = []
        for goal in all_goals:
            cells: list[float | None] = []
            for gm in goals_per_run:
                cells.append(gm.get(goal))

            non_null = [c for c in cells if c is not None]
            avg_pr = sum(non_null) / len(non_null) if non_null else 0

            rows.append(AdversarialHeatmapRow(
                goal=goal,
                avg_pass_rate=round(avg_pr, 3),
                cells=cells,
            ))

        rows.sort(key=lambda r: r.avg_pass_rate)

        return AdversarialHeatmap(runs=adv_slices, rows=rows)

    # ------------------------------------------------------------------
    # Issues & Recommendations
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_issues_and_recommendations(
        sorted_runs: list[tuple[dict, dict]],
    ) -> IssuesAndRecommendations:
        runs_with_narrative = 0
        runs_without_narrative = 0

        issue_groups: dict[str, dict] = {}
        rec_groups: dict[str, dict] = {}

        for run_idx, (_meta, cache) in enumerate(sorted_runs):
            narrative = cache.get("narrative")
            if not narrative:
                runs_without_narrative += 1
                continue
            runs_with_narrative += 1

            # Issues
            for issue in narrative.get("topIssues", narrative.get("top_issues", [])):
                area = (issue.get("area", "Unknown")).strip().lower()
                desc = issue.get("description", "").strip()
                affected = issue.get("affectedCount", issue.get("affected_count", 0))
                rank = issue.get("rank", 99)

                if area not in issue_groups:
                    issue_groups[area] = {
                        "descriptions": [],
                        "desc_prefixes": set(),
                        "total_affected": 0,
                        "run_indices": set(),
                        "worst_rank": 99,
                    }
                g = issue_groups[area]
                prefix = desc[:80].lower()
                if prefix not in g["desc_prefixes"] and desc:
                    g["descriptions"].append(desc)
                    g["desc_prefixes"].add(prefix)
                g["total_affected"] += affected
                g["run_indices"].add(run_idx)
                g["worst_rank"] = min(g["worst_rank"], rank)

            # Recommendations
            for rec in narrative.get("recommendations", []):
                area = (rec.get("area", "Unknown")).strip().lower()
                action = rec.get("action", "").strip()
                priority = rec.get("priority", "P2")
                impact = rec.get("estimatedImpact", rec.get("estimated_impact", ""))

                if area not in rec_groups:
                    rec_groups[area] = {
                        "actions": [],
                        "action_prefixes": set(),
                        "highest_priority": "P2",
                        "run_indices": set(),
                        "estimated_impacts": [],
                        "impact_prefixes": set(),
                    }
                g = rec_groups[area]
                action_prefix = action[:80].lower()
                if action_prefix not in g["action_prefixes"] and action:
                    g["actions"].append(action)
                    g["action_prefixes"].add(action_prefix)
                # Track highest priority (P0 > P1 > P2)
                if PRIORITY_ORDER.get(priority, 99) < PRIORITY_ORDER.get(g["highest_priority"], 99):
                    g["highest_priority"] = priority
                g["run_indices"].add(run_idx)
                impact_prefix = impact[:80].lower()
                if impact_prefix not in g["impact_prefixes"] and impact:
                    g["estimated_impacts"].append(impact)
                    g["impact_prefixes"].add(impact_prefix)

        # Build sorted issue list
        issues = [
            AggregatedIssue(
                area=area.title(),
                descriptions=g["descriptions"],
                total_affected=g["total_affected"],
                run_count=len(g["run_indices"]),
                worst_rank=g["worst_rank"],
            )
            for area, g in issue_groups.items()
        ]
        issues.sort(key=lambda i: (-i.run_count, -i.total_affected))

        # Build sorted recommendation list
        recommendations = [
            AggregatedRecommendation(
                area=area.title(),
                highest_priority=g["highest_priority"],
                actions=g["actions"],
                run_count=len(g["run_indices"]),
                estimated_impacts=g["estimated_impacts"],
            )
            for area, g in rec_groups.items()
        ]
        recommendations.sort(
            key=lambda r: (PRIORITY_ORDER.get(r.highest_priority, 99), -r.run_count),
        )

        return IssuesAndRecommendations(
            issues=issues,
            recommendations=recommendations,
            runs_with_narrative=runs_with_narrative,
            runs_without_narrative=runs_without_narrative,
        )
