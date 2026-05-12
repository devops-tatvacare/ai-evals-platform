"""Sherlock Workbench — curated semantic catalog (Cortex Analyst shape).

This is the load-bearing contract the data_specialist writes SQL against,
and the only structure the bouncer + granularity graph trust.

It is intentionally separate from the legacy ``manifest.py`` types: the
manifest tracks every physical column + chart-contract taxonomy, while
the workbench catalog is the *curated* surface (facts / aggregates /
selected dimensions) the LLM is allowed to reach for. The two surfaces
are cross-checked at boot — physical columns referenced from the
catalog must exist in the matching manifest, derived columns must
declare their source expression and source table.

Cortex-shape primitives:
  WorkbenchCatalog
   ├ tables: dict[name, WorkbenchTable]
   │    ├ physical_primary_key (always required)
   │    ├ tenant_scoped_unique_key (optional — for fact tables whose
   │    │     business identity is a sync_run-scoped tuple)
   │    ├ analytical_grain (always required — drives the graph)
   │    ├ dimensions / time_dimensions / facts: list[LogicalColumn]
   │    └ metrics: list[Metric]
   ├ relationships: list[Relationship]  (many_to_one / one_to_one only — see granularity_graph)
   └ verified_queries: list[VerifiedQuery]  (≥ 3 required — workbench retrieval source)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SEMANTIC_MODELS_DIR = Path(__file__).parent / "semantic_models"


# ── Enumerations ──────────────────────────────────────────────────


TableKind = Literal["fact", "aggregate", "dimension"]
DataType = Literal["quantitative", "temporal", "ordinal", "nominal", "boolean", "geo"]
JoinType = Literal["inner", "left", "right", "full"]
RelationshipType = Literal[
    "many_to_one", "one_to_one", "one_to_many", "many_to_many"
]


class WorkbenchCatalogError(ValueError):
    """Raised when a workbench semantic-model YAML is structurally invalid."""


# ── Pydantic models ────────────────────────────────────────────────


class BaseTableRef(BaseModel):
    """Physical address of the catalog table — schema-qualified Postgres."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    database: str | None = None
    schema_: str = Field(default="public", alias="schema")
    table: str

    @model_validator(mode="after")
    def _table_not_empty(self) -> "BaseTableRef":
        if not self.table.strip():
            raise ValueError("base_table.table must be non-empty")
        return self


class KeyDef(BaseModel):
    """A declared key: physical primary, tenant-scoped unique, or analytical grain.

    Plan §1: keep these three concepts explicit so we never collapse
    "row identity in Postgres" with "the unit the LLM is allowed to count".
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    columns: list[str]

    @field_validator("columns")
    @classmethod
    def _non_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("key columns[] must be non-empty")
        if len(v) != len({c.lower() for c in v}):
            raise ValueError(f"key columns[] has duplicate names: {v!r}")
        return v


class LogicalColumn(BaseModel):
    """A column the LLM sees — either a passthrough or a derived expression.

    Derived (JSONB extracts, casts, arithmetic): ``expr`` differs from
    ``name`` and ``source_table`` is required so the manifest cross-check
    can resolve the physical origin.
    Passthrough: ``expr == name`` (or omitted, identity-resolves).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str
    expr: str | None = None
    data_type: DataType | None = None
    physical_type: str | None = None
    description: str | None = None
    is_enum: bool = False
    sample_values: list[Any] = Field(default_factory=list)
    # Only meaningful for derived columns whose expr extracts from a JSONB
    # column on a *different-grain* parent. For Phase 1 we keep this
    # optional; derived columns inside the same table set the field
    # implicitly (validator infers it).
    source_table: str | None = None
    # Optional pre-aggregation flag — useful for catalog-side hints.
    pre_aggregated: bool = False

    @model_validator(mode="after")
    def _enum_requires_samples(self) -> "LogicalColumn":
        if self.is_enum and not self.sample_values:
            raise ValueError(
                f"logical column {self.name!r}: is_enum=True requires non-empty sample_values"
            )
        return self

    @property
    def is_derived(self) -> bool:
        if self.expr is None:
            return False
        expr = self.expr.strip()
        # Same identifier → identity passthrough.
        if expr == self.name:
            return False
        # Quoted identifier passthrough.
        if expr.lower() == f'"{self.name.lower()}"':
            return False
        return True

    def effective_expr(self) -> str:
        return self.expr if self.expr is not None else self.name


