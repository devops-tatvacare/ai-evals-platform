"""
Tool registry for chat assistant function calling.
Tools are grouped by capability. The chat handler resolves which tools
to load based on App.config.chat.capabilities for the session's app.
"""
from __future__ import annotations

from typing import Any

# ── Report Builder tools ─────────────────────────────────────────────

REPORT_BUILDER_TOOLS: list[dict[str, Any]] = [
    {
        "name": "list_section_types",
        "description": (
            "Returns all available report section types with a short description "
            "and when to use each one. Call this first to understand what building "
            "blocks are available."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_section_detail",
        "description": (
            "Returns full detail for a single section type — data shape, known variants, "
            "and rendering hints. Call when you need to understand a specific section."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "section_type": {
                    "type": "string",
                    "description": "The section type key (e.g. 'compliance_table', 'exemplars').",
                },
            },
            "required": ["section_type"],
        },
    },
    {
        "name": "list_app_sections",
        "description": (
            "Returns which section types the given app currently supports, "
            "with the section IDs and variants configured in its analytics profile."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app_id": {
                    "type": "string",
                    "description": "The application identifier (e.g. 'kaira-bot', 'inside-sales').",
                },
            },
            "required": ["app_id"],
        },
    },
    {
        "name": "compose_report",
        "description": (
            "Validates a proposed report configuration and returns a preview-ready "
            "payload. The sections array defines which components appear and in what order. "
            "Call this when you have a draft report to show the user."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "report_name": {
                    "type": "string",
                    "description": "Human-readable name for this report template.",
                },
                "sections": {
                    "type": "array",
                    "description": "Ordered list of sections to include in the report.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "description": "Unique section identifier (e.g. 'custom-compliance').",
                            },
                            "type": {
                                "type": "string",
                                "description": "Section type key from the catalog.",
                            },
                            "title": {
                                "type": "string",
                                "description": "Display title for this section.",
                            },
                            "variant": {
                                "type": "string",
                                "description": "Variant hint for data selection (optional).",
                            },
                        },
                        "required": ["id", "type", "title"],
                    },
                },
            },
            "required": ["report_name", "sections"],
        },
    },
    {
        "name": "save_template",
        "description": (
            "Persists the current report configuration as a reusable template. "
            "Once saved, it appears in the report generation dropdown. "
            "Only call this when the user explicitly confirms they want to save."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "report_name": {
                    "type": "string",
                    "description": "Human-readable name for the saved template.",
                },
                "sections": {
                    "type": "array",
                    "description": "Finalized ordered list of sections.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "type": {"type": "string"},
                            "title": {"type": "string"},
                            "variant": {"type": "string"},
                        },
                        "required": ["id", "type", "title"],
                    },
                },
            },
            "required": ["report_name", "sections"],
        },
    },
]

# ── Discovery tools ───────────────────────────────────────────────────

DISCOVERY_TOOLS: list[dict[str, Any]] = [
    {
        "name": "discover",
        "description": (
            "Discover what data is available for the current application. "
            "Returns dimensions with sample values, metrics, time range, and data volume. "
            "Call this first for a new or unfamiliar app. Results are cached for the session."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "lookup",
        "description": (
            "Look up distinct values for one known dimension. "
            "Use this to resolve exact entity names before analyzing."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "dimension": {
                    "type": "string",
                    "description": "Dimension name from discover results.",
                },
                "search": {
                    "type": "string",
                    "description": "Optional case-insensitive search term.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max values to return (default 25, max 100).",
                },
            },
            "required": ["dimension"],
        },
    },
]

# ── Semantic Analytics (replaces fixed data explorer tools) ──────────

