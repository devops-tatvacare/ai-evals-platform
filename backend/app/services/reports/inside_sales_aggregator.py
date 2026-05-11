# backend/app/services/reports/inside_sales_aggregator.py
"""Aggregation engine for inside sales call evaluations.

Reads dimension keys dynamically from evaluator output_schema.
No hardcoded dimension names.
"""

from __future__ import annotations

import logging
from statistics import mean

import json as _json

from .flag_utils import aggregate_flag, aggregate_outcome_flag

logger = logging.getLogger(__name__)

VERDICT_THRESHOLDS = {"strong": 80, "good": 65, "needsWork": 50}


def _classify_verdict(score: float) -> str:
    if score >= VERDICT_THRESHOLDS["strong"]:
        return "strong"
    if score >= VERDICT_THRESHOLDS["good"]:
        return "good"
    if score >= VERDICT_THRESHOLDS["needsWork"]:
        return "needsWork"
    return "poor"


def _get_eval_output(thread: dict, evaluator_id: str | None = None) -> dict | None:
    result = thread.get("result", {})
    evals = result.get("evaluations", [])
    if not evals:
        return None
    if evaluator_id is None:
        return evals[0].get("output", {})
    for ev in evals:
        if str(ev.get("evaluator_id", "")) == str(evaluator_id):
            return ev.get("output", {})
    return None


def _get_call_metadata(thread: dict) -> dict:
    return thread.get("result", {}).get("call_metadata", {})


def _resolve_agent_key(meta: dict) -> str:
    # call_metadata.agent_id is the LSQ-linked UUID when known, JSON null when LSQ
    # did not return an agentId. Fall back to the display name so calls from the
    # same un-mapped rep still group into one slice.
    raw = meta.get("agent_id") or meta.get("agent") or "unknown"
    return str(raw).strip() or "unknown"


