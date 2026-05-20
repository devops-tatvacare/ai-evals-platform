"""Generic reportId-driven narrative execution."""

from __future__ import annotations

from typing import Any

from app.services.reports.contracts.cross_run_narrative import (
    CrossRunNarrativePattern,
    CrossRunNarrativeRecommendation,
    PlatformCrossRunNarrative,
)
from app.services.reports.contracts.report_sections import PlatformReportSection
from app.services.reports.contracts.run_narrative import PlatformRunNarrative
from app.services.reports.narrative_prompt_builders import (
    build_cross_run_narrative_prompt,
    build_run_narrative_prompt,
)


def _select_sections(
    sections: list[PlatformReportSection],
    section_ids: list[str],
) -> list[PlatformReportSection]:
    if not section_ids:
        return sections
    allowed = set(section_ids)
    return [section for section in sections if section.id in allowed]


def _single_run_narrative_payload(result: dict[str, Any]) -> PlatformRunNarrative:
    # CamelModel.model_json_schema() emits camelCase property names (because
    # alias_generator=to_camel is set on the base), and that schema is what
    # llm.generate_json passes to the model. The LLM therefore returns keys
    # like `executiveSummary` / `promptGaps`. Earlier the mapper looked up
    # snake_case keys (`executive_summary`, `top_issues`, `prompt_gaps`) and
    # silently fell back to defaults, producing artifacts with an empty
    # executiveSummary and empty promptGaps arrays. `model_validate` uses
    # Pydantic's alias-aware loader (CamelModel sets populate_by_name=True
    # so both camelCase aliases and snake_case field names are accepted),
    # which is the right boundary for "untrusted JSON from an LLM" — no
    # per-field copy needed, and it works whether the LLM returns
    # camelCase, snake_case, or a mix.
    return PlatformRunNarrative.model_validate(result)


def _cross_run_narrative_payload(result: dict[str, Any]) -> PlatformCrossRunNarrative:
    patterns = []
    for index, item in enumerate(result.get('critical_patterns', [])):
        if isinstance(item, dict):
            patterns.append(CrossRunNarrativePattern(**item))
        else:
            patterns.append(
                CrossRunNarrativePattern(
                    title=f'Pattern {index + 1}',
                    summary=str(item),
                    affected_runs=0,
                )
            )

    recommendations = []
    for index, item in enumerate(result.get('strategic_recommendations', [])):
        if isinstance(item, dict):
            recommendations.append(CrossRunNarrativeRecommendation(**item))
        else:
            recommendations.append(
                CrossRunNarrativeRecommendation(
                    priority=f'P{min(index, 2)}',
                    action=str(item),
                    expected_impact='',
                )
            )

    return PlatformCrossRunNarrative(
        executive_summary=result.get('executive_summary', ''),
        trend_analysis=result.get('trend_analysis', ''),
        critical_patterns=patterns,
        strategic_recommendations=recommendations,
    )


def _issues_recommendations_from_run_narrative(payload: PlatformRunNarrative) -> dict[str, Any]:
    return {
        'issues': [
            {
                'title': item.title,
                'area': item.area,
                'priority': item.severity,
                'summary': item.summary,
            }
            for item in payload.issues
        ],
        'recommendations': [
            {
                'priority': item.priority,
                'title': item.area,
                'action': item.action,
                'expectedImpact': item.rationale,
            }
            for item in payload.recommendations
        ],
    }


def _issues_recommendations_from_cross_run_narrative(payload: PlatformCrossRunNarrative) -> dict[str, Any]:
    return {
        'issues': [
            {
                'title': item.title,
                'area': item.title,
                'priority': 'P1',
                'summary': item.summary,
            }
            for item in payload.critical_patterns
        ],
        'recommendations': [
            {
                'priority': item.priority,
                'title': item.priority,
                'action': item.action,
                'expectedImpact': item.expected_impact,
            }
            for item in payload.strategic_recommendations
        ],
    }


async def execute_narrative_generation(
    *,
    llm,
    report_id: str,
    report_kind: str,
    metadata,
    sections: list[PlatformReportSection],
    narrative_config: dict[str, Any],
) -> dict[str, Any]:
    del report_id

    if not narrative_config.get('enabled'):
        return {}

    selected_sections = _select_sections(
        sections,
        list((narrative_config.get('inputSelection') or {}).get('sectionIds') or []),
    )
    resolved_assets = narrative_config.get('resolvedAssets') or {}
    prompt_references = resolved_assets.get('promptReferences') or {}
    system_prompt = resolved_assets.get('systemPrompt')
    output_insertion_points = list(narrative_config.get('outputInsertionPoints') or [])

    if report_kind == 'single_run':
        prompt = build_run_narrative_prompt(
            metadata=metadata,
            sections=selected_sections,
            prompt_references=prompt_references,
        )
        result = await llm.generate_json(
            prompt=prompt,
            system_prompt=system_prompt,
            json_schema=PlatformRunNarrative.model_json_schema(),
        )
        payload = _single_run_narrative_payload(result)
        prompt_gaps_payload = [
            {
                'gapType': item.gap_type,
                'promptSection': item.prompt_section,
                'evaluationRule': item.evaluation_rule,
                'summary': item.suggested_fix,
                'suggestedFix': item.suggested_fix,
            }
            for item in payload.prompt_gaps
        ]
        issues_payload = _issues_recommendations_from_run_narrative(payload)
    else:
        prompt = build_cross_run_narrative_prompt(
            metadata=metadata,
            sections=selected_sections,
        )
        result = await llm.generate_json(
            prompt=prompt,
            system_prompt=system_prompt,
            json_schema=PlatformCrossRunNarrative.model_json_schema(),
        )
        payload = _cross_run_narrative_payload(result)
        prompt_gaps_payload = []
        issues_payload = _issues_recommendations_from_cross_run_narrative(payload)

    inserted_payloads: dict[str, Any] = {}
    payload_data = payload.model_dump(by_alias=True)
    for section_id in output_insertion_points:
        lowered = section_id.lower()
        if 'narrative' in lowered:
            inserted_payloads[section_id] = payload_data
        elif 'prompt-gap' in lowered or 'prompt_gaps' in lowered:
            inserted_payloads[section_id] = prompt_gaps_payload
        elif 'issue' in lowered or 'recommendation' in lowered:
            inserted_payloads[section_id] = issues_payload
        elif 'overview' in lowered or 'callout' in lowered:
            inserted_payloads[section_id] = {
                'message': payload.executive_summary,
                'tone': 'info',
            }

    return inserted_payloads