ANALYTICS_TOOLS: list[dict[str, Any]] = [
    {
        "name": "analyze",
        "description": (
            "Answer analytical questions about the application's data. "
            "This tool generates and executes a database query from a natural-language question. "
            "Use it for aggregations, trends, comparisons, breakdowns, and filtered analysis. "
            "Always prefer this tool over report-builder tools for data questions."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": (
                        "The analytical question to answer, in plain English. "
                        "Be specific about what data you want: which dimensions, "
                        "entity values, time range, filters, grouping, or comparison. Examples: "
                        "'Show volume by agent for the last 30 days', "
                        "'Compare inbound vs outbound result status', "
                        "'What categories increased the most week over week?'"
                    ),
                },
            },
            "required": ["question"],
        },
    },
    {
        "name": "render_chart",
        "description": (
            "Render an interactive chart visualization from data returned by the analyze tool. "
            "Call this AFTER analyze when the user asks for a chart, visualization, or graph. "
            "Supported chart types: bar (vertical bars for comparison), horizontal_bar (ranked lists "
            "with long labels), line (trends over time), pie (proportions/shares), stacked_bar "
            "(multi-category breakdowns). Choose the type based on the data shape and question. "
            "The x_key and y_key must match column names from the analyze result."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "chart_type": {
                    "type": "string",
                    "enum": ["bar", "horizontal_bar", "line", "pie", "stacked_bar"],
                    "description": "Chart type to render.",
                },
                "title": {
                    "type": "string",
                    "description": "Chart title displayed above the visualization.",
                },
                "x_key": {
                    "type": "string",
                    "description": "Column name for the x-axis or category labels.",
                },
                "y_key": {
                    "type": "string",
                    "description": "Column name for the y-axis values (single series). Required for bar, horizontal_bar, line, pie.",
                },
                "series_keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Column names for multiple data series (stacked_bar). Each becomes a stacked segment.",
                },
                "x_label": {
                    "type": "string",
                    "description": "Optional display label for x-axis.",
                },
                "y_label": {
                    "type": "string",
                    "description": "Optional display label for y-axis.",
                },
            },
            "required": ["chart_type", "title", "x_key"],
        },
    },
]

# ── Data Explorer tools (DEPRECATED — kept for backwards compat) ─────
# These are superseded by the 'analyze' tool which uses semantic SQL
# generation. Unplugged from the default capability set but kept in code.

