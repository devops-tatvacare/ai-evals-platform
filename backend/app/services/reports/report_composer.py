"""Shared canonical report composition helpers."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.schemas.app_analytics_config import AnalyticsSectionConfig
from app.services.reports.config_models import PresentationSectionConfig
from app.services.reports.contracts.cross_run_report import (
    PlatformCrossRunMetadata,
    PlatformCrossRunPayload,
)
from app.services.reports.contracts.print_document import PlatformReportDocument
from app.services.reports.contracts.report_sections import (
    CalloutSection,
    ComplianceTableSection,
    DistributionChartSection,
    EntitySlicesSection,
    ExemplarsSection,
    FlagsSection,
    FrictionAnalysisSection,
    HeatmapSection,
    InsightPanelsSection,
    IssuesRecommendationsSection,
    MetricBreakdownSection,
    NarrativeSection,
    PlatformReportSection,
    PromptGapAnalysisSection,
    SummaryCardsSection,
    TrendChartSection,
)
from app.services.reports.contracts.run_report import (
    PlatformReportMetadata,
    PlatformReportPresentation,
    PlatformRunReportPayload,
)


_SECTION_MODEL_BY_TYPE = {
    'summary_cards': SummaryCardsSection,
    'narrative': NarrativeSection,
    'metric_breakdown': MetricBreakdownSection,
    'distribution_chart': DistributionChartSection,
    'compliance_table': ComplianceTableSection,
    'friction_analysis': FrictionAnalysisSection,
    'heatmap': HeatmapSection,
    'entity_slices': EntitySlicesSection,
    'flags': FlagsSection,
    'issues_recommendations': IssuesRecommendationsSection,
    'exemplars': ExemplarsSection,
    'prompt_gap_analysis': PromptGapAnalysisSection,
    'callout': CalloutSection,
    'trend_chart': TrendChartSection,
    'insight_panels': InsightPanelsSection,
}


def build_section(
    config: AnalyticsSectionConfig | PresentationSectionConfig,
    data: Any,
) -> PlatformReportSection:
    component_id = getattr(config, 'component_id', None) or getattr(config, 'type')
    section_id = getattr(config, 'section_id', None) or getattr(config, 'id')
    model_cls = _SECTION_MODEL_BY_TYPE[component_id]
    title = config.title or section_id.replace('-', ' ').replace('_', ' ').title()
    if isinstance(data, dict) and 'data' in data:
        extra = {k: v for k, v in data.items() if k != 'data'}
        return model_cls(
            id=section_id,
            title=title,
            description=config.description,
            variant=config.variant,
            data=data['data'],
            **extra,
        )
    return model_cls(
        id=section_id,
        title=title,
        description=config.description,
        variant=config.variant,
        data=data,
    )


def compose_sections(
    section_configs: list[AnalyticsSectionConfig | PresentationSectionConfig],
    section_payloads: Mapping[str, Any],
) -> list[PlatformReportSection]:
    """Compose sections, resolving payloads by section_id first, then falling
    back to the section's component type. The fallback is what makes
    user-authored blueprints (Sherlock ``summary-cards``/``narrative``/... ids)
    render against app payloads whose canonical ids are namespaced (e.g.
    ``voice-rx-summary``). ``_serialize_section_payloads`` mirrors the data
    into both id- and type-keyed entries for this lookup.
    """
    sections: list[PlatformReportSection] = []
    for config in section_configs:
        section_id = getattr(config, 'section_id', None) or getattr(config, 'id')
        payload = section_payloads.get(section_id)
        if payload is None:
            component_id = getattr(config, 'component_id', None) or getattr(config, 'type', None)
            if component_id:
                payload = section_payloads.get(component_id)
        if payload is None:
            continue
        sections.append(build_section(config, payload))
    return sections


def index_sections(
    sections: list[PlatformReportSection],
) -> dict[str, PlatformReportSection]:
    return {section.id: section for section in sections}


def compose_run_report(
    metadata: PlatformReportMetadata,
    section_configs: list[AnalyticsSectionConfig | PresentationSectionConfig],
    section_payloads: Mapping[str, Any],
    export_document: PlatformReportDocument,
    presentation: PlatformReportPresentation | None = None,
) -> PlatformRunReportPayload:
    return PlatformRunReportPayload(
        metadata=metadata,
        presentation=presentation or PlatformReportPresentation(),
        sections=compose_sections(section_configs, section_payloads),
        export_document=export_document,
    )


def compose_cross_run_report(
    metadata: PlatformCrossRunMetadata,
    section_configs: list[AnalyticsSectionConfig | PresentationSectionConfig],
    section_payloads: Mapping[str, Any],
    export_document: PlatformReportDocument | None = None,
) -> PlatformCrossRunPayload:
    return PlatformCrossRunPayload(
        metadata=metadata,
        sections=compose_sections(section_configs, section_payloads),
        export_document=export_document,
    )
