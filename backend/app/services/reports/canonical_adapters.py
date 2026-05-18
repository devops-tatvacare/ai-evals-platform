"""Adapters from legacy report payloads to canonical reporting contracts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.schemas.app_analytics_config import AppAnalyticsConfig
from app.services.reports.contracts.cross_run_narrative import (
    CrossRunNarrativePattern,
    CrossRunNarrativeRecommendation,
    PlatformCrossRunNarrative,
)
from app.services.reports.contracts.cross_run_report import PlatformCrossRunMetadata, PlatformCrossRunPayload
from app.services.reports.contracts.run_narrative import (
    PlatformRunNarrative,
    RunNarrativeExemplar,
    RunNarrativeIssue,
    RunNarrativePromptGap,
    RunNarrativeRecommendation,
)
from app.services.reports.contracts.run_report import PlatformReportMetadata, PlatformRunReportPayload
from app.services.reports.document_composer import compose_document
from app.services.reports.report_composer import compose_cross_run_report, compose_run_report
from app.services.reports.schemas import ReportPayload
from app.services.reports.cross_run_aggregator import CrossRunAISummary, CrossRunAnalytics
from app.services.reports.inside_sales_cross_run import InsideSalesCrossRunAnalytics
from app.services.reports.inside_sales_schemas import InsideSalesReportPayload


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _severity_from_rank(rank: int) -> str:
    if rank <= 1:
        return 'critical'
    if rank <= 2:
        return 'high'
    if rank <= 4:
        return 'medium'
    return 'low'


def _rate_tone(value: float) -> str:
    if value >= 85:
        return 'positive'
    if value >= 60:
        return 'warning'
    return 'negative'


def _parse_numeric(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        normalized = value.strip().replace('%', '')
        try:
            return float(normalized)
        except ValueError:
            return 0.0
    return 0.0


def _section_map(payload: PlatformRunReportPayload) -> dict[str, Any]:
    return {section.id: section for section in payload.sections}


def _kaira_single_run_section_configs(analytics_config: AppAnalyticsConfig):
    return [
        section.model_copy(update={'type': 'friction_analysis'})
        if section.id == 'kaira-friction' and section.type == 'callout'
        else section
        for section in analytics_config.single_run.sections
    ]


def _kaira_narrative_payload(payload: ReportPayload) -> PlatformRunNarrative | None:
    if not payload.narrative:
        return None
    return PlatformRunNarrative(
        executive_summary=payload.narrative.executive_summary,
        issues=[
            RunNarrativeIssue(
                title=item.area or f'Issue {item.rank}',
                area=item.area,
                severity=_severity_from_rank(item.rank),
                summary=item.description,
            )
            for item in payload.narrative.top_issues
        ],
        recommendations=[
            RunNarrativeRecommendation(
                priority=item.priority,
                area=item.area,
                action=item.action,
                rationale=item.estimated_impact,
            )
            for item in payload.narrative.recommendations
        ],
        exemplars=[
            RunNarrativeExemplar(
                item_id=item.thread_id,
                label=f'{item.type.title()} exemplar',
                analysis=f'{item.what_happened} {item.why}'.strip(),
            )
            for item in payload.narrative.exemplar_analysis
        ],
        prompt_gaps=[
            RunNarrativePromptGap(
                gap_type=item.gap_type,
                prompt_section=item.prompt_section,
                evaluation_rule=item.eval_rule,
                suggested_fix=item.suggested_fix,
            )
            for item in payload.narrative.prompt_gaps
        ],
    )


def adapt_kaira_run_report(
    payload: ReportPayload,
    analytics_config: AppAnalyticsConfig,
) -> PlatformRunReportPayload:
    metadata = PlatformReportMetadata(
        app_id=payload.metadata.app_id,
        run_id=payload.metadata.run_id,
        run_name=payload.metadata.run_name,
        eval_type=payload.metadata.eval_type,
        created_at=payload.metadata.created_at,
        computed_at=_now_iso(),
        llm_provider=payload.metadata.llm_provider,
        llm_model=payload.metadata.llm_model,
        narrative_model=payload.metadata.narrative_model,
        cache_key=f'{payload.metadata.app_id}:{payload.metadata.run_id}:single_run',
    )

    section_payloads: dict[str, Any] = {
        'kaira-summary': [
            {
                'key': 'health-score',
                'label': 'Health Score',
                'value': f'{payload.health_score.numeric:.1f}',
                'tone': _rate_tone(payload.health_score.numeric),
                'subtitle': payload.health_score.grade,
            },
            {
                'key': 'completed',
                'label': 'Completed Threads',
                'value': str(payload.metadata.completed_threads),
                'tone': 'neutral',
            },
            {
                'key': 'errors',
                'label': 'Errors',
                'value': str(payload.metadata.error_threads),
                'tone': 'warning' if payload.metadata.error_threads else 'positive',
            },
            {
                'key': 'total',
                'label': 'Total Threads',
                'value': str(payload.metadata.total_threads),
                'tone': 'neutral',
            },
        ],
        'kaira-metrics': [
            {
                'key': 'intent-accuracy',
                'label': 'Intent Accuracy',
                'value': payload.health_score.breakdown.intent_accuracy.value,
                'maxValue': 100,
                'tone': _rate_tone(payload.health_score.breakdown.intent_accuracy.value),
            },
            {
                'key': 'correctness-rate',
                'label': 'Correctness Rate',
                'value': payload.health_score.breakdown.correctness_rate.value,
                'maxValue': 100,
                'tone': _rate_tone(payload.health_score.breakdown.correctness_rate.value),
            },
            {
                'key': 'efficiency-rate',
                'label': 'Efficiency Rate',
                'value': payload.health_score.breakdown.efficiency_rate.value,
                'maxValue': 100,
                'tone': _rate_tone(payload.health_score.breakdown.efficiency_rate.value),
            },
            {
                'key': 'task-completion',
                'label': 'Task Completion',
                'value': payload.health_score.breakdown.task_completion.value,
                'maxValue': 100,
                'tone': _rate_tone(payload.health_score.breakdown.task_completion.value),
            },
        ],
        'kaira-distributions': [
            {
                'key': 'correctness',
                'label': 'Correctness',
                'categories': list(payload.distributions.correctness.keys()),
                'values': list(payload.distributions.correctness.values()),
            },
            {
                'key': 'efficiency',
                'label': 'Efficiency',
                'categories': list(payload.distributions.efficiency.keys()),
                'values': list(payload.distributions.efficiency.values()),
            },
            {
                'key': 'intent-histogram',
                'label': 'Intent Accuracy',
                'categories': payload.distributions.intent_histogram.buckets,
                'values': payload.distributions.intent_histogram.counts,
            },
        ],
        'kaira-compliance': {
            'data': [
                {
                    'key': rule.rule_id,
                    'label': rule.rule_id,
                    'section': rule.section,
                    'passed': rule.passed,
                    'failed': rule.failed,
                    'rate': rule.rate * 100,
                    'severity': rule.severity.lower(),
                    'total': rule.passed + rule.failed,
                }
                for rule in payload.rule_compliance.rules
            ],
            'co_failures': [
                {
                    'rule_a': cf.rule_a,
                    'rule_b': cf.rule_b,
                    'co_occurrence_rate': cf.co_occurrence_rate,
                }
                for cf in payload.rule_compliance.co_failures
            ],
        },
        'kaira-friction': payload.friction.model_dump(by_alias=True),
        'kaira-exemplars': [
            {
                'itemId': exemplar.thread_id,
                'label': f'Best thread {index + 1}',
                'score': exemplar.composite_score,
                'summary': (
                    f'Correctness={exemplar.correctness_verdict or "n/a"}, '
                    f'Efficiency={exemplar.efficiency_verdict or "n/a"}, '
                    f'Task completed={exemplar.task_completed}'
                ),
                'details': {
                    'type': 'best',
                    'intentAccuracy': exemplar.intent_accuracy,
                    'correctnessVerdict': exemplar.correctness_verdict,
                    'efficiencyVerdict': exemplar.efficiency_verdict,
                    'taskCompleted': exemplar.task_completed,
                    'transcript': [message.model_dump(by_alias=True) for message in exemplar.transcript],
                    'ruleViolations': [item.model_dump(by_alias=True) for item in exemplar.rule_violations],
                    'frictionTurns': [turn.model_dump(by_alias=True) for turn in exemplar.friction_turns],
                    'goalFlow': exemplar.goal_flow,
                    'activeTraits': exemplar.active_traits,
                    'difficulty': exemplar.difficulty,
                    'failureModes': exemplar.failure_modes,
                    'reasoning': exemplar.reasoning,
                    'goalAchieved': exemplar.goal_achieved,
                },
            }
            for index, exemplar in enumerate(payload.exemplars.best)
        ] + [
            {
                'itemId': exemplar.thread_id,
                'label': f'Worst thread {index + 1}',
                'score': exemplar.composite_score,
                'summary': (
                    f'Correctness={exemplar.correctness_verdict or "n/a"}, '
                    f'Efficiency={exemplar.efficiency_verdict or "n/a"}, '
                    f'Task completed={exemplar.task_completed}'
                ),
                'details': {
                    'type': 'worst',
                    'intentAccuracy': exemplar.intent_accuracy,
                    'correctnessVerdict': exemplar.correctness_verdict,
                    'efficiencyVerdict': exemplar.efficiency_verdict,
                    'taskCompleted': exemplar.task_completed,
                    'transcript': [message.model_dump(by_alias=True) for message in exemplar.transcript],
                    'ruleViolations': [item.model_dump(by_alias=True) for item in exemplar.rule_violations],
                    'frictionTurns': [turn.model_dump(by_alias=True) for turn in exemplar.friction_turns],
                    'goalFlow': exemplar.goal_flow,
                    'activeTraits': exemplar.active_traits,
                    'difficulty': exemplar.difficulty,
                    'failureModes': exemplar.failure_modes,
                    'reasoning': exemplar.reasoning,
                    'goalAchieved': exemplar.goal_achieved,
                },
            }
            for index, exemplar in enumerate(payload.exemplars.worst)
        ],
    }

    narrative_payload = _kaira_narrative_payload(payload)
    if narrative_payload:
        section_payloads['kaira-narrative'] = narrative_payload.model_dump(by_alias=True)
        section_payloads['kaira-prompt-gaps'] = [
            {
                'gapType': gap.gap_type,
                'promptSection': gap.prompt_section,
                'evaluationRule': gap.eval_rule,
                'summary': gap.description,
                'suggestedFix': gap.suggested_fix,
            }
            for gap in payload.narrative.prompt_gaps
        ]
        section_payloads['kaira-recommendations'] = {
            'issues': [
                {
                    'title': item.area or f'Issue {item.rank}',
                    'area': item.area,
                    'priority': f'P{max(item.rank - 1, 0)}',
                    'summary': item.description,
                    'affectedCount': item.affected_count,
                }
                for item in payload.narrative.top_issues
            ],
            'recommendations': [
                {
                    'priority': item.priority,
                    'title': item.area or item.priority,
                    'action': item.action,
                    'expectedImpact': item.estimated_impact,
                }
                for item in payload.narrative.recommendations
            ],
        }

    if payload.distributions.adversarial:
        section_payloads['kaira-distributions'].append(
            {
                'key': 'adversarial',
                'label': 'Adversarial',
                'categories': list(payload.distributions.adversarial.keys()),
                'values': list(payload.distributions.adversarial.values()),
            }
        )
    if payload.adversarial:
        section_payloads['kaira-distributions'].extend(
            {
                'key': f'goal:{goal.goal}',
                'label': goal.goal,
                'categories': ['passRate'],
                'values': [goal.pass_rate * 100],
            }
            for goal in payload.adversarial.by_goal
        )
        section_payloads['kaira-distributions'].extend(
            {
                'key': f'difficulty:{item.difficulty}',
                'label': item.difficulty,
                'categories': ['passed', 'failed'],
                'values': [item.passed, max(item.total - item.passed, 0)],
            }
            for item in payload.adversarial.by_difficulty
        )

    # composition_theme: defensive pass-through. _compose_single_run_payload
    # rebuilds export_document with the same theme arg, but a future direct
    # consumer of base_payload.export_document would otherwise silently fall
    # back to the variant-keyed palette in document_composer.
    export_document = compose_document(
        title=payload.metadata.run_name or 'Evaluation Report',
        subtitle=f'{payload.metadata.app_id} single-run report',
        metadata={
            'Run ID': payload.metadata.run_id,
            'Eval Type': payload.metadata.eval_type,
            'Created': payload.metadata.created_at,
            'Model': payload.metadata.llm_model,
        },
        sections=compose_run_report(
            metadata=metadata,
            section_configs=_kaira_single_run_section_configs(analytics_config),
            section_payloads=section_payloads,
            export_document=compose_document(
                title='placeholder',
                subtitle=None,
                metadata={},
                sections=[],
                export_config=analytics_config.single_run.export,
                composition_theme=analytics_config.single_run.theme,
            ),
        ).sections,
        export_config=analytics_config.single_run.export,
        composition_theme=analytics_config.single_run.theme,
    )

    return compose_run_report(
        metadata=metadata,
        section_configs=_kaira_single_run_section_configs(analytics_config),
        section_payloads=section_payloads,
        export_document=export_document,
    )


def adapt_kaira_cross_run(
    analytics: CrossRunAnalytics,
    analytics_config: AppAnalyticsConfig,
    *,
    app_id: str,
    source_run_count: int,
    total_runs_available: int,
) -> PlatformCrossRunPayload:
    section_payloads: dict[str, Any] = {
        'kaira-cross-summary': [
            {
                'key': 'avg-health-score',
                'label': 'Average Health Score',
                'value': f'{analytics.stats.avg_health_score:.1f}',
                'tone': _rate_tone(analytics.stats.avg_health_score),
                'subtitle': analytics.stats.avg_grade,
            },
            {
                'key': 'runs-analyzed',
                'label': 'Runs Analyzed',
                'value': str(analytics.stats.total_runs),
                'tone': 'neutral',
            },
            {
                'key': 'total-threads',
                'label': 'Threads Evaluated',
                'value': str(analytics.stats.total_threads),
                'tone': 'neutral',
            },
            {
                'key': 'adversarial-pass-rate',
                'label': 'Adversarial Pass Rate',
                'value': '' if analytics.stats.adversarial_pass_rate is None else f'{analytics.stats.adversarial_pass_rate:.1f}%',
                'tone': 'positive' if (analytics.stats.adversarial_pass_rate or 0) >= 80 else 'warning',
            },
        ],
        'kaira-cross-trend': [
            {
                'key': 'avg-health-score',
                'label': 'Average Health Score',
                'value': analytics.stats.avg_health_score,
                'maxValue': 100,
                'tone': _rate_tone(analytics.stats.avg_health_score),
            }
        ] + [
            {
                'key': key,
                'label': key.replace('_', ' ').title(),
                'value': value,
                'maxValue': 100,
                'tone': _rate_tone(value),
            }
            for key, value in analytics.stats.avg_breakdown.items()
        ],
        'kaira-cross-compliance': {
            'columns': [run.run_name or run.run_id[:8] for run in analytics.rule_compliance_heatmap.runs],
            'rows': [
                {
                    'label': row.rule_id,
                    'cells': [
                        {
                            'label': row.rule_id,
                            'value': None if value is None else value * 100,
                            'tone': 'positive' if (value or 0) >= 0.85 else 'warning' if (value or 0) >= 0.6 else 'negative',
                        }
                        for value in row.cells
                    ],
                }
                for row in analytics.rule_compliance_heatmap.rows
            ],
        },
        'kaira-cross-issues': {
            'issues': [
                {
                    'title': item.area,
                    'area': item.area,
                    'priority': 'P0' if item.worst_rank <= 1 else 'P1' if item.worst_rank <= 2 else 'P2',
                    'summary': (item.descriptions[0] if item.descriptions else ''),
                }
                for item in analytics.issues_and_recommendations.issues
            ],
            'recommendations': [
                {
                    'priority': item.highest_priority,
                    'title': item.area,
                    'action': item.actions[0] if item.actions else '',
                }
                for item in analytics.issues_and_recommendations.recommendations
            ],
        },
    }
    if analytics.adversarial_heatmap:
        section_payloads['kaira-cross-adversarial'] = {
            'columns': [run.run_name or run.run_id[:8] for run in analytics.adversarial_heatmap.runs],
            'rows': [
                {
                    'label': row.goal,
                    'cells': [
                        {
                            'label': row.goal,
                            'value': None if value is None else value * 100,
                            'tone': 'positive' if (value or 0) >= 0.85 else 'warning' if (value or 0) >= 0.6 else 'negative',
                        }
                        for value in row.cells
                    ],
                }
                for row in analytics.adversarial_heatmap.rows
            ],
        }

    metadata = PlatformCrossRunMetadata(
        app_id=app_id,
        computed_at=_now_iso(),
        source_run_count=source_run_count,
        total_runs_available=total_runs_available,
        cache_key=f'{app_id}:cross_run',
    )
    return compose_cross_run_report(
        metadata=metadata,
        section_configs=analytics_config.cross_run.sections,
        section_payloads=section_payloads,
        export_document=None,
    )


def adapt_kaira_cross_run_from_runs(
    runs_data: list[tuple[dict, dict]],
    analytics_config: AppAnalyticsConfig,
    *,
    app_id: str,
    total_runs_available: int,
) -> PlatformCrossRunPayload:
    run_payloads = [
        (meta, PlatformRunReportPayload.model_validate(data))
        for meta, data in runs_data
    ]
    run_payloads.sort(key=lambda item: item[0].get('created_at', ''))

    health_scores: list[float] = []
    breakdown_values: dict[str, list[float]] = {}
    rule_rows_by_run: list[dict[str, Any]] = []
    goal_rates_by_run: list[dict[str, float]] = []
    aggregated_issues: dict[str, dict[str, Any]] = {}
    aggregated_recommendations: dict[str, dict[str, Any]] = {}
    run_labels: list[str] = []
    total_threads = 0

    for meta, payload in run_payloads:
        sections = _section_map(payload)
        run_labels.append(payload.metadata.run_name or meta.get('id', '')[:8])

        summary = sections.get('kaira-summary')
        if summary:
            cards = {card.key: card for card in summary.data}
            health = _parse_numeric(cards.get('health-score').value if cards.get('health-score') else 0)
            health_scores.append(health)
            total_threads += int(_parse_numeric(cards.get('total').value if cards.get('total') else 0))

        metrics = sections.get('kaira-metrics')
        if metrics:
            for item in metrics.data:
                breakdown_values.setdefault(item.key, []).append(item.value)

        compliance = sections.get('kaira-compliance')
        rule_map: dict[str, Any] = {}
        if compliance:
            for row in compliance.data:
                rule_map[row.key] = row
        rule_rows_by_run.append(rule_map)

        distributions = sections.get('kaira-distributions')
        goal_map: dict[str, float] = {}
        if distributions:
            for series in distributions.data:
                if series.key.startswith('goal:') and series.values:
                    goal_map[series.label] = float(series.values[0])
        goal_rates_by_run.append(goal_map)

        issues_section = sections.get('kaira-recommendations')
        if issues_section:
            for issue in issues_section.data.issues:
                key = f'{issue.area}:{issue.title}'
                bucket = aggregated_issues.setdefault(
                    key,
                    {'title': issue.title, 'area': issue.area, 'priority': issue.priority, 'summary': issue.summary, 'count': 0},
                )
                bucket['count'] += 1
            for rec in issues_section.data.recommendations:
                key = f'{rec.priority}:{rec.title}:{rec.action}'
                bucket = aggregated_recommendations.setdefault(
                    key,
                    {'priority': rec.priority, 'title': rec.title, 'action': rec.action, 'count': 0},
                )
                bucket['count'] += 1

    avg_health = sum(health_scores) / len(health_scores) if health_scores else 0
    section_payloads: dict[str, Any] = {
        'kaira-cross-summary': [
            {
                'key': 'avg-health-score',
                'label': 'Average Health Score',
                'value': f'{avg_health:.1f}',
                'tone': _rate_tone(avg_health),
            },
            {
                'key': 'runs-analyzed',
                'label': 'Runs Analyzed',
                'value': str(len(run_payloads)),
                'tone': 'neutral',
            },
            {
                'key': 'threads-evaluated',
                'label': 'Threads Evaluated',
                'value': str(total_threads),
                'tone': 'neutral',
            },
        ],
        'kaira-cross-trend': [
            {
                'key': key,
                'label': key.replace('-', ' ').replace('_', ' ').title(),
                'value': round(sum(values) / len(values), 1),
                'maxValue': 100,
                'tone': _rate_tone(round(sum(values) / len(values), 1)),
            }
            for key, values in breakdown_values.items()
            if values
        ],
        'kaira-cross-compliance': {
            'columns': run_labels,
            'rows': [],
        },
        'kaira-cross-issues': {
            'issues': sorted(
                [
                    {
                        'title': value['title'],
                        'area': value['area'],
                        'priority': value['priority'],
                        'summary': value['summary'],
                    }
                    for value in aggregated_issues.values()
                ],
                key=lambda item: (item['priority'], item['title']),
            ),
            'recommendations': sorted(
                [
                    {
                        'priority': value['priority'],
                        'title': value['title'],
                        'action': value['action'],
                    }
                    for value in aggregated_recommendations.values()
                ],
                key=lambda item: (item['priority'], item['title']),
            ),
        },
    }

    all_rule_ids = sorted({rule_id for mapping in rule_rows_by_run for rule_id in mapping.keys()})
    section_payloads['kaira-cross-compliance']['rows'] = [
        {
            'label': rule_id,
            'cells': [
                {
                    'label': rule_id,
                    'value': (rule_rows_by_run[index][rule_id].rate if rule_id in rule_rows_by_run[index] else None),
                    'tone': (
                        'positive'
                        if rule_id in rule_rows_by_run[index] and rule_rows_by_run[index][rule_id].rate >= 85
                        else 'warning'
                        if rule_id in rule_rows_by_run[index] and rule_rows_by_run[index][rule_id].rate >= 60
                        else 'negative'
                    ),
                }
                for index in range(len(rule_rows_by_run))
            ],
        }
        for rule_id in all_rule_ids
    ]

    all_goals = sorted({goal for mapping in goal_rates_by_run for goal in mapping.keys()})
    if all_goals:
        section_payloads['kaira-cross-adversarial'] = {
            'columns': run_labels,
            'rows': [
                {
                    'label': goal,
                    'cells': [
                        {
                            'label': goal,
                            'value': goal_rates_by_run[index].get(goal),
                            'tone': _rate_tone(goal_rates_by_run[index].get(goal, 0)),
                        }
                        for index in range(len(goal_rates_by_run))
                    ],
                }
                for goal in all_goals
            ],
        }

    metadata = PlatformCrossRunMetadata(
        app_id=app_id,
        computed_at=_now_iso(),
        source_run_count=len(run_payloads),
        total_runs_available=total_runs_available,
        cache_key=f'{app_id}:cross_run',
    )
    return compose_cross_run_report(
        metadata=metadata,
        section_configs=analytics_config.cross_run.sections,
        section_payloads=section_payloads,
        export_document=None,
    )


def adapt_cross_run_summary(summary: CrossRunAISummary) -> PlatformCrossRunNarrative:
    return PlatformCrossRunNarrative(
        executive_summary=summary.executive_summary,
        trend_analysis=summary.trend_analysis,
        critical_patterns=[
            CrossRunNarrativePattern(
                title=f'Pattern {index + 1}',
                summary=item,
                affected_runs=0,
            )
            for index, item in enumerate(summary.critical_patterns)
        ],
        strategic_recommendations=[
            CrossRunNarrativeRecommendation(
                priority=f'P{min(index, 2)}',
                action=item,
                expected_impact='',
            )
            for index, item in enumerate(summary.strategic_recommendations)
        ],
    )


def adapt_inside_sales_run_report(
    payload: InsideSalesReportPayload,
    analytics_config: AppAnalyticsConfig,
) -> PlatformRunReportPayload:
    metadata = PlatformReportMetadata(
        app_id=payload.metadata.app_id,
        run_id=payload.metadata.run_id,
        run_name=payload.metadata.run_name,
        eval_type=payload.metadata.eval_type,
        created_at=payload.metadata.created_at,
        computed_at=_now_iso(),
        llm_provider=payload.metadata.llm_provider,
        llm_model=payload.metadata.llm_model,
        narrative_model=payload.metadata.narrative_model,
        cache_key=f'{payload.metadata.app_id}:{payload.metadata.run_id}:single_run',
    )

    flag_items = [
        {
            'key': 'escalation',
            'label': 'Escalations',
            'relevant': payload.flag_stats.escalation.relevant,
            'present': payload.flag_stats.escalation.present,
            'notRelevant': payload.flag_stats.escalation.not_relevant,
        },
        {
            'key': 'disagreement',
            'label': 'Disagreements',
            'relevant': payload.flag_stats.disagreement.relevant,
            'present': payload.flag_stats.disagreement.present,
            'notRelevant': payload.flag_stats.disagreement.not_relevant,
        },
        {
            'key': 'meeting-setup',
            'label': 'Meeting Setup',
            'relevant': payload.flag_stats.meeting_setup.relevant,
            'present': 0,
            'attempted': payload.flag_stats.meeting_setup.attempted,
            'accepted': payload.flag_stats.meeting_setup.accepted,
            'notRelevant': payload.flag_stats.meeting_setup.not_relevant,
        },
        {
            'key': 'purchase-made',
            'label': 'Purchase Made',
            'relevant': payload.flag_stats.purchase_made.relevant,
            'present': 0,
            'attempted': payload.flag_stats.purchase_made.attempted,
            'accepted': payload.flag_stats.purchase_made.accepted,
            'notRelevant': payload.flag_stats.purchase_made.not_relevant,
        },
    ]

    section_payloads: dict[str, Any] = {
        'inside-sales-summary': [
            {
                'key': 'avg-qa-score',
                'label': 'Avg QA Score',
                'value': f'{payload.run_summary.avg_qa_score:.1f}',
                'tone': _rate_tone(payload.run_summary.avg_qa_score),
            },
            {
                'key': 'evaluated-calls',
                'label': 'Evaluated Calls',
                'value': str(payload.run_summary.evaluated_calls),
                'tone': 'neutral',
            },
            {
                'key': 'total-calls',
                'label': 'Total Calls',
                'value': str(payload.run_summary.total_calls),
                'tone': 'neutral',
            },
            {
                'key': 'compliance-pass-rate',
                'label': 'Compliance Pass Rate',
                'value': f'{payload.run_summary.compliance_pass_rate:.1f}%',
                'tone': _rate_tone(payload.run_summary.compliance_pass_rate),
            },
        ],
        'inside-sales-dimensions': [
            {
                'key': key,
                'label': dim.label,
                'value': dim.avg,
                'maxValue': dim.max_possible,
                'tone': _rate_tone(dim.avg),
            }
            for key, dim in payload.dimension_breakdown.items()
        ],
        'inside-sales-compliance': [
            {
                'key': key,
                'label': gate.label,
                'passed': gate.passed,
                'failed': gate.failed,
                'rate': (gate.passed / gate.total * 100) if gate.total else 0,
                'total': gate.total,
            }
            for key, gate in payload.compliance_breakdown.items()
        ],
        'inside-sales-flags': flag_items,
        'inside-sales-agents': [
            {
                'entityId': key,
                'label': agent.agent_name,
                'summary': {
                    'callCount': agent.call_count,
                    'avgQaScore': round(agent.avg_qa_score, 1),
                },
                'details': {
                    dim_key: round(dim.avg, 1)
                    for dim_key, dim in agent.dimensions.items()
                },
            }
            for key, agent in payload.agent_slices.items()
        ],
    }
    if payload.narrative:
        section_payloads['inside-sales-narrative'] = {
            'executiveSummary': payload.narrative.executive_summary,
            'issues': [
                {
                    'title': insight.dimension,
                    'area': insight.dimension,
                    'severity': 'medium',
                    'summary': insight.insight,
                }
                for insight in payload.narrative.dimension_insights
            ],
            'recommendations': [
                {
                    'priority': rec.priority,
                    'area': 'Coaching',
                    'action': rec.action,
                    'rationale': '',
                }
                for rec in payload.narrative.recommendations
            ],
            'exemplars': [],
            'promptGaps': [],
        }
        section_payloads['inside-sales-recommendations'] = {
            'issues': [
                {
                    'title': insight.dimension,
                    'area': insight.dimension,
                    'priority': insight.priority,
                    'summary': insight.insight,
                }
                for insight in payload.narrative.dimension_insights
            ],
            'recommendations': [
                {
                    'priority': rec.priority,
                    'title': 'Coaching Recommendation',
                    'action': rec.action,
                }
                for rec in payload.narrative.recommendations
            ],
        }

    # composition_theme: defensive pass-through. _compose_single_run_payload
    # rebuilds export_document with the same theme arg, but a future direct
    # consumer of base_payload.export_document would otherwise silently fall
    # back to the variant-keyed palette in document_composer.
    export_document = compose_document(
        title=payload.metadata.run_name or 'Inside Sales Report',
        subtitle='Inside Sales single-run report',
        metadata={
            'Run ID': payload.metadata.run_id,
            'Created': payload.metadata.created_at,
            'Model': payload.metadata.llm_model,
        },
        sections=compose_run_report(
            metadata=metadata,
            section_configs=analytics_config.single_run.sections,
            section_payloads=section_payloads,
            export_document=compose_document(
                title='placeholder',
                subtitle=None,
                metadata={},
                sections=[],
                export_config=analytics_config.single_run.export,
                composition_theme=analytics_config.single_run.theme,
            ),
        ).sections,
        export_config=analytics_config.single_run.export,
        composition_theme=analytics_config.single_run.theme,
    )
    return compose_run_report(
        metadata=metadata,
        section_configs=analytics_config.single_run.sections,
        section_payloads=section_payloads,
        export_document=export_document,
    )


def adapt_inside_sales_cross_run(
    analytics: InsideSalesCrossRunAnalytics,
    analytics_config: AppAnalyticsConfig,
    *,
    app_id: str,
    source_run_count: int,
    total_runs_available: int,
) -> PlatformCrossRunPayload:
    flag_items = []
    for key, item in analytics.flag_rollups.behavioral.items():
        flag_items.append(
            {
                'key': key,
                'label': item.label,
                'relevant': item.relevant,
                'present': item.present,
                'notRelevant': item.not_relevant,
            }
        )
    for key, item in analytics.flag_rollups.outcomes.items():
        flag_items.append(
            {
                'key': key,
                'label': item.label,
                'relevant': item.relevant,
                'present': 0,
                'attempted': item.attempted,
                'accepted': item.accepted,
                'notRelevant': item.not_relevant,
            }
        )

    section_payloads: dict[str, Any] = {
        'inside-sales-cross-summary': [
            {
                'key': 'avg-qa-score',
                'label': 'Average QA Score',
                'value': f'{analytics.stats.avg_qa_score:.1f}',
                'tone': _rate_tone(analytics.stats.avg_qa_score),
            },
            {
                'key': 'avg-compliance-rate',
                'label': 'Average Compliance Pass Rate',
                'value': f'{analytics.stats.avg_compliance_pass_rate * 100:.1f}%',
                'tone': _rate_tone(analytics.stats.avg_compliance_pass_rate * 100),
            },
            {
                'key': 'runs',
                'label': 'Runs Analyzed',
                'value': str(analytics.stats.total_runs),
                'tone': 'neutral',
            },
            {
                'key': 'calls',
                'label': 'Calls Evaluated',
                'value': str(analytics.stats.evaluated_calls),
                'tone': 'neutral',
            },
        ],
        'inside-sales-cross-dimensions': {
            'columns': [run.run_name or run.run_id[:8] for run in analytics.dimension_heatmap.runs],
            'rows': [
                {
                    'label': row.label,
                    'cells': [
                        {
                            'label': row.label,
                            'value': cell,
                            'tone': _rate_tone(cell or 0),
                        }
                        for cell in row.cells
                    ],
                }
                for row in analytics.dimension_heatmap.rows
            ],
        },
        'inside-sales-cross-compliance': {
            'columns': [run.run_name or run.run_id[:8] for run in analytics.compliance_heatmap.runs],
            'rows': [
                {
                    'label': row.label,
                    'cells': [
                        {
                            'label': row.label,
                            'value': None if cell is None else cell * 100,
                            'tone': 'positive' if (cell or 0) >= 0.85 else 'warning' if (cell or 0) >= 0.6 else 'negative',
                        }
                        for cell in row.cells
                    ],
                }
                for row in analytics.compliance_heatmap.rows
            ],
        },
        'inside-sales-cross-flags': flag_items,
        'inside-sales-cross-issues': {
            'issues': [
                {
                    'title': item.area,
                    'area': item.area,
                    'priority': 'P0' if item.worst_rank <= 1 else 'P1' if item.worst_rank <= 2 else 'P2',
                    'summary': item.descriptions[0] if item.descriptions else '',
                }
                for item in analytics.issues_and_recommendations.issues
            ],
            'recommendations': [
                {
                    'priority': item.highest_priority,
                    'title': item.area,
                    'action': item.actions[0] if item.actions else '',
                }
                for item in analytics.issues_and_recommendations.recommendations
            ],
        },
    }
    metadata = PlatformCrossRunMetadata(
        app_id=app_id,
        computed_at=_now_iso(),
        source_run_count=source_run_count,
        total_runs_available=total_runs_available,
        cache_key=f'{app_id}:cross_run',
    )
    return compose_cross_run_report(
        metadata=metadata,
        section_configs=analytics_config.cross_run.sections,
        section_payloads=section_payloads,
        export_document=None,
    )


def adapt_inside_sales_cross_run_from_runs(
    runs_data: list[tuple[dict, dict]],
    analytics_config: AppAnalyticsConfig,
    *,
    app_id: str,
    total_runs_available: int,
) -> PlatformCrossRunPayload:
    run_payloads = [
        (meta, PlatformRunReportPayload.model_validate(data))
        for meta, data in runs_data
    ]
    run_payloads.sort(key=lambda item: item[0].get('created_at', ''))

    avg_qa_scores: list[float] = []
    compliance_rates: list[float] = []
    dimension_values: dict[str, list[float]] = {}
    dimension_rows_by_run: list[dict[str, Any]] = []
    compliance_rows_by_run: list[dict[str, Any]] = []
    flag_totals: dict[str, dict[str, float]] = {}
    issue_groups: dict[str, dict[str, Any]] = {}
    recommendation_groups: dict[str, dict[str, Any]] = {}
    run_labels: list[str] = []
    total_calls = 0

    for meta, payload in run_payloads:
        sections = _section_map(payload)
        run_labels.append(payload.metadata.run_name or meta.get('id', '')[:8])

        summary = sections.get('inside-sales-summary')
        if summary:
            cards = {card.key: card for card in summary.data}
            avg_qa_scores.append(_parse_numeric(cards.get('avg-qa-score').value if cards.get('avg-qa-score') else 0))
            compliance_rates.append(_parse_numeric(cards.get('compliance-pass-rate').value if cards.get('compliance-pass-rate') else 0))
            total_calls += int(_parse_numeric(cards.get('evaluated-calls').value if cards.get('evaluated-calls') else 0))

        dimensions = sections.get('inside-sales-dimensions')
        dimension_map: dict[str, Any] = {}
        if dimensions:
            for item in dimensions.data:
                dimension_values.setdefault(item.label, []).append(item.value)
                dimension_map[item.label] = item
        dimension_rows_by_run.append(dimension_map)

        compliance = sections.get('inside-sales-compliance')
        compliance_map: dict[str, Any] = {}
        if compliance:
            for row in compliance.data:
                compliance_map[row.label] = row
        compliance_rows_by_run.append(compliance_map)

        flags = sections.get('inside-sales-flags')
        if flags:
            for item in flags.data:
                bucket = flag_totals.setdefault(
                    item.label,
                    {'relevant': 0, 'present': 0, 'attempted': 0, 'accepted': 0, 'notRelevant': 0},
                )
                bucket['relevant'] += item.relevant
                bucket['present'] += item.present
                bucket['attempted'] += item.attempted or 0
                bucket['accepted'] += item.accepted or 0
                bucket['notRelevant'] += item.not_relevant or 0

        issues = sections.get('inside-sales-recommendations')
        if issues:
            for issue in issues.data.issues:
                key = f'{issue.area}:{issue.title}'
                bucket = issue_groups.setdefault(
                    key,
                    {'title': issue.title, 'area': issue.area, 'priority': issue.priority, 'summary': issue.summary, 'count': 0},
                )
                bucket['count'] += 1
            for rec in issues.data.recommendations:
                key = f'{rec.priority}:{rec.title}:{rec.action}'
                bucket = recommendation_groups.setdefault(
                    key,
                    {'priority': rec.priority, 'title': rec.title, 'action': rec.action, 'count': 0},
                )
                bucket['count'] += 1

    section_payloads: dict[str, Any] = {
        'inside-sales-cross-summary': [
            {
                'key': 'avg-qa-score',
                'label': 'Average QA Score',
                'value': f'{(sum(avg_qa_scores) / len(avg_qa_scores)) if avg_qa_scores else 0:.1f}',
                'tone': _rate_tone((sum(avg_qa_scores) / len(avg_qa_scores)) if avg_qa_scores else 0),
            },
            {
                'key': 'avg-compliance-rate',
                'label': 'Average Compliance Pass Rate',
                'value': f'{(sum(compliance_rates) / len(compliance_rates)) if compliance_rates else 0:.1f}%',
                'tone': _rate_tone((sum(compliance_rates) / len(compliance_rates)) if compliance_rates else 0),
            },
            {
                'key': 'runs',
                'label': 'Runs Analyzed',
                'value': str(len(run_payloads)),
                'tone': 'neutral',
            },
            {
                'key': 'calls',
                'label': 'Calls Evaluated',
                'value': str(total_calls),
                'tone': 'neutral',
            },
        ],
        'inside-sales-cross-dimensions': {
            'columns': run_labels,
            'rows': [
                {
                    'label': label,
                    'cells': [
                        {
                            'label': label,
                            'value': dimension_rows_by_run[index][label].value if label in dimension_rows_by_run[index] else None,
                            'tone': _rate_tone(dimension_rows_by_run[index][label].value if label in dimension_rows_by_run[index] else 0),
                        }
                        for index in range(len(dimension_rows_by_run))
                    ],
                }
                for label in sorted(dimension_values.keys())
            ],
        },
        'inside-sales-cross-compliance': {
            'columns': run_labels,
            'rows': [
                {
                    'label': label,
                    'cells': [
                        {
                            'label': label,
                            'value': compliance_rows_by_run[index][label].rate if label in compliance_rows_by_run[index] else None,
                            'tone': (
                                'positive'
                                if label in compliance_rows_by_run[index] and compliance_rows_by_run[index][label].rate >= 85
                                else 'warning'
                                if label in compliance_rows_by_run[index] and compliance_rows_by_run[index][label].rate >= 60
                                else 'negative'
                            ),
                        }
                        for index in range(len(compliance_rows_by_run))
                    ],
                }
                for label in sorted({row for mapping in compliance_rows_by_run for row in mapping.keys()})
            ],
        },
        'inside-sales-cross-flags': [
            {
                'key': label.lower().replace(' ', '-'),
                'label': label,
                'relevant': int(values['relevant']),
                'present': int(values['present']),
                'attempted': int(values['attempted']) or None,
                'accepted': int(values['accepted']) or None,
                'notRelevant': int(values['notRelevant']) or None,
            }
            for label, values in sorted(flag_totals.items())
        ],
        'inside-sales-cross-issues': {
            'issues': [
                {
                    'title': value['title'],
                    'area': value['area'],
                    'priority': value['priority'],
                    'summary': value['summary'],
                }
                for value in issue_groups.values()
            ],
            'recommendations': [
                {
                    'priority': value['priority'],
                    'title': value['title'],
                    'action': value['action'],
                }
                for value in recommendation_groups.values()
            ],
        },
    }

    metadata = PlatformCrossRunMetadata(
        app_id=app_id,
        computed_at=_now_iso(),
        source_run_count=len(run_payloads),
        total_runs_available=total_runs_available,
        cache_key=f'{app_id}:cross_run',
    )
    return compose_cross_run_report(
        metadata=metadata,
        section_configs=analytics_config.cross_run.sections,
        section_payloads=section_payloads,
        export_document=None,
    )