_DEPRECATED_DATA_EXPLORER_TOOLS: list[dict[str, Any]] = [
    {
        "name": "query_eval_runs",
        "description": (
            "List recent evaluation runs for the current app. Returns run ID, "
            "type, status, pass rate, thread count, and date. Use this when the "
            "user asks about recent runs, trends, or wants to find a specific run."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Number of runs to return (default 10, max 50).",
                },
                "eval_type": {
                    "type": "string",
                    "description": "Filter by eval type: 'custom', 'full_evaluation', 'batch_thread', 'batch_adversarial'. Omit for all types.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_run_summary",
        "description": (
            "Get detailed summary statistics for a single evaluation run. "
            "Returns verdict distributions, pass rates, thread counts, and key metrics. "
            "Use when the user asks about a specific run's results."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {
                    "type": "string",
                    "description": "The evaluation run ID (UUID or short prefix).",
                },
            },
            "required": ["run_id"],
        },
    },
    {
        "name": "compare_runs",
        "description": (
            "Compare two evaluation runs side by side. Shows differences in "
            "pass rates, verdict distributions, and key metrics. Use when the "
            "user wants to understand what changed between runs."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id_a": {
                    "type": "string",
                    "description": "First run ID to compare.",
                },
                "run_id_b": {
                    "type": "string",
                    "description": "Second run ID to compare.",
                },
            },
            "required": ["run_id_a", "run_id_b"],
        },
    },
    {
        "name": "query_threads",
        "description": (
            "List evaluation threads from a specific run. Can filter by verdict "
            "to find failing or passing threads. Returns thread ID, correctness "
            "verdict, efficiency verdict, and intent accuracy."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {
                    "type": "string",
                    "description": "The evaluation run ID.",
                },
                "verdict": {
                    "type": "string",
                    "description": "Filter by worst_correctness verdict: 'PASS', 'SOFT FAIL', 'HARD FAIL', 'CRITICAL'. Omit for all.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Number of threads to return (default 10, max 50).",
                },
            },
            "required": ["run_id"],
        },
    },
    {
        "name": "get_app_stats",
        "description": (
            "Get aggregate statistics across all runs for the current app. "
            "Returns total runs, total threads evaluated, correctness and "
            "efficiency distributions, and average intent accuracy."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_report_section",
        "description": (
            "Get a specific pre-computed report section for an evaluation run. "
            "Available section types: compliance_table (rule pass/fail matrix), "
            "friction_analysis (friction patterns and causes), exemplars (best/worst threads), "
            "distribution_chart (verdict distributions), summary_cards (key metrics), "
            "issues_recommendations (issues and action items), prompt_gap_analysis (prompt gaps), "
            "narrative (AI-generated analysis text), metric_breakdown, flags, entity_slices. "
            "This is the most powerful tool — use it to answer detailed analytical questions."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {
                    "type": "string",
                    "description": "The evaluation run ID (UUID or short prefix).",
                },
                "section_type": {
                    "type": "string",
                    "description": (
                        "Section type to retrieve. One of: compliance_table, friction_analysis, "
                        "exemplars, distribution_chart, summary_cards, issues_recommendations, "
                        "prompt_gap_analysis, narrative, metric_breakdown, flags, entity_slices."
                    ),
                },
            },
            "required": ["run_id", "section_type"],
        },
    },
    {
        "name": "get_thread_detail",
        "description": (
            "Get detailed evaluation results for a specific thread. Returns rule outcomes "
            "(which rules passed/failed with reasons), transcript excerpt, friction turns, "
            "and efficiency analysis. Use when the user asks about a specific thread's failures "
            "or wants to understand why a thread scored poorly."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {
                    "type": "string",
                    "description": "The evaluation run ID.",
                },
                "thread_id": {
                    "type": "string",
                    "description": "The thread identifier.",
                },
            },
            "required": ["run_id", "thread_id"],
        },
    },
    {
        "name": "get_rule_compliance",
        "description": (
            "Get rule-level compliance analysis for an evaluation run. Returns each rule's "
            "pass/fail counts, compliance rate, severity classification, and co-failure "
            "patterns (rules that tend to fail together). Use this to answer 'which rules "
            "were violated most' or 'what's the compliance breakdown'."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {
                    "type": "string",
                    "description": "The evaluation run ID (UUID or short prefix).",
                },
            },
            "required": ["run_id"],
        },
    },
    {
        "name": "query_adversarial",
        "description": (
            "Get adversarial test results for an evaluation run. Returns each test case's "
            "verdict, goal flow, difficulty level, active traits, whether the goal was "
            "achieved, and turn count. Use for adversarial/red-team analysis."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {
                    "type": "string",
                    "description": "The evaluation run ID.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Number of results to return (default 20, max 50).",
                },
            },
            "required": ["run_id"],
        },
    },
    {
        "name": "get_cross_run_rule_compliance",
        "description": (
            "Aggregate rule compliance across ALL evaluation runs for the current app. "
            "Returns each rule's total passed/failed counts, overall compliance rate, and "
            "how many runs it appeared in — sorted by most violated first. "
            "Use this to answer 'which rules are most frequently violated across all evals' "
            "or 'what are the most followed rules overall'."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Max rules to return (default 20). Use a high number to see all rules.",
                },
            },
            "required": [],
        },
    },
]

# ── Registry ─────────────────────────────────────────────────────────

CAPABILITY_TOOLS: dict[str, list[dict[str, Any]]] = {
    "discovery": DISCOVERY_TOOLS,
    "report_builder": REPORT_BUILDER_TOOLS,
    "analytics": ANALYTICS_TOOLS,
    # Deprecated: fixed data explorer tools, kept for reference
    # "data_explorer": _DEPRECATED_DATA_EXPLORER_TOOLS,
}

# Default capabilities when App.config.chat.capabilities is not set
DEFAULT_CAPABILITIES = ["discovery", "analytics", "report_builder"]


def resolve_tools(capabilities: list[str] | None = None) -> list[dict[str, Any]]:
    """
    Resolve tool definitions for a set of capabilities.
    If capabilities is None or empty, uses DEFAULT_CAPABILITIES.
    """
    caps = capabilities if capabilities else DEFAULT_CAPABILITIES
    tools: list[dict[str, Any]] = []
    seen: set[str] = set()
    for cap in caps:
        for tool in CAPABILITY_TOOLS.get(cap, []):
            if tool["name"] not in seen:
                tools.append(tool)
                seen.add(tool["name"])
    return tools


# Backwards compat — flat list of all tools + name set
TOOLS = resolve_tools()
TOOL_NAMES = {tool["name"] for tool in TOOLS}
