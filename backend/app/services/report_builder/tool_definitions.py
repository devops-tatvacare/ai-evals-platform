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
        "name": "blueprint_blocks",
        "description": (
            "Returns the available blueprint blocks for report composition. "
            "Optionally scopes to the current app or a specific block type."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app_id": {
                    "type": "string",
                    "description": "Optional application identifier to filter supported blocks.",
                },
                "block_type": {
                    "type": "string",
                    "description": "Optional block type to inspect in detail.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "blueprint_compose",
        "description": (
            "Validates a proposed analytics blueprint and returns a preview-ready payload. "
            "Call this when you have a candidate blueprint to show the user."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Human-readable blueprint name.",
                },
                "sections": {
                    "type": "array",
                    "description": "Ordered list of blueprint sections.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "description": "Unique section identifier (e.g. 'custom-compliance').",
                            },
                            "type": {
                                "type": "string",
                                "description": "Section type key from the block catalog.",
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
                        "required": ["type", "title"],
                    },
                },
            },
            "required": ["name", "sections"],
        },
    },
    {
        "name": "blueprint_save",
        "description": (
            "Persists the current blueprint as a reusable single-run report template. "
            "Only call this when the user explicitly confirms they want to save."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Human-readable name for the saved blueprint.",
                },
                "sections": {
                    "type": "array",
                    "description": "Finalized ordered list of blueprint sections.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "type": {"type": "string"},
                            "title": {"type": "string"},
                            "variant": {"type": "string"},
                        },
                        "required": ["type", "title"],
                    },
                },
            },
            "required": ["name", "sections"],
        },
    },
    {
        "name": "blueprint_list",
        "description": (
            "Lists saved analytics blueprints for the current app. Use this to browse "
            "existing templates before creating a new one."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app_id": {
                    "type": "string",
                    "description": "Optional application identifier (e.g. 'kaira-bot', 'inside-sales').",
                },
            },
            "required": [],
        },
    },
]

# ── Discovery tools ───────────────────────────────────────────────────

CATALOG_TOOLS: list[dict[str, Any]] = [
    {
        "name": "catalog_inspect",
        "description": (
            "Inspect live schema metadata for one table or column. Returns column types, nullability, "
            "defaults, primary key info, indexes, and parsed PostgreSQL column comments."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Allowed table name to inspect.",
                },
                "column": {
                    "type": "string",
                    "description": "Optional column name. Omit to inspect the whole table.",
                },
            },
            "required": ["table"],
        },
    },
    {
        "name": "catalog_relations",
        "description": (
            "Inspect foreign-key relationships for a table. Use this before joining tables to understand "
            "join paths and cardinality direction."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Allowed table name to inspect.",
                },
            },
            "required": ["table"],
        },
    },
    {
        "name": "catalog_values",
        "description": (
            "Look up distinct values for a concrete column or JSONB expression on an allowed table. "
            "Use this to resolve exact statuses, names, types, and other entity values before analysis."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Allowed table name to query.",
                },
                "column": {
                    "type": "string",
                    "description": "Column name or supported JSONB expression such as context->>'agent'.",
                },
                "search": {
                    "type": "string",
                    "description": "Optional case-insensitive search filter.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum values to return (default 20, max 100).",
                },
            },
            "required": ["table", "column"],
        },
    },
    {
        "name": "catalog_sample",
        "description": (
            "Fetch sample rows from an allowed table. For JSONB columns, returns detected key structure, "
            "leaf types, and representative sample values."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Allowed table name to sample.",
                },
                "column": {
                    "type": "string",
                    "description": "Optional column name. Provide a JSONB column to inspect nested structure.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum rows to sample (default 5, max 25).",
                },
            },
            "required": ["table"],
        },
    },
]

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

# ── Raw evidence and entity resolution tools ───────────────────────────

