"""Canonical report section union types."""

from __future__ import annotations

from typing import Any
from typing import Annotated, Literal

from pydantic import Field

from app.schemas.base import CamelModel
from app.services.reports.contracts.cross_run_narrative import PlatformCrossRunNarrative
from app.services.reports.contracts.run_narrative import PlatformRunNarrative


class ReportSectionBase(CamelModel):
    id: str
    title: str
    description: str | None = None
    variant: str = "default"


class SummaryCard(CamelModel):
    key: str
    label: str
    value: str
    tone: str = "neutral"
    subtitle: str | None = None


class SummaryCardsSection(ReportSectionBase):
    type: Literal["summary_cards"] = "summary_cards"
    data: list[SummaryCard]


class NarrativeSection(ReportSectionBase):
    type: Literal["narrative"] = "narrative"
    data: PlatformRunNarrative | PlatformCrossRunNarrative


class MetricBar(CamelModel):
    key: str
    label: str
    value: float
    max_value: float = 100
    unit: str | None = None
    tone: str = "neutral"


class MetricBreakdownSection(ReportSectionBase):
    type: Literal["metric_breakdown"] = "metric_breakdown"
    data: list[MetricBar]


class DistributionSeries(CamelModel):
    label: str
    values: list[float]
    categories: list[str]


class DistributionChartSection(ReportSectionBase):
    type: Literal["distribution_chart"] = "distribution_chart"
    data: list[DistributionSeries]


class ComplianceRow(CamelModel):
    key: str
    label: str
    section: str | None = None
    passed: int
    failed: int
    not_evaluated: int = 0
    rate: float
    severity: str | None = None
    total: int | None = None


class ComplianceTableSection(ReportSectionBase):
    type: Literal["compliance_table"] = "compliance_table"
    data: list[ComplianceRow]


class FrictionPattern(CamelModel):
    description: str
    count: int
    example_thread_ids: list[str]


class FrictionAnalysisData(CamelModel):
    total_friction_turns: int
    by_cause: dict[str, int]
    recovery_quality: dict[str, int]
    avg_turns_by_verdict: dict[str, float]
    top_patterns: list[FrictionPattern]


class FrictionAnalysisSection(ReportSectionBase):
    type: Literal["friction_analysis"] = "friction_analysis"
    data: FrictionAnalysisData


class HeatmapPoint(CamelModel):
    label: str
    value: float | None = None
    tone: str = "neutral"
    subtitle: str | None = None


class HeatmapRow(CamelModel):
    key: str
    label: str
    cells: list[HeatmapPoint]


class HeatmapSectionData(CamelModel):
    columns: list[str]
    rows: list[HeatmapRow]


class HeatmapSection(ReportSectionBase):
    type: Literal["heatmap"] = "heatmap"
    data: HeatmapSectionData


class EntitySlice(CamelModel):
    entity_id: str
    label: str
    summary: dict[str, str | int | float]
    details: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class EntitySlicesSection(ReportSectionBase):
    type: Literal["entity_slices"] = "entity_slices"
    data: list[EntitySlice]


class FlagItem(CamelModel):
    key: str
    label: str
    relevant: int
    present: int
    not_relevant: int | None = None
    attempted: int | None = None
    accepted: int | None = None


class FlagsSection(ReportSectionBase):
    type: Literal["flags"] = "flags"
    data: list[FlagItem]


class IssueItem(CamelModel):
    title: str
    area: str
    summary: str
    priority: str


class RecommendationItem(CamelModel):
    priority: str
    title: str
    action: str
    expected_impact: str = ""


class IssuesRecommendationsData(CamelModel):
    issues: list[IssueItem]
    recommendations: list[RecommendationItem]


class IssuesRecommendationsSection(ReportSectionBase):
    type: Literal["issues_recommendations"] = "issues_recommendations"
    data: IssuesRecommendationsData


class ExemplarItem(CamelModel):
    item_id: str
    label: str
    score: float | None = None
    summary: str
    details: dict[str, Any] = Field(default_factory=dict)


class ExemplarsSection(ReportSectionBase):
    type: Literal["exemplars"] = "exemplars"
    data: list[ExemplarItem]


class PromptGapItem(CamelModel):
    gap_type: str
    prompt_section: str
    evaluation_rule: str
    summary: str
    suggested_fix: str | None = None


class PromptGapAnalysisSection(ReportSectionBase):
    type: Literal["prompt_gap_analysis"] = "prompt_gap_analysis"
    data: list[PromptGapItem]


class CalloutSectionData(CamelModel):
    message: str
    tone: str = "info"


class CalloutSection(ReportSectionBase):
    type: Literal["callout"] = "callout"
    data: CalloutSectionData


PlatformReportSection = Annotated[
    SummaryCardsSection
    | NarrativeSection
    | MetricBreakdownSection
    | DistributionChartSection
    | ComplianceTableSection
    | FrictionAnalysisSection
    | HeatmapSection
    | EntitySlicesSection
    | FlagsSection
    | IssuesRecommendationsSection
    | ExemplarsSection
    | PromptGapAnalysisSection
    | CalloutSection,
    Field(discriminator="type"),
]
