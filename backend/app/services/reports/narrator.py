"""AI narrative generator.

Takes aggregated report data, calls LLM, returns structured NarrativeOutput.
Uses existing llm_base.py abstraction — same provider/model as evaluation runs.
"""

import logging

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.reports.schemas import (
    ExemplarAnalysis,
    NarrativeOutput,
    PromptGap,
    Recommendation,
    TopIssue,
)
from app.services.reports.prompts.narrative_prompt import (
    ADVERSARIAL_NARRATIVE_SYSTEM_PROMPT,
    NARRATIVE_SYSTEM_PROMPT,
    build_adversarial_narrative_prompt,
    build_narrative_user_prompt,
)

logger = logging.getLogger(__name__)

# JSON schema for structured output — matches NarrativeOutput pydantic model.
NARRATIVE_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "executive_summary": {"type": "string"},
        "top_issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rank": {"type": "integer"},
                    "area": {"type": "string"},
                    "description": {"type": "string"},
                    "affected_count": {"type": "integer"},
                    "example_thread_id": {"type": ["string", "null"]},
                },
                "required": ["rank", "area", "description", "affected_count"],
            },
        },
        "exemplar_analysis": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "thread_id": {"type": "string"},
                    "type": {"type": "string", "enum": ["good", "bad"]},
                    "what_happened": {"type": "string"},
                    "why": {"type": "string"},
                    "prompt_gap": {"type": ["string", "null"]},
                },
                "required": ["thread_id", "type", "what_happened", "why"],
            },
        },
        "prompt_gaps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "prompt_section": {"type": "string"},
                    "eval_rule": {"type": "string"},
                    "gap_type": {
                        "type": "string",
                        "enum": ["UNDERSPEC", "SILENT", "LEAKAGE", "CONFLICTING"],
                    },
                    "description": {"type": "string"},
                    "suggested_fix": {"type": "string"},
                },
                "required": [
                    "prompt_section",
                    "eval_rule",
                    "gap_type",
                    "description",
                    "suggested_fix",
                ],
            },
        },
        "recommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "priority": {"type": "string", "enum": ["P0", "P1", "P2"]},
                    "area": {"type": "string"},
                    "action": {"type": "string"},
                    "estimated_impact": {"type": "string"},
                },
                "required": ["priority", "area", "action", "estimated_impact"],
            },
        },
    },
    "required": [
        "executive_summary",
        "top_issues",
        "exemplar_analysis",
        "prompt_gaps",
        "recommendations",
    ],
}


class ReportNarrator:
    """Generates AI narrative from aggregated report data.

    Uses the same LLM provider configured for the app's evaluations.
    Falls back gracefully if LLM call fails — report still works without narrative.
    """

    def __init__(self, provider: BaseLLMProvider):
        self.provider = provider

    async def generate(
        self,
        metadata: dict,
        health_score: dict,
        distributions: dict,
        rule_compliance: dict,
        friction: dict,
        adversarial: dict | None,
        exemplars: dict,
        production_prompts: dict,
        is_adversarial: bool = False,
    ) -> NarrativeOutput | None:
        """Generate narrative. Returns None on failure (report still valid without it)."""
        try:
            if is_adversarial:
                user_prompt = build_adversarial_narrative_prompt(
                    metadata=metadata,
                    health_score=health_score,
                    distributions=distributions,
                    rule_compliance=rule_compliance,
                    adversarial=adversarial,
                    exemplars=exemplars,
                )
                system_prompt = ADVERSARIAL_NARRATIVE_SYSTEM_PROMPT
            else:
                user_prompt = build_narrative_user_prompt(
                    metadata=metadata,
                    health_score=health_score,
                    distributions=distributions,
                    rule_compliance=rule_compliance,
                    friction=friction,
                    adversarial=adversarial,
                    exemplars=exemplars,
                    production_prompts=production_prompts,
                )
                system_prompt = NARRATIVE_SYSTEM_PROMPT

            result = await self.provider.generate_json(
                prompt=user_prompt,
                system_prompt=system_prompt,
                json_schema=NARRATIVE_JSON_SCHEMA,
            )

            return NarrativeOutput(
                executive_summary=result.get("executive_summary", ""),
                top_issues=[
                    TopIssue(**issue) for issue in result.get("top_issues", [])
                ],
                exemplar_analysis=[
                    ExemplarAnalysis(**ea)
                    for ea in result.get("exemplar_analysis", [])
                ],
                prompt_gaps=[
                    PromptGap(**pg) for pg in result.get("prompt_gaps", [])
                ],
                recommendations=[
                    Recommendation(**rec)
                    for rec in result.get("recommendations", [])
                ],
            )

        except Exception as e:
            logger.error("Report narrative generation failed: %s", e, exc_info=True)
            return None
