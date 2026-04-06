"""Compose canonical print documents from canonical report sections."""

from __future__ import annotations

from typing import Any

from app.schemas.app_analytics_config import AnalyticsExportConfig
from app.services.reports.contracts.print_document import (
    CoverBlock,
    EntityTableBlock,
    HeatmapTableBlock,
    HeatmapTableRow,
    MetricBarItem,
    MetricBarListBlock,
    PageBreakBlock,
    PrintThemeTokenSet,
    ProseBlock,
    RecommendationListBlock,
    RecommendationListItem,
    StatGridBlock,
    StatGridItem,
    TableBlock,
    TableColumn,
    PlatformDocumentBlock,
    PlatformReportDocument,
)
from app.services.reports.contracts.report_sections import PlatformReportSection


_DEFAULT_THEME = PrintThemeTokenSet(
    accent='#2563eb',
    accent_muted='#dbeafe',
    border='#cbd5e1',
    text_primary='#0f172a',
    text_secondary='#475569',
    background='#ffffff',
)

_THEMES_BY_VARIANT: dict[str, PrintThemeTokenSet] = {
    'kaira-run-v1': PrintThemeTokenSet(
        accent='#0f766e',
        accent_muted='#99f6e4',
        border='#d1d5db',
        text_primary='#0f172a',
        text_secondary='#475569',
        background='#ffffff',
    ),
    'kaira-cross-run-v1': PrintThemeTokenSet(
        accent='#0f766e',
        accent_muted='#99f6e4',
        border='#d1d5db',
        text_primary='#0f172a',
        text_secondary='#475569',
        background='#ffffff',
    ),
    'inside-sales-run-v1': PrintThemeTokenSet(
        accent='#7c3aed',
        accent_muted='#ede9fe',
        border='#d1d5db',
        text_primary='#111827',
        text_secondary='#4b5563',
        background='#ffffff',
    ),
    'inside-sales-cross-run-v1': PrintThemeTokenSet(
        accent='#7c3aed',
        accent_muted='#ede9fe',
        border='#d1d5db',
        text_primary='#111827',
        text_secondary='#4b5563',
        background='#ffffff',
    ),
    'voice-rx-run-v1': PrintThemeTokenSet(
        accent='#dc2626',
        accent_muted='#fee2e2',
        border='#d1d5db',
        text_primary='#111827',
        text_secondary='#4b5563',
        background='#ffffff',
    ),
    'voice-rx-cross-run-v1': PrintThemeTokenSet(
        accent='#dc2626',
        accent_muted='#fee2e2',
        border='#d1d5db',
        text_primary='#111827',
        text_secondary='#4b5563',
        background='#ffffff',
    ),
}


def _theme_for_variant(document_variant: str) -> PrintThemeTokenSet:
    return _THEMES_BY_VARIANT.get(document_variant, _DEFAULT_THEME)


def _cover_metadata(metadata: dict[str, str | None]) -> dict[str, str]:
    return {key: value for key, value in metadata.items() if value}


def _format_rate(value: float | int | None) -> str:
    if value is None:
        return ''
    if 0 <= value <= 1:
        return f'{value * 100:.1f}%'
    return f'{value:.1f}%' if isinstance(value, float) else str(value)


def _render_distribution_rows(section: PlatformReportSection) -> list[dict[str, str | int | float | None]]:
    rows: list[dict[str, str | int | float | None]] = []
    for series in section.data:  # type: ignore[attr-defined]
        row: dict[str, str | int | float | None] = {'series': series.label}
        for idx, category in enumerate(series.categories):
            row[category] = series.values[idx] if idx < len(series.values) else None
        rows.append(row)
    return rows


