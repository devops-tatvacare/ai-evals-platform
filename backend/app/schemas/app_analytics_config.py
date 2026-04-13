"""Typed reporting/analytics config embedded under app config."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.schemas.base import CamelModel


AnalyticsSectionType = Literal[
    "summary_cards",
    "narrative",
    "metric_breakdown",
    "distribution_chart",
    "compliance_table",
    "friction_analysis",
    "heatmap",
    "entity_slices",
    "flags",
    "issues_recommendations",
    "exemplars",
    "prompt_gap_analysis",
    "callout",
]


class AnalyticsSectionConfig(CamelModel):
    id: str
    type: AnalyticsSectionType
    title: str | None = None
    description: str | None = None
    variant: str = "default"
    printable: bool = True


class AnalyticsExportConfig(CamelModel):
    enabled: bool = False
    format: Literal["pdf"] = "pdf"
    document_variant: str = "default"
    section_ids: list[str] = Field(default_factory=list)


class AnalyticsSummaryConfig(CamelModel):
    enabled: bool = False
    section_ids: list[str] = Field(default_factory=list)


class AnalyticsCapabilities(CamelModel):
    single_run_report: bool = False
    cross_run_analytics: bool = False
    cross_run_ai_summary: bool = False
    pdf_export: bool = False


class AnalyticsCompositionConfig(CamelModel):
    sections: list[AnalyticsSectionConfig] = Field(default_factory=list)
    export: AnalyticsExportConfig = Field(default_factory=AnalyticsExportConfig)
    ai_summary: AnalyticsSummaryConfig = Field(default_factory=AnalyticsSummaryConfig)


class AnalyticsAssetKeys(CamelModel):
    prompt_references_key: str | None = None
    narrative_template_key: str | None = None
    glossary_key: str | None = None


class AppAnalyticsConfig(CamelModel):
    profile: str = ""
    capabilities: AnalyticsCapabilities = Field(default_factory=AnalyticsCapabilities)
    single_run: AnalyticsCompositionConfig = Field(default_factory=AnalyticsCompositionConfig)
    cross_run: AnalyticsCompositionConfig = Field(default_factory=AnalyticsCompositionConfig)
    assets: AnalyticsAssetKeys = Field(default_factory=AnalyticsAssetKeys)
    semantic_model: dict[str, Any] | None = None