class Metric(BaseModel):
    """A canonical aggregation expression bound to a table."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str
    expr: str
    description: str | None = None


class RelationshipColumn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    left_column: str
    right_column: str


class Relationship(BaseModel):
    """Declared join between two catalog tables.

    Cortex-shape: cardinality is part of the contract, not inferred.
    The granularity graph treats ``many_to_one`` (and ``one_to_one``) as
    "safe" edges; ``one_to_many`` is the same edge inverted; ``many_to_many``
    is rejected at validation time because it always indicates a missing
    bridge table.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str
    left_table: str
    right_table: str
    relationship_columns: list[RelationshipColumn]
    join_type: JoinType = "inner"
    relationship_type: RelationshipType

    @field_validator("relationship_columns")
    @classmethod
    def _non_empty_cols(cls, v: list[RelationshipColumn]) -> list[RelationshipColumn]:
        if not v:
            raise ValueError("relationship.relationship_columns must be non-empty")
        return v

    @model_validator(mode="after")
    def _no_many_to_many(self) -> "Relationship":
        if self.relationship_type == "many_to_many":
            raise ValueError(
                f"relationship {self.name!r}: many_to_many is not allowed "
                f"— declare a bridge table and two many_to_one edges instead"
            )
        return self


class VerifiedQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str
    question: str
    sql: str

    @field_validator("sql")
    @classmethod
    def _sql_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("verified_query.sql must be non-empty")
        return v


class WorkbenchTable(BaseModel):
    """One curated table in the workbench."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str
    table_kind: TableKind
    base_table: BaseTableRef
    description: str | None = None

    physical_primary_key: KeyDef
    tenant_scoped_unique_key: KeyDef | None = None
    analytical_grain: KeyDef

    dimensions: list[LogicalColumn] = Field(default_factory=list)
    time_dimensions: list[LogicalColumn] = Field(default_factory=list)
    facts: list[LogicalColumn] = Field(default_factory=list)
    metrics: list[Metric] = Field(default_factory=list)

    @model_validator(mode="after")
    def _no_duplicate_logical_names(self) -> "WorkbenchTable":
        seen: set[str] = set()
        for col in (*self.dimensions, *self.time_dimensions, *self.facts):
            if (col.physical_type or "").lower() == "jsonb":
                raise ValueError(
                    f"table {self.name!r}: raw JSONB column {col.name!r} "
                    "cannot be exposed as a logical column; declare specific "
                    "derived extracts instead"
                )
            key = col.name.lower()
            if key in seen:
                raise ValueError(
                    f"table {self.name!r}: duplicate logical column name {col.name!r}"
                )
            seen.add(key)
        metric_seen: set[str] = set()
        for m in self.metrics:
            if m.name.lower() in metric_seen:
                raise ValueError(
                    f"table {self.name!r}: duplicate metric name {m.name!r}"
                )
            metric_seen.add(m.name.lower())
        return self

    def all_logical_columns(self) -> list[LogicalColumn]:
        return [*self.dimensions, *self.time_dimensions, *self.facts]

    def logical_column(self, name: str) -> LogicalColumn | None:
        lower = name.lower()
        for c in self.all_logical_columns():
            if c.name.lower() == lower:
                return c
        return None

    @property
    def qualified_table(self) -> str:
        return f"{self.base_table.schema_}.{self.base_table.table}"


class WorkbenchCatalog(BaseModel):
    """One curated catalog per app."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str
    description: str | None = None
    custom_instructions: str | None = None
    module_custom_instructions: dict[str, str] = Field(default_factory=dict)
    tables: dict[str, WorkbenchTable]
    relationships: list[Relationship] = Field(default_factory=list)
    verified_queries: list[VerifiedQuery] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_internal_consistency(self) -> "WorkbenchCatalog":
        # 1. Each table's name attr matches its dict key.
        for key, table in self.tables.items():
            if table.name != key:
                raise ValueError(
                    f"table key {key!r} does not match table.name {table.name!r}"
                )
        # 2. Every relationship references declared tables and columns.
        known_tables = set(self.tables.keys())
        for rel in self.relationships:
            for side, t_name in (("left", rel.left_table), ("right", rel.right_table)):
                if t_name not in known_tables:
                    raise ValueError(
                        f"relationship {rel.name!r}: {side}_table {t_name!r} "
                        f"is not a declared catalog table"
                    )
            left_table = self.tables[rel.left_table]
            right_table = self.tables[rel.right_table]
            for pair in rel.relationship_columns:
                if not _column_known(left_table, pair.left_column):
                    raise ValueError(
                        f"relationship {rel.name!r}: left column "
                        f"{rel.left_table}.{pair.left_column} is not a declared "
                        f"logical column or part of the physical key"
                    )
                if not _column_known(right_table, pair.right_column):
                    raise ValueError(
                        f"relationship {rel.name!r}: right column "
                        f"{rel.right_table}.{pair.right_column} is not a declared "
                        f"logical column or part of the physical key"
                    )
        # 3. Analytical grain columns must resolve to declared logical
        #    columns (passthroughs) or to physical PK columns.
        for table in self.tables.values():
            for col in table.analytical_grain.columns:
                if not _column_known(table, col):
                    raise ValueError(
                        f"table {table.name!r}: analytical_grain column {col!r} "
                        f"is not a declared logical column or physical PK column"
                    )
        # 4. Verified queries count.
        if len(self.verified_queries) < 3:
            raise ValueError(
                f"catalog {self.name!r}: needs ≥ 3 verified_queries, "
                f"got {len(self.verified_queries)}"
            )
        # 5. Verified-query names unique.
        vq_names = [v.name for v in self.verified_queries]
        if len(vq_names) != len(set(vq_names)):
            raise ValueError(
                f"catalog {self.name!r}: duplicate verified_queries names: {vq_names}"
            )
        # 6. Table table_kind invariants — fact/aggregate must have non-empty
        #    analytical grain (already enforced by KeyDef) and physical PK
        #    (required by model). Additionally, dimension tables must be
        #    referenced from at least one many_to_one edge OR carry an
        #    analytical grain that is identifying (single column == PK is
        #    sufficient). We do not enforce dimension-must-be-joined-to
        #    here to keep stand-alone identity lookups (e.g. dim_lead by id)
        #    valid.
        return self


