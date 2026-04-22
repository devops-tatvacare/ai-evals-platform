"""Phase 3 — concrete ``CapabilityPack`` for analytics.

Owns the analytics tool specs, handlers, reason codes, artifact contracts,
and description generator. Plan §6.4 enumerates the exact ownership surface:

- ``pack_id = 'analytics'``
- tool_specs: ``discover``, ``lookup``, ``resolve_entity``, ``get_surface_records``,
  ``data_check``, ``data_query``, plus the four ``catalog_*`` tools
- reason_codes: ``CG_*`` + ``SQL_*`` + entity/discovery sets
- artifact_contracts: ``analytics.chart.v1`` -> ``ChartPayload``
- artifact_extras_contracts: ``analytics.chart.v1`` -> ``ChartArtifactExtras``
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from pydantic import BaseModel

from app.services.chat_engine import reason_codes
from app.services.chat_engine.artifact import Outcome, _CapabilityPackBridge
from app.services.chat_engine.capability_pack import (
    CapabilityPack,
    TypedArgumentError,
    register_pack,
)


# ---------------------------------------------------------------------------
# Artifact-extras contract (plan §6.2.1 / §6.4)
# ---------------------------------------------------------------------------


class ChartArtifactExtras(BaseModel):
    """Outcome-shaped metadata about the chart artifact.

    Pack-internal data (rows, spec, summary) lives in ``envelope.payload``,
    never here. Phase 6 promotes this to strict egress validation.
    """

    rendered_as: str | None = None
    top_n: int | None = None


class ChartPayloadRef(BaseModel):
    """Placeholder stand-in for the full ``ChartPayload`` Pydantic model.

    Phase 6 replaces this with the real discriminated-union payload from
    ``chat_handler._build_chart_payload``. Phase 3 only needs the type
    reference to satisfy the Protocol.
    """

    kind: str


# ---------------------------------------------------------------------------
# Tool specs — raw templated strings with {{tokens}} for the generator
# ---------------------------------------------------------------------------

_CATALOG_TOOLS: list[dict[str, Any]] = [
    {
        "name": "catalog_inspect",
        "description": (
            "Inspect live schema metadata for one table or column. Returns column types, nullability, "
            "defaults, primary key info, indexes, and parsed PostgreSQL column comments.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{limitations}}"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Allowed table name to inspect.",
                },
                "column": {
                    "type": ["string", "null"],
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
            "join paths and cardinality direction.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{limitations}}"
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
            "Use this to resolve exact statuses, names, types, and other entity values before analysis.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{limitations}}"
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
                    "type": ["string", "null"],
                    "description": "Optional case-insensitive search filter.",
                },
                "limit": {
                    "type": ["integer", "null"],
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
            "leaf types, and representative sample values.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{limitations}}"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Allowed table name to sample.",
                },
                "column": {
                    "type": ["string", "null"],
                    "description": "Optional column name. Provide a JSONB column to inspect nested structure.",
                },
                "limit": {
                    "type": ["integer", "null"],
                    "description": "Maximum rows to sample (default 5, max 25).",
                },
            },
            "required": ["table"],
        },
    },
]

_DISCOVERY_TOOLS: list[dict[str, Any]] = [
    {
        "name": "discover",
        "description": (
            "Discover what data is available for the current application. "
            "Returns dimensions with sample values, metrics, time range, and data volume. "
            "Call this first for a new or unfamiliar app. Results are cached for the session.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{limitations}}"
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
            "Use this to resolve exact entity names before analyzing.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{limitations}}"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "dimension": {
                    "type": "string",
                    "description": "Dimension name from discover results.",
                },
                "search": {
                    "type": ["string", "null"],
                    "description": "Optional case-insensitive search term.",
                },
                "limit": {
                    "type": ["integer", "null"],
                    "description": "Max values to return (default 25, max 100).",
                },
            },
            "required": ["dimension"],
        },
    },
]

_EVIDENCE_TOOLS: list[dict[str, Any]] = [
    {
        "name": "resolve_entity",
        "description": (
            "Resolve a partial ID or name to the exact canonical value configured for this app. "
            "Use this before analytics or raw evidence retrieval when the user provides a short "
            "run ID, thread ID, item ID, run name, or similar entity reference.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{limitations}}"
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
                    "type": ["integer", "null"],
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
            "runs where analytics facts may be missing.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{limitations}}"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "surface_key": {
                    "type": "string",
                    "description": "Surface key from the app manifest. One of: {{surface_keys}}.",
                },
                "entity_type": {
                    "type": ["string", "null"],
                    "description": "Optional entity type used to filter the surface, such as 'thread_id' or 'run_id'.",
                },
                "entity_value": {
                    "type": ["string", "null"],
                    "description": "Optional canonical entity value to filter on. Resolve partial values first when needed.",
                },
                "run_id": {
                    "type": ["string", "null"],
                    "description": "Optional run ID or short prefix to scope the surface query.",
                },
                "limit": {
                    "type": ["integer", "null"],
                    "description": "Max records to return (default surface limit, max 25).",
                },
            },
            "required": ["surface_key"],
        },
    },
]

_ANALYTICS_TOOLS: list[dict[str, Any]] = [
    {
        "name": "data_check",
        "description": (
            "Check whether matching data exists before running a heavier analytical query. "
            "Use this when the question depends on a table plus concrete filters, especially to "
            "confirm row availability, date coverage, or entity/filter combinations.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{limitations}}"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Canonical catalog-table name from the app manifest. One of: {{catalog_tables}}.",
                },
                "filters": {
                    "type": ["string", "null"],
                    "description": (
                        "JSON-encoded object of exact filters to apply for the existence check. "
                        "Values must be concrete, not speculative. Example: "
                        "'{\"status\":\"fail\",\"agent\":\"kaira\"}'."
                    ),
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
            "returns rows, deterministic result warnings, structured column metadata, and backend-owned chart metadata. "
            "Use it for aggregations, trends, comparisons, breakdowns, and filtered analysis.\n\n"
            "{{output_schema}}\n"
            "{{reason_codes}}\n"
            "{{chart_capabilities}}\n"
            "{{limitations}}"
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

_ANALYTICS_TOOL_SPECS: list[dict[str, Any]] = (
    _CATALOG_TOOLS + _DISCOVERY_TOOLS + _EVIDENCE_TOOLS + _ANALYTICS_TOOLS
)


# ---------------------------------------------------------------------------
# Output schemas — Pydantic models used to render {{output_schema}}
# ---------------------------------------------------------------------------


class _DiscoverOutput(BaseModel):
    dimensions: list[dict[str, Any]]
    metrics: dict[str, Any]
    volume: dict[str, int]
    surfaces: list[dict[str, Any]]
    entity_types: list[str]


class _LookupOutput(BaseModel):
    dimension: str
    values: list[dict[str, Any]]


class _ResolveEntityOutput(BaseModel):
    entity_type: str
    matches: list[dict[str, Any]]


class _GetSurfaceRecordsOutput(BaseModel):
    surface_key: str
    record_count: int
    records: list[dict[str, Any]]


class _DataCheckOutput(BaseModel):
    table: str
    row_count: int


class _DataQueryOutput(BaseModel):
    row_count: int
    columns: list[dict[str, Any]]
    rows: list[dict[str, Any]]
    chart: dict[str, Any] | None = None


class _CatalogInspectOutput(BaseModel):
    table: str
    columns: list[dict[str, Any]]


class _CatalogRelationsOutput(BaseModel):
    table: str
    relations: list[dict[str, Any]]


class _CatalogValuesOutput(BaseModel):
    column: str
    values: list[dict[str, Any]]


class _CatalogSampleOutput(BaseModel):
    table: str
    sample_rows: list[dict[str, Any]]
    json_structure: dict[str, Any] | None = None


_OUTPUT_SCHEMAS: dict[str, type[BaseModel]] = {
    'discover': _DiscoverOutput,
    'lookup': _LookupOutput,
    'resolve_entity': _ResolveEntityOutput,
    'get_surface_records': _GetSurfaceRecordsOutput,
    'data_check': _DataCheckOutput,
    'data_query': _DataQueryOutput,
    'catalog_inspect': _CatalogInspectOutput,
    'catalog_relations': _CatalogRelationsOutput,
    'catalog_values': _CatalogValuesOutput,
    'catalog_sample': _CatalogSampleOutput,
}


# Attach the machine-readable ``outputSchema`` (JSON Schema) to every spec
# at module load — plan §6.3 Protocol rule: each spec MUST carry
# ``inputSchema`` AND ``outputSchema``. The Pydantic models are the source
# of truth; ``model_json_schema()`` gives the deploy-time frozen schema.
def _attach_output_schemas() -> None:
    for spec in _ANALYTICS_TOOL_SPECS:
        model = _OUTPUT_SCHEMAS.get(spec['name'])
        if model is not None:
            spec['outputSchema'] = model.model_json_schema()


_attach_output_schemas()


# Per-tool reason codes surfaced via {{reason_codes}} substitution.
_PER_TOOL_REASON_CODES: dict[str, tuple[str, ...]] = {
    'discover': ('DISCOVER_CACHE_STALE',),
    'lookup': ('ENTITY_NOT_FOUND', 'ENTITY_AMBIGUOUS'),
    'resolve_entity': ('ENTITY_NOT_FOUND', 'ENTITY_AMBIGUOUS', 'ENTITY_OUT_OF_SCOPE'),
    'get_surface_records': ('ENTITY_OUT_OF_SCOPE', 'TOOL_UNAVAILABLE'),
    'data_check': ('SQL_EXECUTION_ERROR', 'SQL_VALIDATION_FAILED'),
    'data_query': tuple(sorted(
        reason_codes.ANALYTICS_CHART_REASON_CODES
        | reason_codes.ANALYTICS_SQL_REASON_CODES
    )),
    'catalog_inspect': ('TOOL_UNAVAILABLE',),
    'catalog_relations': ('TOOL_UNAVAILABLE',),
    'catalog_values': ('TOOL_UNAVAILABLE',),
    'catalog_sample': ('TOOL_UNAVAILABLE',),
}


# Stable pack-local limitations surfaced via {{limitations}}.
_PER_TOOL_LIMITATIONS: dict[str, tuple[str, ...]] = {
    'discover': ('Session-cached; results reflect the active tenant/app scope.',),
    'lookup': ('Max 100 values returned.', 'Requires a canonical dimension name.'),
    'resolve_entity': ('Max 25 matches returned.',),
    'get_surface_records': ('Max 25 records returned.', 'Requires an allowed surface_key.'),
    'data_check': ('Filters must be concrete literal values.',),
    'data_query': (
        'SQL is generated by a constrained inner agent; only allow-listed tables are queryable.',
        'Deterministic chart gate may return an empty payload when result is not chartable.',
    ),
    'catalog_inspect': ('Limited to manifest-declared tables.',),
    'catalog_relations': ('Limited to manifest-declared tables.',),
    'catalog_values': ('Max 100 values returned.',),
    'catalog_sample': ('Max 25 rows returned.',),
}


# ---------------------------------------------------------------------------
# CapabilityPack implementation
# ---------------------------------------------------------------------------


class AnalyticsPack:
    """Concrete ``CapabilityPack`` — analytics domain.

    Phase 3 preserves the existing tool specs and handlers verbatim; only
    the plumbing changes. Description generation now runs through the
    §6.3.1 token-substitution contract. Outcome construction delegates to
    the Phase 1/2 ``_CapabilityPackBridge`` so envelope-shape logic stays
    in one place.
    """

    pack_id: str = 'analytics'
    reason_codes: frozenset[str] = reason_codes.ANALYTICS_REASON_CODES

    artifact_contracts: Mapping[str, type] = {
        'analytics.chart.v1': ChartPayloadRef,
    }
    artifact_extras_contracts: Mapping[str, type] = {
        'analytics.chart.v1': ChartArtifactExtras,
    }

    _tool_names: frozenset[str] = frozenset({
        spec['name'] for spec in _ANALYTICS_TOOL_SPECS
    })

    def __init__(self) -> None:
        self._bridge = _CapabilityPackBridge(
            pack_id=self.pack_id,
            tool_names=self._tool_names,
        )

    def tool_specs(self) -> Sequence[Mapping[str, Any]]:
        return _ANALYTICS_TOOL_SPECS

    def tool_handlers(self) -> Mapping[str, Any]:
        # Import at call-time — tool_handlers imports from chat_engine which
        # imports capability_pack which imports this module.
        from app.services.report_builder import tool_handlers as th

        return {
            'discover': th.handle_discover,
            'lookup': th.handle_lookup,
            'resolve_entity': th.handle_resolve_entity,
            'get_surface_records': th.handle_get_surface_records,
            'data_check': th.handle_data_check,
            'data_query': th.handle_data_query,
            'catalog_inspect': th.handle_catalog_inspect,
            'catalog_relations': th.handle_catalog_relations,
            'catalog_values': th.handle_catalog_values,
            'catalog_sample': th.handle_catalog_sample,
        }

    def validate_arguments(self, tool_name: str, args: Mapping[str, Any]) -> None:
        if tool_name not in self._tool_names:
            return
        # Runtime boundary validation still lives in tool_handlers
        # (``_validate_bounded_arguments``); we raise TypedArgumentError
        # only for the pack-local pre-checks that can be done statically.
        if tool_name == 'data_query':
            question = args.get('question')
            if not isinstance(question, str) or not question.strip():
                raise TypedArgumentError(
                    reason_codes.MALFORMED_ARGS,
                    'data_query requires a non-empty question.',
                )

    def describe_tools(self, app_id: str) -> Mapping[str, str]:
        from app.services.chat_engine.tool_description_generator import render_pack_tool_descriptions

        return render_pack_tool_descriptions(self, app_id=app_id)

    def build_outcome(self, tool_name: str, raw_result: Any) -> Outcome:
        if isinstance(raw_result, dict):
            return self._bridge.build_outcome(tool_name, raw_result)
        return Outcome()

    # ---- accessors used by the tool-description generator ----

    def output_schema(self, tool_name: str) -> type[BaseModel] | None:
        return _OUTPUT_SCHEMAS.get(tool_name)

    def tool_reason_codes(self, tool_name: str) -> Sequence[str]:
        return _PER_TOOL_REASON_CODES.get(tool_name, ())

    def tool_limitations(self, tool_name: str) -> Sequence[str]:
        return _PER_TOOL_LIMITATIONS.get(tool_name, ())

    # ---- Phase 4 §662: pack-owned vocabulary access ----

    def tool_vocabulary(
        self,
        app_id: str,
        semantic_model: Mapping[str, Any],
    ) -> Any:
        """Build the analytics vocabulary for one app.

        Wraps the relocated ``report_builder.analytics.vocabulary`` module
        so Harness Core and chat_handler route vocabulary access through
        the pack, not through a direct import of the module.
        """
        from app.services.report_builder.analytics.vocabulary import build_tool_vocabulary

        return build_tool_vocabulary(app_id, dict(semantic_model))

    def question_hints(
        self,
        *,
        question: str,
        app_id: str,
        semantic_model: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Pack-local question→vocabulary mapping for the outer agent prompt.

        Owns the full term-mapping analysis (dimension/column resolution,
        unresolved-term flagging, ambiguous-metric detection) so
        ``chat_handler`` never reaches around into ``tool_vocabulary``.
        """
        from app.services.report_builder.chat_handler import _compute_question_hints

        return _compute_question_hints(
            question=question,
            app_id=app_id,
            semantic_model=dict(semantic_model),
            tool_vocabulary=self.tool_vocabulary,
        )

    # ---- Phase 4 §662: pack-owned error payloads ----

    def column_error_payload(
        self,
        resolution: Any,
        *,
        preferred_table: str | None = None,
    ) -> dict[str, Any]:
        """Structured error for an unknown/ambiguous column resolution."""
        from app.services.report_builder.analytics.vocabulary import column_error_payload

        return column_error_payload(resolution, preferred_table=preferred_table)

    def dimension_error_payload(
        self,
        resolution: Any,
        vocab: Any,
    ) -> dict[str, Any]:
        """Structured error for an unknown/ambiguous dimension resolution."""
        from app.services.report_builder.analytics.vocabulary import dimension_error_payload

        return dimension_error_payload(resolution, vocab)

    def entity_type_error_payload(
        self,
        entity_type: str,
        vocab: Any,
        *,
        surface_key: str | None = None,
    ) -> dict[str, Any]:
        """Structured error for an unknown entity_type (optionally scoped to a surface)."""
        from app.services.report_builder.analytics.vocabulary import entity_type_error_payload

        return entity_type_error_payload(entity_type, vocab, surface_key=surface_key)

    # ---- Phase 4 §662 item-3: pack-owned tool-schema enums ----

    def tool_schema_enums(
        self,
        *,
        app_id: str,
        semantic_model: Mapping[str, Any],
    ) -> dict[str, list[str]]:
        """Bounded enum values for the pack's tool-arg schemas.

        Harness Core (chat_handler._resolve_tools_for_app) asks the pack
        for these strings instead of building them from the vocabulary
        module directly — keeping vocabulary ownership inside the pack.
        """
        vocab = self.tool_vocabulary(app_id, semantic_model)
        dimension_allowed = sorted(
            set(vocab.dimensions.keys()) | set(vocab.dimension_alias_index.keys())
        )
        tables = (dict(semantic_model).get('tables') or {})
        return {
            'table': sorted({t.lower() for t in tables.keys()}) if isinstance(tables, dict) else [],
            'dimension': dimension_allowed,
            'entity_type': sorted(vocab.entity_types),
            'surface_key': sorted(vocab.surfaces.keys()),
            'block_type': sorted(vocab.block_types.keys()),
        }


_ANALYTICS_PACK = AnalyticsPack()


# ---------------------------------------------------------------------------
# Module-load side effects — register with the harness
# ---------------------------------------------------------------------------


_: CapabilityPack = _ANALYTICS_PACK  # Protocol conformance check at import time
register_pack(_ANALYTICS_PACK)
