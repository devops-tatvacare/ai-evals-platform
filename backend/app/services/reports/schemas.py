"""Report payload schemas — the single backend→frontend contract.

All models extend CamelModel for automatic camelCase JSON serialization.
Fields are raw numeric values; frontend handles display formatting.
"""

from __future__ import annotations

from app.schemas.base import CamelModel
from app.services.reports.custom_evaluations.schemas import CustomEvaluationsReport


# --- Health Score ---

class HealthScoreBreakdownItem(CamelModel):
    value: float
    weighted: float


class HealthScoreBreakdown(CamelModel):
    intent_accuracy: HealthScoreBreakdownItem
    correctness_rate: HealthScoreBreakdownItem
    efficiency_rate: HealthScoreBreakdownItem
    task_completion: HealthScoreBreakdownItem


class HealthScore(CamelModel):
    grade: str
    numeric: float
    breakdown: HealthScoreBreakdown


# --- Verdict Distributions ---

class IntentHistogram(CamelModel):
    buckets: list[str]
    counts: list[int]


class VerdictDistributions(CamelModel):
    correctness: dict[str, int]
    efficiency: dict[str, int]
    adversarial: dict[str, int] | None = None
    intent_histogram: IntentHistogram
    custom_evaluations: dict = {}  # deprecated — kept for cache compat


# --- Rule Compliance ---

class RuleComplianceEntry(CamelModel):
    rule_id: str
    section: str
    passed: int
    failed: int
    rate: float
    severity: str


class CoFailure(CamelModel):
    rule_a: str
    rule_b: str
    co_occurrence_rate: float


class RuleComplianceMatrix(CamelModel):
    rules: list[RuleComplianceEntry]
    co_failures: list[CoFailure]


# --- Friction Analysis ---

class FrictionPattern(CamelModel):
    description: str
    count: int
    example_thread_ids: list[str]


class FrictionAnalysis(CamelModel):
    total_friction_turns: int
    by_cause: dict[str, int]
    recovery_quality: dict[str, int]
    avg_turns_by_verdict: dict[str, float]
    top_patterns: list[FrictionPattern]


# --- Adversarial Breakdown ---

class AdversarialCategoryResult(CamelModel):
    category: str
    passed: int
    total: int
    pass_rate: float


class AdversarialDifficultyResult(CamelModel):
    difficulty: str
    passed: int
    total: int


class AdversarialBreakdown(CamelModel):
    by_category: list[AdversarialCategoryResult]
    by_difficulty: list[AdversarialDifficultyResult]


# --- Exemplars ---

class TranscriptMessage(CamelModel):
    role: str
    content: str


class RuleViolation(CamelModel):
    rule_id: str
    evidence: str


class FrictionTurn(CamelModel):
    turn: int
    cause: str
    description: str


class ExemplarThread(CamelModel):
    thread_id: str
    composite_score: float
    intent_accuracy: float | None = None
    correctness_verdict: str | None = None
    efficiency_verdict: str | None = None
    task_completed: bool
    transcript: list[TranscriptMessage]
    rule_violations: list[RuleViolation]
    friction_turns: list[FrictionTurn]
    # Adversarial-specific fields (populated only for batch_adversarial exemplars)
    category: str | None = None
    difficulty: str | None = None
    failure_modes: list[str] = []
    reasoning: str | None = None
    goal_achieved: bool | None = None


class Exemplars(CamelModel):
    best: list[ExemplarThread]
    worst: list[ExemplarThread]


# --- Production Prompts ---

class ProductionPrompts(CamelModel):
    intent_classification: str | None = None
    meal_summary_spec: str | None = None


# --- AI Narrative (populated in Phase 3, nullable until then) ---

class TopIssue(CamelModel):
    rank: int = 0
    area: str = ""
    description: str = ""
    affected_count: int = 0
    example_thread_id: str | None = None


class ExemplarAnalysis(CamelModel):
    thread_id: str = ""
    type: str = ""
    what_happened: str = ""
    why: str = ""
    prompt_gap: str | None = None


class PromptGap(CamelModel):
    prompt_section: str = ""
    eval_rule: str = ""
    gap_type: str = ""
    description: str = ""
    suggested_fix: str = ""


class Recommendation(CamelModel):
    priority: str = ""
    area: str = ""
    action: str = ""
    estimated_impact: str = ""


class NarrativeOutput(CamelModel):
    executive_summary: str
    top_issues: list[TopIssue]
    exemplar_analysis: list[ExemplarAnalysis]
    prompt_gaps: list[PromptGap]
    recommendations: list[Recommendation]


# --- Top-level payload ---

class ReportMetadata(CamelModel):
    run_id: str
    run_name: str | None = None
    app_id: str
    eval_type: str
    created_at: str
    llm_provider: str | None = None
    llm_model: str | None = None
    narrative_model: str | None = None
    total_threads: int
    completed_threads: int
    error_threads: int
    duration_ms: float | None = None
    data_path: str | None = None


class ReportPayload(CamelModel):
    metadata: ReportMetadata
    health_score: HealthScore
    distributions: VerdictDistributions
    rule_compliance: RuleComplianceMatrix
    friction: FrictionAnalysis
    adversarial: AdversarialBreakdown | None = None
    exemplars: Exemplars
    production_prompts: ProductionPrompts
    narrative: NarrativeOutput | None = None
    custom_evaluations_report: CustomEvaluationsReport | None = None