def _safe_score(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except (ValueError, AttributeError):
            return None
    return None


def _safe_parse_list(raw: str) -> list:
    """Parse a JSON array string, returning [] on failure."""
    try:
        parsed = _json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except (ValueError, TypeError):
        return []


class InsideSalesAggregator:
    def __init__(
        self,
        threads: list[dict],
        output_schema: list[dict],
        agent_names: dict[str, str],
        evaluator_id: str | None = None,
    ):
        self.threads = [t for t in threads if t.get("success_status")]
        self.output_schema = output_schema
        self.agent_names = agent_names
        self.evaluator_id = evaluator_id

        self.dimension_fields = []
        self.compliance_fields = []
        self.overall_score_key = "overall_score"

        for field in output_schema:
            key = field.get("key", "")
            ftype = field.get("type", "")
            if field.get("isMainMetric"):
                self.overall_score_key = key
            elif ftype == "number" and not field.get("hidden"):
                # Any non-main number field is a dimension. The prior rule
                # required role to be falsy, but both seeded inside-sales
                # evaluators tag every dimension `role=detail`, which made
                # dimensionBreakdown silently empty in prod.
                self.dimension_fields.append(field)
            elif ftype == "boolean" and key.startswith("compliance_"):
                self.compliance_fields.append(field)

    def aggregate(self) -> dict:
        outputs = []
        for t in self.threads:
            out = _get_eval_output(t, self.evaluator_id)
            if out:
                outputs.append((t, out))

        return {
            "runSummary": self._run_summary(outputs),
            "dimensionBreakdown": self._dimension_breakdown(outputs),
            "complianceBreakdown": self._compliance_breakdown(outputs),
            "flagStats": self._flag_stats(outputs),
            "agentSlices": self._agent_slices(outputs),
        }

    def _run_summary(self, outputs):
        scores = [s for s in (_safe_score(out.get(self.overall_score_key)) for _, out in outputs) if s is not None]
        avg = mean(scores) if scores else 0

        verdicts = {"strong": 0, "good": 0, "needsWork": 0, "poor": 0}
        for s in scores:
            verdicts[_classify_verdict(s)] += 1

        compliance_violations = 0
        for _, out in outputs:
            for cf in self.compliance_fields:
                if out.get(cf["key"]) is False:
                    compliance_violations += 1
                    break

        total = len(self.threads)
        evaluated = len(outputs)
        pass_count = evaluated - compliance_violations

        return {
            "totalCalls": total,
            "evaluatedCalls": evaluated,
            "avgQaScore": round(avg, 1),
            "verdictDistribution": verdicts,
            "compliancePassRate": round(pass_count / evaluated * 100, 1) if evaluated else 0,
            "complianceViolationCount": compliance_violations,
        }

    def _dimension_breakdown(self, outputs):
        breakdown = {}
        for field in self.dimension_fields:
            key = field["key"]
            values = [v for v in (_safe_score(out.get(key)) for _, out in outputs) if v is not None]
            if not values:
                continue

            max_possible = field.get("max", 100)
            bucket_size = max_possible / 5
            distribution = [0, 0, 0, 0, 0]
            for v in values:
                idx = min(int(v / bucket_size), 4) if bucket_size > 0 else 0
                distribution[idx] += 1

            breakdown[key] = {
                "label": field.get("label", key),
                "avg": round(mean(values), 1),
                "min": round(min(values), 1),
                "max": round(max(values), 1),
                "maxPossible": max_possible,
                "greenThreshold": field.get("green_threshold", max_possible * 0.8),
                "yellowThreshold": field.get("yellow_threshold", max_possible * 0.5),
                "distribution": distribution,
            }
        return breakdown

    def _compliance_breakdown(self, outputs):
        breakdown = {}
        for field in self.compliance_fields:
            key = field["key"]
            passed = sum(1 for _, out in outputs if out.get(key) is True)
            failed = sum(1 for _, out in outputs if out.get(key) is False)
            breakdown[key] = {
                "label": field.get("label", key),
                "passed": passed,
                "failed": failed,
                "total": passed + failed,
            }
        return breakdown

    def _flag_stats(self, outputs):
        # Build dicts from flat enum fields for aggregate_flag / aggregate_outcome_flag.
        # Enum values are strings ("true"/"false"/"not_relevant") — convert to bool/str.
        def _parse_flag(val: str | None) -> bool | str:
            if val == "true":
                return True
            if val == "not_relevant":
                return "not_relevant"
            return False

        escalation = [{"present": _parse_flag(out.get("escalation_present"))} for _, out in outputs]
        disagreement = [{"present": _parse_flag(out.get("disagreement_present"))} for _, out in outputs]

        # Tension: text field containing JSON array or "not_relevant"
        tension_relevant = 0
        tension_not_relevant = 0
        severity_counts = {"low": 0, "medium": 0, "high": 0}
        for _, out in outputs:
            raw = out.get("tension_moments", "not_relevant")
            if raw == "not_relevant" or not raw:
                tension_not_relevant += 1
            else:
                tension_relevant += 1
                moments = raw if isinstance(raw, list) else _safe_parse_list(raw)
                for m in moments:
                    sev = m.get("severity", "low") if isinstance(m, dict) else "low"
                    if sev in severity_counts:
                        severity_counts[sev] += 1

        # Outcomes: flat enum fields → dicts for aggregate_outcome_flag
        meeting = [{"occurred": _parse_flag(out.get("meeting_occurred"))} for _, out in outputs]
        purchase = [{"occurred": _parse_flag(out.get("purchase_occurred"))} for _, out in outputs]
        callback = [{"occurred": _parse_flag(out.get("callback_occurred"))} for _, out in outputs]
        crosssell = [
            {
                "attempted": _parse_flag(out.get("crosssell_attempted")),
                "accepted": _parse_flag(out.get("crosssell_accepted")),
            }
            for _, out in outputs
        ]

        return {
            "escalation": aggregate_flag(escalation),
            "disagreement": aggregate_flag(disagreement),
            "tension": {
                "relevant": tension_relevant,
                "notRelevant": tension_not_relevant,
                "bySeverity": severity_counts,
            },
            "meetingSetup": aggregate_outcome_flag(meeting, attempted_key="occurred"),
            "purchaseMade": aggregate_outcome_flag(purchase, attempted_key="occurred"),
            "callbackScheduled": aggregate_outcome_flag(callback, attempted_key="occurred"),
            "crossSell": aggregate_outcome_flag(crosssell, attempted_key="attempted", accepted_key="accepted"),
        }

    def _agent_slices(self, outputs):
        agent_groups: dict[str, list[tuple]] = {}
        for thread, out in outputs:
            meta = _get_call_metadata(thread)
            agent_groups.setdefault(_resolve_agent_key(meta), []).append((thread, out))

        slices = {}
        for agent_id, agent_outputs in agent_groups.items():
            scores = [s for s in (_safe_score(out.get(self.overall_score_key)) for _, out in agent_outputs) if s is not None]
            verdicts = {"strong": 0, "good": 0, "needsWork": 0, "poor": 0}
            for s in scores:
                verdicts[_classify_verdict(s)] += 1

            dims = {}
            for field in self.dimension_fields:
                key = field["key"]
                values = [v for v in (_safe_score(out.get(key)) for _, out in agent_outputs) if v is not None]
                dims[key] = {"avg": round(mean(values), 1) if values else 0}

            comp_passed = 0
            comp_failed = 0
            for _, out in agent_outputs:
                has_violation = False
                for cf in self.compliance_fields:
                    if out.get(cf["key"]) is False:
                        has_violation = True
                        break
                if has_violation:
                    comp_failed += 1
                else:
                    comp_passed += 1

            agent_flags = self._flag_stats(agent_outputs)

            slices[agent_id] = {
                "agentName": self.agent_names.get(agent_id, agent_id),
                "callCount": len(agent_outputs),
                "avgQaScore": round(mean(scores), 1) if scores else 0,
                "dimensions": dims,
                "compliance": {"passed": comp_passed, "failed": comp_failed},
                "flags": agent_flags,
                "verdictDistribution": verdicts,
            }
        return slices


def aggregate_multi_evaluator(
    threads: list[dict],
    output_schemas: dict[str, list[dict]],
    agent_names: dict[str, str],
    evaluator_names: dict[str, str] | None = None,
) -> dict:
    """Run InsideSalesAggregator once per evaluator and merge into a unified shape.

    `output_schemas`: map of evaluator_id (str) → output_schema list.
    `evaluator_names`: optional map of evaluator_id → display name.

    Returns:
      {
        "perEvaluator": { evaluator_id: { id, name, ...aggregator output } },
        "combined": { ...first evaluator's aggregate output for back-compat... },
      }

    The `combined` block keeps existing PDF/HTML report adapters working while
    `perEvaluator` exposes the full multi-evaluator detail.
    """
    names = evaluator_names or {}
    per: dict[str, dict] = {}
    for ev_id, schema in output_schemas.items():
        agg = InsideSalesAggregator(threads, schema, agent_names, evaluator_id=ev_id).aggregate()
        per[ev_id] = {
            "id": ev_id,
            "name": names.get(ev_id, ev_id),
            **agg,
        }

    if per:
        first_id = next(iter(per))
        combined = {k: v for k, v in per[first_id].items() if k not in ("id", "name")}
    else:
        combined = {
            "runSummary": {},
            "dimensionBreakdown": {},
            "complianceBreakdown": {},
            "flagStats": {},
            "agentSlices": {},
        }

    return {"perEvaluator": per, "combined": combined}