def _column_known(table: WorkbenchTable, column: str) -> bool:
    """True iff ``column`` is a declared logical column or part of the physical PK."""
    if table.logical_column(column) is not None:
        return True
    if column.lower() in {c.lower() for c in table.physical_primary_key.columns}:
        return True
    if table.tenant_scoped_unique_key is not None and column.lower() in {
        c.lower() for c in table.tenant_scoped_unique_key.columns
    }:
        return True
    return False


# ── YAML normalization / loader ────────────────────────────────────


def _normalize_logical_column(raw: Any) -> dict[str, Any]:
    """Accept short-form ``- name_str`` entries; expand to the full schema.

    The plan's catalog skeleton uses ``dimensions: [run_name, eval_type]``
    in places — we tolerate that and treat each string as an identity
    passthrough. Anything richer must use the dict form.
    """
    if isinstance(raw, str):
        return {"name": raw, "expr": raw}
    if isinstance(raw, dict):
        out = dict(raw)
        if "name" not in out:
            raise WorkbenchCatalogError(f"logical column missing 'name': {raw!r}")
        return out
    raise WorkbenchCatalogError(f"logical column entry not str/dict: {raw!r}")


def _normalize_metric(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise WorkbenchCatalogError(f"metric entry must be a dict: {raw!r}")
    return dict(raw)


def _build_logical_columns(rows: Any) -> list[LogicalColumn]:
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise WorkbenchCatalogError(
            f"logical column list must be a YAML list, got: {type(rows).__name__}"
        )
    return [LogicalColumn(**_normalize_logical_column(r)) for r in rows]


def _build_table(name: str, raw: dict[str, Any]) -> WorkbenchTable:
    if "base_table" not in raw:
        raise WorkbenchCatalogError(
            f"table {name!r}: missing required field 'base_table'"
        )
    if "physical_primary_key" not in raw:
        raise WorkbenchCatalogError(
            f"table {name!r}: missing required field 'physical_primary_key'"
        )
    if "analytical_grain" not in raw:
        raise WorkbenchCatalogError(
            f"table {name!r}: missing required field 'analytical_grain'"
        )
    if "table_kind" not in raw:
        raise WorkbenchCatalogError(
            f"table {name!r}: missing required field 'table_kind'"
        )
    return WorkbenchTable(
        name=name,
        table_kind=raw["table_kind"],
        base_table=BaseTableRef(**raw["base_table"]),
        description=raw.get("description"),
        physical_primary_key=KeyDef(**raw["physical_primary_key"]),
        tenant_scoped_unique_key=(
            KeyDef(**raw["tenant_scoped_unique_key"])
            if raw.get("tenant_scoped_unique_key") is not None
            else None
        ),
        analytical_grain=KeyDef(**raw["analytical_grain"]),
        dimensions=_build_logical_columns(raw.get("dimensions")),
        time_dimensions=_build_logical_columns(raw.get("time_dimensions")),
        facts=_build_logical_columns(raw.get("facts")),
        metrics=[Metric(**_normalize_metric(m)) for m in (raw.get("metrics") or [])],
    )


def parse_workbench_catalog(raw: dict[str, Any]) -> WorkbenchCatalog:
    """Build a ``WorkbenchCatalog`` from the YAML mapping.

    Raises ``WorkbenchCatalogError`` on missing/malformed fields. The
    Pydantic models raise their own ``ValidationError`` for type-level
    drift; both are surfaced as ``WorkbenchCatalogError`` by the loader.
    """
    if not isinstance(raw, dict):
        raise WorkbenchCatalogError("catalog YAML root must be a mapping")
    if "name" not in raw:
        raise WorkbenchCatalogError("catalog YAML missing required field 'name'")
    if "tables" not in raw or not isinstance(raw["tables"], (list, dict)):
        raise WorkbenchCatalogError(
            "catalog YAML missing required field 'tables' (must be list or dict)"
        )

    if isinstance(raw["tables"], list):
        tables_raw = {item["name"]: item for item in raw["tables"]}
    else:
        tables_raw = raw["tables"]

    try:
        tables = {name: _build_table(name, defn) for name, defn in tables_raw.items()}
        relationships = [Relationship(**r) for r in (raw.get("relationships") or [])]
        verified_queries = [
            VerifiedQuery(**v) for v in (raw.get("verified_queries") or [])
        ]
        module_instructions = raw.get("module_custom_instructions") or {}
        if not isinstance(module_instructions, dict):
            raise WorkbenchCatalogError(
                "module_custom_instructions must be a mapping of name -> text"
            )
        return WorkbenchCatalog(
            name=raw["name"],
            description=raw.get("description"),
            custom_instructions=raw.get("custom_instructions"),
            module_custom_instructions=module_instructions,
            tables=tables,
            relationships=relationships,
            verified_queries=verified_queries,
        )
    except WorkbenchCatalogError:
        raise
    except Exception as exc:  # pydantic ValidationError or ValueError
        raise WorkbenchCatalogError(str(exc)) from exc


def load_workbench_catalog_from_path(path: Path) -> WorkbenchCatalog:
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        raise WorkbenchCatalogError(f"invalid YAML in {path}: {exc}") from exc
    return parse_workbench_catalog(raw)


# ── Cache ──────────────────────────────────────────────────────────


_CATALOG_CACHE: dict[str, WorkbenchCatalog] = {}


def load_workbench_catalog(app_id: str) -> WorkbenchCatalog | None:
    """Return the workbench catalog for ``app_id`` or ``None`` if not authored.

    Three outcomes, no silent fallback:

      1. **File does not exist** → ``None`` (app not migrated yet).
      2. **File exists, legacy shape** → ``None``. Legacy files carry a
         ``version:`` key and have no ``name:``; voice-rx and kaira-bot
         use this shape until Phase 5/6 rewrites them. ``None`` here
         means "no curated catalog yet", not "maybe broken".
      3. **File exists, workbench shape but parse fails** →
         ``WorkbenchCatalogError`` raised. A broken catalog must never
         silently bypass the bouncer.

    The boot validator runs this on every startup; any raise here
    blocks boot. Runtime callers can therefore treat ``None`` as a
    load-bearing "no catalog" signal.
    """
    if app_id in _CATALOG_CACHE:
        return _CATALOG_CACHE[app_id]
    path = SEMANTIC_MODELS_DIR / f"{app_id}.yaml"
    if not path.exists():
        return None
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        raise WorkbenchCatalogError(f"invalid YAML in {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise WorkbenchCatalogError(f"{path.name}: top-level YAML must be a mapping")
    if "version" in raw and "name" not in raw:
        # Legacy semantic-model file (pre-workbench). Phase 5/6 will
        # rewrite these to workbench shape. Not authored ≠ broken.
        return None
    catalog = parse_workbench_catalog(raw)
    _CATALOG_CACHE[app_id] = catalog
    return catalog


def has_workbench_catalog(app_id: str) -> bool:
    return load_workbench_catalog(app_id) is not None


def load_workbench_catalog_strict(app_id: str) -> WorkbenchCatalog:
    """Load and *require* a workbench catalog for ``app_id``.

    Used by the boot validator and tests where the absence of a curated
    catalog is itself a failure.
    """
    path = SEMANTIC_MODELS_DIR / f"{app_id}.yaml"
    if not path.exists():
        raise WorkbenchCatalogError(
            f"no semantic_models/{app_id}.yaml — workbench catalog required for this app"
        )
    catalog = load_workbench_catalog_from_path(path)
    _CATALOG_CACHE[app_id] = catalog
    return catalog


def _clear_catalog_cache_for_tests() -> None:
    """Drop the process-wide catalog cache. Test-only."""
    _CATALOG_CACHE.clear()


# ── Prompt-input projection ───────────────────────────────────────────


def workbench_to_prompt_inputs(
    catalog: WorkbenchCatalog,
) -> tuple[
    dict[str, Any],     # schema_context  ({tables, relations, json_structures, available_tables})
    list[str],          # allowed_tables  (catalog table names)
    list[str],          # column_role_hints
    list[dict[str, str]],  # exemplars  ([{question, sql}])
]:
    """Render the four data_specialist-prompt inputs straight from the catalog.

    The legacy ``_build_schema_context`` derives prompt data from
    ``semantic_models/<app>.yaml`` in its pre-workbench shape. Apps that
    have a curated catalog skip that path entirely and feed the prompt
    builder from this function instead — no double source of truth, no
    empty prompts.

    The structure returned matches ``build_data_specialist_prompt``'s
    ``schema_context`` / ``allowed_tables`` / ``column_role_hints`` /
    ``exemplars`` arguments exactly, so the prompt builder needs no
    change. Logical columns appear by their *logical* name (``call_opening_score``
    not ``result_detail->>'call_opening'``); raw JSONB columns and JSONB
    extraction syntax stay out of the prompt surface.
    """
    tables_payload: dict[str, dict[str, Any]] = {}
    role_hints: list[str] = []

    for table_name, table in catalog.tables.items():
        cols: list[dict[str, Any]] = []
        fact_names = {f.name for f in table.facts}
        time_names = {t.name for t in table.time_dimensions}
        for col in table.all_logical_columns():
            if (col.physical_type or "").lower() == "jsonb":
                continue
            metadata: dict[str, Any] = {}
            if col.name in fact_names:
                metadata["role"] = "measure"
            elif col.name in time_names:
                metadata["role"] = "temporal"
            else:
                metadata["role"] = "dimension"
            if col.is_enum and col.sample_values:
                metadata["allowed_values"] = list(col.sample_values)
            if col.pre_aggregated:
                metadata["pre_aggregated"] = True
                role_hints.append(
                    f"{table_name}.{col.name} is pre-aggregated; avoid summing or averaging it again."
                )
            if metadata.get("allowed_values"):
                role_hints.append(
                    f"{table_name}.{col.name} allowed values: "
                    + ", ".join(str(v) for v in metadata["allowed_values"][:8])
                )
            entry: dict[str, Any] = {
                "name": col.name,
                "description": _prompt_safe_description(col.description),
                "comment_metadata": metadata,
            }
            cols.append(entry)
        # Universal access-control columns the LLM always needs.
        for ac in ("tenant_id", "app_id"):
            cols.append({"name": ac, "comment_metadata": {"role": "dimension"}})

        tables_payload[table_name] = {
            "physical_table": table.qualified_table,
            "description": _prompt_safe_description(table.description),
            "analytical_grain": list(table.analytical_grain.columns),
            "physical_primary_key": list(table.physical_primary_key.columns),
            "columns": cols,
        }
        role_hints.append(
            f"{table_name} analytical_grain = "
            f"({', '.join(table.analytical_grain.columns)}); "
            "declared_grain must align with this."
        )

    relations = [
        {
            "name": r.name,
            "left": f"{r.left_table}.{r.relationship_columns[0].left_column}",
            "right": f"{r.right_table}.{r.relationship_columns[0].right_column}",
            "cardinality": r.relationship_type,
        }
        for r in catalog.relationships
    ]

    schema_context: dict[str, Any] = {
        "tables": tables_payload,
        "relations": relations,
        "json_structures": {},
        "available_tables": sorted(catalog.tables.keys()),
    }
    allowed_tables = sorted(catalog.tables.keys())
    exemplars = [
        {"question": v.question, "sql": v.sql}
        for v in catalog.verified_queries
        if "->" not in v.sql
    ]
    return schema_context, allowed_tables, role_hints[:30], exemplars


def _prompt_safe_description(description: str | None) -> str:
    if not description:
        return ""
    lowered = description.lower()
    if "->" in description or "jsonb" in lowered or "result_detail" in lowered:
        return ""
    return description