EVIDENCE_TOOLS: list[dict[str, Any]] = [
    {
        "name": "resolve_entity",
        "description": (
            "Resolve a partial ID or name to the exact canonical value configured for this app. "
            "Use this before analytics or raw evidence retrieval when the user provides a short "
            "run ID, thread ID, item ID, run name, or similar entity reference."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_type": {
                    "type": "string",
                    "description": "Configured entity type to resolve, such as 'run_id', 'thread_id', 'item_id', or 'run_name'.",
                },
                "search": {
                    "type": "string",
                    "description": "The partial ID or search text to resolve.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max matches to return (default 10, max 25).",
                },
            },
            "required": ["entity_type", "search"],
        },
    },
    {
        "name": "get_surface_records",
        "description": (
            "Retrieve raw evidence records from a configured data surface such as logs, thread "
            "evaluations, adversarial case results, or raw run records. Use this for forensic "
            "questions like 'what happened in thread X', 'show the logs', or cancelled/partial "
            "runs where analytics facts may be missing."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "surface_key": {
                    "type": "string",
                    "description": "Surface key from the app manifest. One of: {{surface_keys}}.",
                },
                "entity_type": {
                    "type": "string",
                    "description": "Optional entity type used to filter the surface, such as 'thread_id' or 'run_id'.",
                },
                "entity_value": {
                    "type": "string",
                    "description": "Optional canonical entity value to filter on. Resolve partial values first when needed.",
                },
                "run_id": {
                    "type": "string",
                    "description": "Optional run ID or short prefix to scope the surface query.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max records to return (default surface limit, max 25).",
                },
            },
            "required": ["surface_key"],
        },
    },
]

# ── Semantic Analytics (replaces fixed data explorer tools) ──────────

ANALYTICS_TOOLS: list[dict[str, Any]] = [
    {
        "name": "data_check",
        "description": (
            "Check whether matching data exists before running a heavier analytical query. "
            "Use this when the question depends on a table plus concrete filters, especially to "
            "confirm row availability, date coverage, or entity/filter combinations."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Canonical catalog-table name from the app manifest. One of: {{catalog_tables}}.",
                },
                "filters": {
                    "type": "object",
                    "description": "Exact filters to apply for the existence check. Values must be concrete, not speculative.",
                    "additionalProperties": True,
                },
            },
            "required": ["table"],
        },
    },
    {
        "name": "data_query",
        "description": (
            "Answer analytical questions about the application's data. "
            "This tool generates and executes a safe SQL query from a natural-language question and "
            "returns rows, deterministic result warnings, structured column metadata, and chart suggestions. "
            "Use it for aggregations, trends, comparisons, breakdowns, and filtered analysis."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": (
                        "The analytical question to answer, in plain English. "
                        "Be specific about the metric, grouping, filters, entities, and time range. "
                        "Examples: 'Show weekly pass rate for the last 8 weeks', "
                        "'Compare status by agent for failed runs', "
                        "'Break down rule violations by category this month'."
                    ),
                }
            },
            "required": ["question"],
        },
    },
]

# ── Registry ─────────────────────────────────────────────────────────

CAPABILITY_TOOLS: dict[str, list[dict[str, Any]]] = {
    "catalog": CATALOG_TOOLS,
    "discovery": DISCOVERY_TOOLS,
    "evidence": EVIDENCE_TOOLS,
    "report_builder": REPORT_BUILDER_TOOLS,
    "analytics": ANALYTICS_TOOLS,
    # Deprecated: fixed data explorer tools, kept for reference
}

# Default capabilities when App.config.chat.capabilities is not set
DEFAULT_CAPABILITIES = ["catalog", "discovery", "analytics", "evidence", "report_builder"]


def resolve_tools(
    capabilities: list[str] | None = None,
    *,
    app_id: str | None = None,
) -> list[dict[str, Any]]:
    """Resolve tool definitions for a set of capabilities.

    When ``app_id`` is given, every tool description is rendered through
    ``fill_tool_description`` so that manifest tokens like ``{{catalog_tables}}``
    and ``{{surface_keys}}`` become the real per-app vocabulary.
    Without ``app_id`` the raw templated strings are returned (kept for the
    module-level ``TOOLS`` export and for callers that haven't migrated yet).
    """
    caps = capabilities if capabilities else DEFAULT_CAPABILITIES
    tools: list[dict[str, Any]] = []
    seen: set[str] = set()
    for cap in caps:
        for tool in CAPABILITY_TOOLS.get(cap, []):
            if tool["name"] not in seen:
                tools.append(tool)
                seen.add(tool["name"])
    if app_id is not None:
        from app.services.chat_engine.tool_description_generator import fill_tool_description
        tools = [fill_tool_description(t, app_id=app_id) for t in tools]
    return tools


# Backwards compat — flat list of all tools + name set (raw, un-substituted)
TOOLS = resolve_tools()
TOOL_NAMES = {tool["name"] for tool in TOOLS}
