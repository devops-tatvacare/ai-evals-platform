"""Pydantic schemas for custom evaluations report section."""

from __future__ import annotations

from app.schemas.base import CamelModel


class ThresholdPassRates(CamelModel):
    green_pct: float
    yellow_pct: float
    red_pct: float
    green_threshold: float
    yellow_threshold: float | None = None


class FieldAggregation(CamelModel):
    key: str
    field_type: str  # "number" | "boolean" | "enum" | "text" | "array"
    display_mode: str  # "header" | "card"
    label: str
    sample_count: int = 0
    # Number fields
    average: float | None = None
    threshold_pass_rates: ThresholdPassRates | None = None
    # Boolean fields
    pass_rate: float | None = None
    true_count: int | None = None
    false_count: int | None = None
    # Enum fields
    distribution: dict[str, int] | None = None


class EvaluatorSection(CamelModel):
    evaluator_id: str
    evaluator_name: str
    total_threads: int
    completed: int
    errors: int
    error_rate: float
    primary_field: FieldAggregation | None = None
    fields: list[FieldAggregation]


class CustomEvalNarrativeFinding(CamelModel):
    finding: str = ""
    severity: str = "low"  # "low" | "medium" | "high" | "critical"
    affected_count: int = 0


class CustomEvalNarrative(CamelModel):
    overall_assessment: str
    key_findings: list[CustomEvalNarrativeFinding]
    notable_patterns: list[str]


class CustomEvaluationsReport(CamelModel):
    evaluator_sections: list[EvaluatorSection]
    narrative: CustomEvalNarrative | None = None
