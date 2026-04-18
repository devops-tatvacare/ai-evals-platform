# backend/app/services/reports/inside_sales_schemas.py
"""Pydantic schemas for inside sales report payload.

Separate from schemas.py (Kaira) — completely different payload shape.
"""

from __future__ import annotations

from pydantic import Field

from app.schemas.base import CamelModel


class DimensionStats(CamelModel):
    label: str
    avg: float
    min: float
    max: float
    max_possible: float
    green_threshold: float
    yellow_threshold: float
    distribution: list[int] = Field(description="5 buckets")


class ComplianceGateStats(CamelModel):
    label: str
    passed: int
    failed: int
    total: int


class FlagStat(CamelModel):
    relevant: int
    not_relevant: int
    present: int = 0


class OutcomeFlagStat(CamelModel):
    relevant: int
    not_relevant: int
    attempted: int = 0
    accepted: int = 0


class TensionFlagStat(CamelModel):
    relevant: int
    not_relevant: int
    by_severity: dict[str, int] = Field(default_factory=dict)


class FlagStats(CamelModel):
    escalation: FlagStat
    disagreement: FlagStat
    tension: TensionFlagStat
    meeting_setup: OutcomeFlagStat
    purchase_made: OutcomeFlagStat
    callback_scheduled: OutcomeFlagStat
    cross_sell: OutcomeFlagStat


class VerdictDistribution(CamelModel):
    strong: int = 0
    good: int = 0
    needs_work: int = 0
    poor: int = 0


class RunSummary(CamelModel):
    total_calls: int
    evaluated_calls: int
    avg_qa_score: float
    verdict_distribution: VerdictDistribution
    compliance_pass_rate: float
    compliance_violation_count: int


class AgentDimensionAvg(CamelModel):
    avg: float


class AgentSlice(CamelModel):
    agent_name: str
    call_count: int
    avg_qa_score: float
    dimensions: dict[str, AgentDimensionAvg]
    compliance: dict[str, int]  # { "passed": N, "failed": N }
    flags: FlagStats
    verdict_distribution: VerdictDistribution


class DimensionInsight(CamelModel):
    dimension: str
    insight: str
    priority: str  # P0, P1, P2


class Recommendation(CamelModel):
    priority: str
    action: str


class InsideSalesNarrativeOutput(CamelModel):
    executive_summary: str
    dimension_insights: list[DimensionInsight] = Field(default_factory=list)
    agent_coaching_notes: dict[str, str] = Field(default_factory=dict)
    flag_patterns: str = ""
    compliance_alerts: list[str] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)


class InsideSalesReportMetadata(CamelModel):
    run_id: str
    run_name: str | None = None
    app_id: str
    eval_type: str
    created_at: str
    llm_provider: str | None = None
    llm_model: str | None = None
    narrative_model: str | None = None
    total_calls: int
    evaluated_calls: int
    duration_ms: float | None = None


class EvaluatorAggregate(CamelModel):
    id: str
    name: str
    run_summary: RunSummary
    dimension_breakdown: dict[str, DimensionStats]
    compliance_breakdown: dict[str, ComplianceGateStats]
    flag_stats: FlagStats
    agent_slices: dict[str, AgentSlice]


class InsideSalesReportPayload(CamelModel):
    metadata: InsideSalesReportMetadata
    run_summary: RunSummary
    dimension_breakdown: dict[str, DimensionStats]
    compliance_breakdown: dict[str, ComplianceGateStats]
    flag_stats: FlagStats
    agent_slices: dict[str, AgentSlice]
    narrative: InsideSalesNarrativeOutput | None = None
    per_evaluator: dict[str, EvaluatorAggregate] | None = None
