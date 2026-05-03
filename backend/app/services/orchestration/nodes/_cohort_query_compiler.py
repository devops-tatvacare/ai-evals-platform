"""Compile source.cohort_query config → INSERT-from-SELECT SQL + bind params.

Materializes the entry cohort directly into workflow_run_recipient_states in
one round-trip. Set algebra at the boundary; per-recipient walking downstream.

Phase 11 config (canonical):
  source_ref:           registered cohort-source key (e.g. 'crm.lead_record')
  filters:              list of {column, op, value} — column names regex-validated
  payload_fields:       list of column names to carry into payload JSONB
  lookback_hours:       optional N — adds 'lookback_column >= now() - N hours'
  lookback_column:      required when lookback_hours set
  consent_gate_channel: optional channel — adds NOT EXISTS subquery on workflow_consent_records

Phase 11 routing: ``next_node_id`` is no longer part of node config. The
engine reads the successor from the outgoing ``default`` edge in the graph
and passes it to ``compile_cohort_query``.

Phase 12: when the resolved source is a ``DatasetSource`` (DB-backed CSV
upload, ``source_ref='dataset.<uuid>'``), compilation switches to a JSONB
branch: rows live in ``orchestration.cohort_dataset_rows.payload`` and
filters become ``(src.payload->>'col')::cast`` expressions, with the cast
derived from the dataset's stored ``schema_descriptor.columns[*].type``.

Legacy config keys (``source_table`` / ``id_column`` / ``payload_columns``)
are still accepted on input — the model maps them to the canonical fields
so old saved definitions and seed JSON keep loading.

SAFETY:
  - All column names and ``schema_qualified_table`` validated against
    ``^[a-zA-Z_][a-zA-Z0-9_.]*$`` before use in raw SQL.
  - All filter values bound as named params (never interpolated).
  - tenant_id always added to WHERE clause.
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.orchestration.source_catalog import (
    CohortSource,
    DatasetSource,
    ResolvedSource,
    SourceCatalogError,
    lookup_source,
)


class CohortQueryCompileError(ValueError):
    pass


# Plain column identifiers may NOT contain dots. Dots are only legal for
# ``source_table`` (schema-qualified). Reusing one regex for both let bad
# config like ``payload_columns=['some.col']`` survive validation and emit
# ``src.some.col`` SQL — a dotted column reference confuses the planner and
# fails downstream with an opaque "column does not exist" error.
_PLAIN_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_QUALIFIED_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$")
_SUPPORTED_OPS = {"eq", "neq", "gte", "gt", "lte", "lt", "in", "not_in", "contains"}


# Schema-descriptor type → Postgres cast. Unknown types fall back to ``text``
# (safe, SQL-correct). Mirrors the inference in ``datasets/csv_importer.py``.
_DATASET_TYPE_CASTS: dict[str, str] = {
    "integer": "bigint",
    "number": "numeric",
    "boolean": "boolean",
    "datetime": "timestamptz",
    "string": "text",
}


# Column resolvers map a filter column name to the SQL expression that
# yields its value. The static branch resolves to ``src.{col}`` (bare
# column on the source table); the dataset branch resolves to
# ``(src.payload->>'col')::cast`` (JSONB extraction with a typed cast).
ColumnResolver = Callable[[str], str]


def _static_column_resolver(allowed: Optional[set[str]] = None) -> ColumnResolver:
    """Resolver for the static (CohortSource) branch — emits bare ``src.{col}``.

    ``allowed`` is reserved for future per-source allowed_filter_columns
    enforcement; today the static branch trusts the catalog + the
    field_validator on ``CohortQueryFilter.column`` for safety.
    """
    def _resolve(col: str) -> str:
        return f"src.{col}"
    return _resolve


def jsonb_column_resolver(declared_types: dict[str, str]) -> ColumnResolver:
    """Build a resolver that emits ``(src.payload->>'col')::cast``.

    ``declared_types`` is built from the dataset version's
    ``schema_descriptor.columns`` (``{name -> type}``). Unknown columns
    raise ``CohortQueryCompileError`` — that surfaces when v2 of a dataset
    drops a column that v1's workflow filters on, instead of failing
    downstream with an opaque Postgres error.
    """
    def _resolve(col: str) -> str:
        if col not in declared_types:
            raise CohortQueryCompileError(
                f"unknown filter column {col!r} "
                f"(allowed: {sorted(declared_types)})"
            )
        cast = _DATASET_TYPE_CASTS.get(declared_types[col], "text")
        return f"(src.payload->>'{col}')::{cast}"
    return _resolve


class CohortQueryFilter(BaseModel):
    column: str
    op: str
    value: Any

    @field_validator("column")
    @classmethod
    def _validate_column(cls, v: str) -> str:
        if not _PLAIN_IDENT_RE.match(v):
            raise CohortQueryCompileError(f"unsafe column name: {v!r}")
        return v

    @field_validator("op")
    @classmethod
    def _validate_op(cls, v: str) -> str:
        if v not in _SUPPORTED_OPS:
            raise CohortQueryCompileError(f"unsupported filter op: {v!r}")
        return v


class CohortQueryConfig(BaseModel):
    """Canonical Phase 11 cohort-query config.

    Either ``source_ref`` (preferred) or the legacy
    ``source_table`` + ``id_column`` pair must be provided. When both are
    given, ``source_ref`` wins and the legacy fields are ignored.
    """

    # Canonical Phase 11 selector — keyed into the source catalog.
    source_ref: Optional[str] = None
    payload_fields: list[str] = Field(default_factory=list)

    # Legacy selector — accepted for back-compat with pre-Phase-11
    # definitions. The normalization layer rewrites these to ``source_ref``
    # at publish time, but the runtime still tolerates them so old saved
    # definitions keep executing without a forced re-publish.
    source_table: Optional[str] = None
    id_column: Optional[str] = None
    payload_columns: list[str] = Field(default_factory=list)

    filters: list[CohortQueryFilter] = Field(default_factory=list)
    lookback_hours: Optional[int] = None
    lookback_column: Optional[str] = None
    consent_gate_channel: Optional[str] = None

    # Legacy authoring field — Phase 11 reads the successor from the
    # outgoing ``default`` edge instead. Accepted on input so pre-Phase-11
    # saved definitions and unit tests that construct configs directly
    # keep working; the normalizer drops it from canonical definitions.
    next_node_id: Optional[str] = None

    @field_validator("source_table")
    @classmethod
    def _validate_source(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        # Schema-qualified names like ``analytics.crm_lead_record`` are valid here.
        if not _QUALIFIED_IDENT_RE.match(v):
            raise CohortQueryCompileError(f"unsafe source_table: {v!r}")
        return v

    @field_validator("id_column", "lookback_column")
    @classmethod
    def _validate_optional_column(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not _PLAIN_IDENT_RE.match(v):
            raise CohortQueryCompileError(f"unsafe column: {v!r}")
        return v

    @field_validator("payload_columns", "payload_fields")
    @classmethod
    def _validate_payload(cls, cols: list[str]) -> list[str]:
        for c in cols:
            if not _PLAIN_IDENT_RE.match(c):
                raise CohortQueryCompileError(f"unsafe payload column: {c!r}")
        return cols

    @model_validator(mode="after")
    def _require_one_selector(self) -> "CohortQueryConfig":
        if self.source_ref is None and not (self.source_table and self.id_column):
            raise CohortQueryCompileError(
                "cohort_query config must declare 'source_ref' "
                "(or legacy 'source_table' + 'id_column' for back-compat)"
            )
        return self

    def resolve_table_and_id(self) -> tuple[str, str]:
        """Return ``(schema_qualified_table, id_column)`` honouring source_ref first.

        Static-source path only. Dataset sources never call this — the
        compiler routes them through ``_compile_dataset`` which targets
        ``orchestration.cohort_dataset_rows`` directly.
        """
        if self.source_ref is not None:
            entry = lookup_source(self.source_ref)
            if entry is None:
                raise SourceCatalogError(f"unknown source_ref: {self.source_ref!r}")
            return entry.schema_qualified_table, entry.id_column
        # back-compat path — already validated above
        assert self.source_table and self.id_column  # narrowed by model_validator
        return self.source_table, self.id_column

    def resolve_payload_columns(self) -> list[str]:
        """Effective list of columns projected into the recipient payload JSONB."""
        if self.payload_fields:
            return list(self.payload_fields)
        return list(self.payload_columns)


def _filter_to_sql(
    f: CohortQueryFilter,
    idx: int,
    *,
    column_resolver: ColumnResolver,
) -> tuple[str, dict[str, Any]]:
    """Emit ``(where_fragment, bind_params)`` for one filter.

    The column reference comes from ``column_resolver(col)`` — bare
    ``src.{col}`` for static sources, ``(src.payload->>'col')::cast`` for
    dataset sources. The op-to-operator mapping is identical in both.
    """
    bind_name = f"filter_{idx}"
    col_sql = column_resolver(f.column)
    if f.op == "eq":
        return f"{col_sql} = :{bind_name}", {bind_name: f.value}
    if f.op == "neq":
        return f"{col_sql} <> :{bind_name}", {bind_name: f.value}
    if f.op == "gte":
        return f"{col_sql} >= :{bind_name}", {bind_name: f.value}
    if f.op == "gt":
        return f"{col_sql} > :{bind_name}", {bind_name: f.value}
    if f.op == "lte":
        return f"{col_sql} <= :{bind_name}", {bind_name: f.value}
    if f.op == "lt":
        return f"{col_sql} < :{bind_name}", {bind_name: f.value}
    if f.op == "in":
        return f"{col_sql} = ANY(:{bind_name})", {bind_name: f.value}
    if f.op == "not_in":
        return f"{col_sql} <> ALL(:{bind_name})", {bind_name: f.value}
    if f.op == "contains":
        return f"{col_sql} ILIKE :{bind_name}", {bind_name: f"%{f.value}%"}
    # Unreachable — _SUPPORTED_OPS gates this at validation time.
    raise CohortQueryCompileError(f"unsupported filter op: {f.op!r}")


def compile_cohort_query(
    cfg: CohortQueryConfig,
    *,
    run_id: uuid.UUID,
    workflow_id: uuid.UUID,
    workflow_version_id: uuid.UUID,
    tenant_id: uuid.UUID,
    app_id: str,
    next_node_id: str,
    resolved_source: Optional[ResolvedSource] = None,
) -> tuple[str, dict[str, Any]]:
    """Return (sql_string, bind_params).

    ``next_node_id`` is supplied by the caller (the executor reads it from
    the outgoing ``default`` edge, not from node config — see Phase 11 §6.1).

    ``resolved_source`` is supplied by the caller after calling
    ``resolve_source(...)`` (Phase 12 / Task 5). When ``None``, the legacy
    static-only path is taken via ``cfg.resolve_table_and_id()`` — keeps
    pre-Phase-12 callers (and most unit tests) working unchanged.
    """
    if resolved_source is None:
        # Legacy entry: derive a CohortSource shim from the catalog or the
        # legacy source_table+id_column config. Dataset sources never reach
        # this branch — they require an async DB read at the call site.
        return _compile_static_legacy(
            cfg,
            run_id=run_id,
            workflow_id=workflow_id,
            workflow_version_id=workflow_version_id,
            tenant_id=tenant_id,
            app_id=app_id,
            next_node_id=next_node_id,
        )

    if isinstance(resolved_source, CohortSource):
        return _compile_static(
            cfg,
            source=resolved_source,
            run_id=run_id,
            workflow_id=workflow_id,
            workflow_version_id=workflow_version_id,
            tenant_id=tenant_id,
            app_id=app_id,
            next_node_id=next_node_id,
        )
    if isinstance(resolved_source, DatasetSource):
        return _compile_dataset(
            cfg,
            source=resolved_source,
            run_id=run_id,
            workflow_id=workflow_id,
            workflow_version_id=workflow_version_id,
            tenant_id=tenant_id,
            app_id=app_id,
            next_node_id=next_node_id,
        )
    raise CohortQueryCompileError(
        f"unknown resolved source type: {type(resolved_source).__name__}"
    )


def _compile_static_legacy(
    cfg: CohortQueryConfig,
    *,
    run_id: uuid.UUID,
    workflow_id: uuid.UUID,
    workflow_version_id: uuid.UUID,
    tenant_id: uuid.UUID,
    app_id: str,
    next_node_id: str,
) -> tuple[str, dict[str, Any]]:
    """Pre-Phase-12 static path: resolve table + id from cfg, emit SQL."""
    schema_qualified_table, id_column = cfg.resolve_table_and_id()
    return _emit_static_sql(
        cfg,
        schema_qualified_table=schema_qualified_table,
        id_column=id_column,
        run_id=run_id,
        workflow_id=workflow_id,
        workflow_version_id=workflow_version_id,
        tenant_id=tenant_id,
        app_id=app_id,
        next_node_id=next_node_id,
    )


def _compile_static(
    cfg: CohortQueryConfig,
    *,
    source: CohortSource,
    run_id: uuid.UUID,
    workflow_id: uuid.UUID,
    workflow_version_id: uuid.UUID,
    tenant_id: uuid.UUID,
    app_id: str,
    next_node_id: str,
) -> tuple[str, dict[str, Any]]:
    """Phase 12 static path: source already resolved by the caller."""
    return _emit_static_sql(
        cfg,
        schema_qualified_table=source.schema_qualified_table,
        id_column=source.id_column,
        run_id=run_id,
        workflow_id=workflow_id,
        workflow_version_id=workflow_version_id,
        tenant_id=tenant_id,
        app_id=app_id,
        next_node_id=next_node_id,
    )


def _emit_static_sql(
    cfg: CohortQueryConfig,
    *,
    schema_qualified_table: str,
    id_column: str,
    run_id: uuid.UUID,
    workflow_id: uuid.UUID,
    workflow_version_id: uuid.UUID,
    tenant_id: uuid.UUID,
    app_id: str,
    next_node_id: str,
) -> tuple[str, dict[str, Any]]:
    payload_columns = cfg.resolve_payload_columns()

    # Casts disambiguate asyncpg parameter type inference — same param used in
    # both INSERT VALUES (varchar column) and WHERE (varchar column) confuses
    # the driver into raising AmbiguousParameterError. Explicit ::text on string
    # params and ::uuid on tenant_id resolves it.
    where_parts: list[str] = ["src.tenant_id = (:tenant_id)::uuid", "src.app_id = (:app_id)::text"]
    params: dict[str, Any] = {
        "run_id": run_id,
        "workflow_id": workflow_id,
        "workflow_version_id": workflow_version_id,
        "tenant_id": tenant_id,
        "app_id": app_id,
        "next_node_id": next_node_id,
    }

    resolver = _static_column_resolver()
    for i, f in enumerate(cfg.filters):
        fragment, bind = _filter_to_sql(f, i, column_resolver=resolver)
        where_parts.append(fragment)
        params.update(bind)

    if cfg.lookback_hours is not None:
        if not cfg.lookback_column:
            raise CohortQueryCompileError("lookback_column required when lookback_hours is set")
        # lookback_hours is an int (Pydantic-validated), so embedding it directly is safe.
        where_parts.append(
            f"src.{cfg.lookback_column} >= now() - INTERVAL '{int(cfg.lookback_hours)} hours'"
        )

    if cfg.consent_gate_channel:
        where_parts.append(
            "NOT EXISTS ("
            "  SELECT 1 FROM orchestration.workflow_consent_records c"
            "  WHERE c.tenant_id = (:tenant_id)::uuid AND c.app_id = (:app_id)::text"
            f"    AND c.recipient_id = (src.{id_column})::text"
            "    AND c.channel = (:consent_channel)::text"
            "    AND c.status = 'opted_out'"
            ")"
        )
        params["consent_channel"] = cfg.consent_gate_channel

    where_clause = " AND ".join(where_parts)

    if payload_columns:
        payload_args = ", ".join(f"'{c}', src.{c}" for c in payload_columns)
        payload_expr = f"jsonb_build_object({payload_args})"
    else:
        payload_expr = "'{}'::jsonb"

    # Casts on every parameter — asyncpg deduces types from first use across
    # SELECT-list and WHERE; mixed varchar/text/uuid contexts trigger
    # AmbiguousParameterError. Explicit casts give the driver one answer.
    sql = f"""
        INSERT INTO orchestration.workflow_run_recipient_states
            (id, tenant_id, app_id, workflow_id, workflow_version_id,
             run_id, recipient_id, current_node_id, status, payload, enrolled_at)
        SELECT
            gen_random_uuid(),
            (:tenant_id)::uuid,
            (:app_id)::text,
            (:workflow_id)::uuid,
            (:workflow_version_id)::uuid,
            (:run_id)::uuid,
            src.{id_column}::text,
            (:next_node_id)::text,
            'ready',
            {payload_expr},
            now()
        FROM {schema_qualified_table} src
        WHERE {where_clause}
        ON CONFLICT (run_id, recipient_id) DO NOTHING
        RETURNING recipient_id
    """.strip()

    return sql, params


def _compile_dataset(
    cfg: CohortQueryConfig,
    *,
    source: DatasetSource,
    run_id: uuid.UUID,
    workflow_id: uuid.UUID,
    workflow_version_id: uuid.UUID,
    tenant_id: uuid.UUID,
    app_id: str,
    next_node_id: str,
) -> tuple[str, dict[str, Any]]:
    """Phase 12 dataset path: emit SQL against ``orchestration.cohort_dataset_rows``.

    Predicates compile to ``(src.payload->>'col')::cast`` via the JSONB
    column resolver. The whole row payload is carried into the recipient
    state (no per-column projection in v1) — downstream nodes pick what
    they need from ``payload``.

    v1 limitations (raised as ``CohortQueryCompileError`` if configured):
      - ``lookback_hours`` is not supported. Datetime payload values are
        stored as JSON strings; ``now() - INTERVAL`` against a string cast
        is doable but the schema-descriptor inference is the source of
        truth for "is this column a datetime", and porting the lookback
        invariant to the JSONB path is out of scope for the linchpin.
      - ``consent_gate_channel`` is not supported. The consent table joins
        on the source's natural id column, which datasets don't have a
        stable equivalent for in v1 (recipient_id is per-version).
      - ``payload_fields`` is honored only as documentation — the runtime
        always emits ``src.payload AS row_payload`` (full payload).
    """
    if cfg.lookback_hours is not None:
        raise CohortQueryCompileError(
            "lookback_hours is not supported for dataset sources in v1"
        )
    if cfg.consent_gate_channel:
        raise CohortQueryCompileError(
            "consent_gate_channel is not supported for dataset sources in v1"
        )

    declared_types: dict[str, str] = {}
    for c in source.schema_descriptor.get("columns", []):
        if not isinstance(c, dict):
            continue
        name = c.get("name")
        if not isinstance(name, str):
            continue
        declared_types[name] = c.get("type", "string") or "string"
    resolver = jsonb_column_resolver(declared_types)

    where_parts: list[str] = [
        "src.dataset_version_id = (:dataset_version_id)::uuid",
        "src.tenant_id = (:tenant_id)::uuid",
    ]
    params: dict[str, Any] = {
        "run_id": run_id,
        "workflow_id": workflow_id,
        "workflow_version_id": workflow_version_id,
        "tenant_id": tenant_id,
        "app_id": app_id,
        "next_node_id": next_node_id,
        "dataset_version_id": source.dataset_version_id,
    }

    for i, f in enumerate(cfg.filters):
        fragment, bind = _filter_to_sql(f, i, column_resolver=resolver)
        where_parts.append(fragment)
        params.update(bind)

    where_clause = " AND ".join(where_parts)

    # Full-payload projection. v1 doesn't honor cfg.payload_fields for
    # datasets — the whole row payload travels with the recipient. If a
    # downstream node needs a subset, it can read it out of `payload`.
    sql = f"""
        INSERT INTO orchestration.workflow_run_recipient_states
            (id, tenant_id, app_id, workflow_id, workflow_version_id,
             run_id, recipient_id, current_node_id, status, payload, enrolled_at)
        SELECT
            gen_random_uuid(),
            (:tenant_id)::uuid,
            (:app_id)::text,
            (:workflow_id)::uuid,
            (:workflow_version_id)::uuid,
            (:run_id)::uuid,
            src.recipient_id::text,
            (:next_node_id)::text,
            'ready',
            src.payload,
            now()
        FROM orchestration.cohort_dataset_rows src
        WHERE {where_clause}
        ON CONFLICT (run_id, recipient_id) DO NOTHING
        RETURNING recipient_id
    """.strip()

    return sql, params
