"""
Static catalog of canonical report section types.
Provides descriptions, capabilities, and variant hints for LLM tool calls.
No app-specific names — purely generic section type metadata.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SectionTypeEntry:
    """One canonical section type in the catalog."""

    key: str
    label: str
    description: str
    use_when: str
    data_shape: str
    known_variants: list[str] = field(default_factory=list)


SECTION_CATALOG: list[SectionTypeEntry] = [
    SectionTypeEntry(
        key="summary_cards",
        label="Summary Cards",
        description="Key metrics displayed as stat cards (e.g., health score, total items, error count).",
        use_when="The user wants a high-level numeric overview at the top of the report.",
        data_shape="Array of {key, label, value, tone, subtitle?}",
    ),
    SectionTypeEntry(
        key="narrative",
        label="AI Narrative",
        description="LLM-generated executive summary, issue analysis, and recommendations in prose form.",
        use_when="The user wants an AI-written assessment of the evaluation run.",
        data_shape="Object with executiveSummary, issues[], recommendations[], exemplars[], promptGaps[]",
    ),
    SectionTypeEntry(
        key="metric_breakdown",
        label="Metric Breakdown",
        description="Bar chart of scored metrics with values, max values, and color-coded thresholds.",
        use_when="The user wants to see individual metric scores with visual progress bars.",
        data_shape="Array of {key, label, value, maxValue, unit?, tone}",
    ),
    SectionTypeEntry(
        key="distribution_chart",
        label="Verdict Distributions",
        description="Stacked horizontal bars showing how items were classified across verdict categories (e.g., pass/fail/critical).",
        use_when="The user wants to see verdict breakdowns, classification distributions, or histogram-style data.",
        data_shape="Array of series {label, categories[], values[]}",
    ),
    SectionTypeEntry(
        key="compliance_table",
        label="Compliance Table",
        description="Pass/fail table for rules or gates with severity dots, progress bars, rates, and co-failure patterns.",
        use_when="The user wants to see rule compliance, gate pass rates, or policy adherence.",
        data_shape="Array of {key, label, section?, passed, failed, rate, severity?} + coFailures[]",
    ),
    SectionTypeEntry(
        key="friction_analysis",
        label="Friction Analysis",
        description="Conversation friction breakdown: total turns, cause split (bot/user), recovery quality, avg turns by verdict, and top friction patterns.",
        use_when="The user wants to understand where conversations get stuck or inefficient.",
        data_shape="Object with totalFrictionTurns, byCause{}, recoveryQuality{}, avgTurnsByVerdict{}, topPatterns[]",
    ),
    SectionTypeEntry(
        key="exemplars",
        label="Exemplar Items",
        description="Best and worst examples with AI analysis, transcripts, rule violations, and friction details.",
        use_when="The user wants to see representative good and bad examples with full detail.",
        data_shape="Array of {itemId, label, score?, summary, details{transcript, ruleViolations, ...}}",
    ),
    SectionTypeEntry(
        key="prompt_gap_analysis",
        label="Prompt Gap Analysis",
        description="Gaps between production prompts and evaluation rules — underspec, silent, leakage, conflicting — with suggested fixes.",
        use_when="The user wants to find where prompts don't match what evaluation rules expect.",
        data_shape="Array of {gapType, promptSection, evaluationRule, summary, suggestedFix?}",
    ),
    SectionTypeEntry(
        key="issues_recommendations",
        label="Issues & Recommendations",
        description="Priority-grouped issues and actionable recommendations with projected impact estimates.",
        use_when="The user wants a prioritized list of problems and what to do about them.",
        data_shape="Object with issues[{title, area, summary, priority, affectedCount?}] and recommendations[{priority, title, action, expectedImpact?}]",
    ),
    SectionTypeEntry(
        key="heatmap",
        label="Heatmap",
        description="2D grid with color-coded cells (rows × columns) for cross-dimensional analysis.",
        use_when="The user wants to compare entities across multiple dimensions visually.",
        data_shape="Object with columns[], rows[{label, cells[{value, tone}]}]",
    ),
    SectionTypeEntry(
        key="entity_slices",
        label="Entity Performance",
        description="Per-entity cards or heatmap showing individual performance with summary stats and dimension breakdown.",
        use_when="The user wants to compare agents, models, or other entities side by side.",
        data_shape="Array of {entityId, label, summary{}, details{}}",
    ),
    SectionTypeEntry(
        key="flags",
        label="Behavioral Flags",
        description="Flag tracking table showing behavioral signals and outcome conversion rates.",
        use_when="The user wants to track binary/outcome flags like escalations, meetings, purchases.",
        data_shape="Array of {key, label, relevant, present, notRelevant?, attempted?, accepted?}",
    ),
    SectionTypeEntry(
        key="callout",
        label="Callout Box",
        description="Highlighted message box with a tone (info, warning, success, danger).",
        use_when="The user wants to draw attention to a specific message or status.",
        data_shape="Object with {message, tone}",
    ),
]

_CATALOG_BY_KEY = {entry.key: entry for entry in SECTION_CATALOG}


def get_section_type(key: str) -> SectionTypeEntry | None:
    return _CATALOG_BY_KEY.get(key)


def list_section_types() -> list[dict]:
    """Compact list for LLM context — minimal tokens."""
    return [
        {
            "key": entry.key,
            "label": entry.label,
            "description": entry.description,
            "use_when": entry.use_when,
        }
        for entry in SECTION_CATALOG
    ]


def get_section_detail(key: str) -> dict | None:
    """Full detail for one section type — called on demand."""
    entry = _CATALOG_BY_KEY.get(key)
    if not entry:
        return None
    return {
        "key": entry.key,
        "label": entry.label,
        "description": entry.description,
        "use_when": entry.use_when,
        "data_shape": entry.data_shape,
        "known_variants": entry.known_variants,
    }