def _render_section_blocks(section: PlatformReportSection) -> list[PlatformDocumentBlock]:
    if section.type == 'summary_cards':
        return [
            StatGridBlock(
                id=f'{section.id}-stats',
                title=section.title,
                items=[
                    StatGridItem(
                        label=item.label,
                        value=item.value,
                        tone=item.tone,
                    )
                    for item in section.data
                ],
            )
        ]

    if section.type == 'narrative':
        return [
            ProseBlock(
                id=f'{section.id}-prose',
                title=section.title,
                body=section.data.executive_summary,
            )
        ]

    if section.type == 'metric_breakdown':
        return [
            MetricBarListBlock(
                id=f'{section.id}-metrics',
                title=section.title,
                items=[
                    MetricBarItem(
                        label=item.label,
                        value=item.value,
                        max_value=item.max_value,
                        tone=item.tone,
                    )
                    for item in section.data
                ],
            )
        ]

    if section.type == 'distribution_chart':
        columns = [TableColumn(key='series', label='Series')]
        category_names: list[str] = []
        if section.data:
            category_names = list(section.data[0].categories)
            columns.extend(TableColumn(key=name, label=name) for name in category_names)
        return [
            TableBlock(
                id=f'{section.id}-distribution',
                title=section.title,
                columns=columns,
                rows=_render_distribution_rows(section),
            )
        ]

    if section.type == 'compliance_table':
        return [
            TableBlock(
                id=f'{section.id}-table',
                title=section.title,
                columns=[
                    TableColumn(key='label', label='Rule'),
                    TableColumn(key='section', label='Section'),
                    TableColumn(key='passed', label='Passed', align='right'),
                    TableColumn(key='failed', label='Failed', align='right'),
                    TableColumn(key='rate', label='Rate', align='right'),
                ],
                rows=[
                    {
                        'label': row.label,
                        'section': row.section,
                        'passed': row.passed,
                        'failed': row.failed,
                        'rate': _format_rate(row.rate),
                    }
                    for row in section.data
                ],
            )
        ]

    if section.type == 'friction_analysis':
        blocks: list[PlatformDocumentBlock] = [
            StatGridBlock(
                id=f'{section.id}-summary',
                title=section.title,
                items=[
                    StatGridItem(label='Total Friction', value=str(section.data.total_friction_turns), tone='warning'),
                    StatGridItem(
                        label='Bot Caused',
                        value=str(section.data.by_cause.get('bot', 0)),
                        tone='negative' if section.data.by_cause.get('bot', 0) else 'neutral',
                    ),
                    StatGridItem(
                        label='User Caused',
                        value=str(section.data.by_cause.get('user', 0)),
                        tone='neutral',
                    ),
                ],
            )
        ]
        if section.data.top_patterns:
            blocks.append(
                TableBlock(
                    id=f'{section.id}-patterns',
                    title=f'{section.title} — Top Patterns',
                    columns=[
                        TableColumn(key='description', label='Pattern'),
                        TableColumn(key='count', label='Count', align='right'),
                        TableColumn(key='examples', label='Example Threads'),
                    ],
                    rows=[
                        {
                            'description': item.description,
                            'count': item.count,
                            'examples': ', '.join(item.example_thread_ids[:3]),
                        }
                        for item in section.data.top_patterns
                    ],
                )
            )
        return blocks

    if section.type == 'heatmap':
        return [
            HeatmapTableBlock(
                id=f'{section.id}-heatmap',
                title=section.title,
                columns=section.data.columns,
                rows=[
                    HeatmapTableRow(
                        label=row.label,
                        cells=[
                            {
                                'label': cell.label,
                                'value': cell.value,
                                'tone': cell.tone,
                            }
                            for cell in row.cells
                        ],
                    )
                    for row in section.data.rows
                ],
            )
        ]

    if section.type == 'entity_slices':
        column_keys = ['label']
        for item in section.data:
            for key in item.summary.keys():
                if key not in column_keys:
                    column_keys.append(key)
        return [
            EntityTableBlock(
                id=f'{section.id}-entities',
                title=section.title,
                columns=[
                    TableColumn(key=key, label=key.replace('_', ' ').title())
                    for key in column_keys
                ],
                rows=[
                    {'label': item.label, **item.summary}
                    for item in section.data
                ],
            )
        ]

    if section.type == 'flags':
        return [
            TableBlock(
                id=f'{section.id}-flags',
                title=section.title,
                columns=[
                    TableColumn(key='label', label='Flag'),
                    TableColumn(key='relevant', label='Relevant', align='right'),
                    TableColumn(key='present', label='Present', align='right'),
                    TableColumn(key='attempted', label='Attempted', align='right'),
                    TableColumn(key='accepted', label='Accepted', align='right'),
                    TableColumn(key='notRelevant', label='Not Relevant', align='right'),
                ],
                rows=[
                    {
                        'label': item.label,
                        'relevant': item.relevant,
                        'present': item.present,
                        'attempted': item.attempted,
                        'accepted': item.accepted,
                        'notRelevant': item.not_relevant,
                    }
                    for item in section.data
                ],
            )
        ]

    if section.type == 'issues_recommendations':
        blocks: list[PlatformDocumentBlock] = []
        if section.data.issues:
            blocks.append(
                TableBlock(
                    id=f'{section.id}-issues',
                    title=f'{section.title} — Issues',
                    columns=[
                        TableColumn(key='priority', label='Priority'),
                        TableColumn(key='area', label='Area'),
                        TableColumn(key='title', label='Title'),
                        TableColumn(key='summary', label='Summary'),
                    ],
                    rows=[
                        {
                            'priority': issue.priority,
                            'area': issue.area,
                            'title': issue.title,
                            'summary': issue.summary,
                        }
                        for issue in section.data.issues
                    ],
                )
            )
        if section.data.recommendations:
            blocks.append(
                RecommendationListBlock(
                    id=f'{section.id}-recs',
                    title=f'{section.title} — Recommendations',
                    items=[
                        RecommendationListItem(
                            priority=item.priority,
                            title=item.title,
                            summary=item.action,
                        )
                        for item in section.data.recommendations
                    ],
                )
            )
        return blocks

    if section.type == 'exemplars':
        return [
            TableBlock(
                id=f'{section.id}-exemplars',
                title=section.title,
                columns=[
                    TableColumn(key='label', label='Label'),
                    TableColumn(key='score', label='Score', align='right'),
                    TableColumn(key='summary', label='Summary'),
                ],
                rows=[
                    {
                        'label': item.label,
                        'score': item.score,
                        'summary': item.summary,
                    }
                    for item in section.data
                ],
            )
        ]

    if section.type == 'prompt_gap_analysis':
        return [
            TableBlock(
                id=f'{section.id}-gaps',
                title=section.title,
                columns=[
                    TableColumn(key='gapType', label='Gap Type'),
                    TableColumn(key='promptSection', label='Prompt Section'),
                    TableColumn(key='evaluationRule', label='Evaluation Rule'),
                    TableColumn(key='summary', label='Summary'),
                ],
                rows=[
                    {
                        'gapType': item.gap_type,
                        'promptSection': item.prompt_section,
                        'evaluationRule': item.evaluation_rule,
                        'summary': item.summary,
                    }
                    for item in section.data
                ],
            )
        ]

    if section.type == 'callout':
        return [
            ProseBlock(
                id=f'{section.id}-callout',
                title=section.title,
                body=section.data.message,
            )
        ]

    return []


def compose_document(
    *,
    title: str,
    subtitle: str | None,
    metadata: dict[str, str | None],
    sections: list[PlatformReportSection],
    export_config: AnalyticsExportConfig,
    theme_tokens: dict[str, str] | None = None,
) -> PlatformReportDocument:
    section_by_id = {section.id: section for section in sections}
    selected_ids = export_config.section_ids or list(section_by_id.keys())

    blocks: list[PlatformDocumentBlock] = [
        CoverBlock(
            id='cover',
            title=title,
            subtitle=subtitle,
            metadata=_cover_metadata(metadata),
        )
    ]

    for index, section_id in enumerate(selected_ids):
        section = section_by_id.get(section_id)
        if not section:
            continue
        blocks.extend(_render_section_blocks(section))
        if index < len(selected_ids) - 1 and section.type in {'heatmap', 'entity_slices'}:
            blocks.append(PageBreakBlock(id=f'{section.id}-page-break'))

    return PlatformReportDocument(
        title=title,
        subtitle=subtitle,
        theme=_theme_for_variant(export_config.document_variant).model_copy(
            update=theme_tokens or {},
        ),
        blocks=blocks,
    )
