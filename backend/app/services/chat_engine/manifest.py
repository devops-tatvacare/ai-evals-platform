"""Per-app manifest: single source of truth for Sherlock's logical contract.

Loaded once at boot, validated against Postgres, then cached in-process.
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MANIFESTS_DIR = Path(__file__).parent / "manifests"

# Roadmap 01 groundwork: every catalog table has an effective Postgres
# schema. Manifests stay unqualified for Phase 1 (no ``schema:`` key in YAML),
# so unset declarations fall back to ``public`` — the only schema in use today.
# When revision 0006 moves application tables into ``platform``/``analytics``,
# manifests start declaring ``schema:`` and the same helpers route correctly.
DEFAULT_SCHEMA = "public"

ColumnRole = Literal[
    "dimension", "measure", "temporal", "ordered_categorical", "key", "identifier"
]
DataType = Literal["quantitative", "temporal", "ordinal", "nominal", "boolean", "geo"]
SemanticType = Literal[
    "pk", "fk", "category", "id_hash", "currency", "percent",
    "lat", "lon", "count", "ratio", "score", "duration", "none",
]


class ManifestValidationError(ValueError):
    """Raised when a manifest file is structurally invalid."""


class ManifestColumn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    role: ColumnRole
    type: str | None = None
    data_type: DataType | None = None
    semantic_type: SemanticType | None = None
    chartable: bool | None = None
    unit: str | None = None
    synonyms: list[str] = Field(default_factory=list)
    allowed_values: list[str | int | float | bool] = Field(default_factory=list)
    ordering: list[str | int | float | bool] = Field(default_factory=list)
    description: str | None = None
    nullable: bool | None = None
    measure_kind: Literal[
        "count", "percent", "ratio", "score", "duration_ms", "duration_s", "bytes"
    ] | None = None

    @model_validator(mode="after")
    def _measure_kind_requires_measure_role(self) -> "ManifestColumn":
        if self.measure_kind is not None and self.role != "measure":
            raise ValueError(
                f"measure_kind={self.measure_kind!r} is only valid when role='measure'; "
                f"got role={self.role!r}"
            )
        if self.ordering and self.role == "measure":
            raise ValueError(
                f"ordering={self.ordering!r} is only valid for non-measure columns; "
                f"got role={self.role!r}"
            )
        return self


class CatalogTable(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    orm: str
    alias: str | None = None
    # Postgres schema this table physically lives in. ``None`` resolves to
    # ``DEFAULT_SCHEMA`` (``public``) for Phase 1 — no manifest declares a
    # schema yet because no tables have moved. Roadmap 01 §9.6.
    # Named ``pg_schema`` (not ``schema``) because Pydantic ``BaseModel``
    # exposes a deprecated ``schema()`` classmethod.
    pg_schema: str | None = None
    columns: dict[str, ManifestColumn]

    @property
    def effective_schema(self) -> str:
        """Return the resolved schema name (``public`` when unset)."""
        return self.pg_schema or DEFAULT_SCHEMA


EXTERNAL_SURFACE_SOURCES: frozenset[str] = frozenset({
    "evaluation_runs",
    "evaluation_run_api_call_logs",
    "evaluation_run_thread_results",
    "evaluation_run_adversarial_results",
})


class DataSurface(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    key: str
    label: str | None = None
    description: str | None = None
    backed_by: str
    entity_types: list[str] = Field(default_factory=list)
    entity_field_map: dict[str, str] = Field(default_factory=dict)
    fields: list[str] = Field(default_factory=list)
    default_limit: int = 10


class AppManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    app_id: str
    description: str | None = None
    catalog_tables: dict[str, CatalogTable]
    data_surfaces: list[DataSurface]
    tool_vocabulary: dict[str, str] = Field(default_factory=dict)

    @field_validator("app_id")
    @classmethod
    def _check_app_id(cls, v: str) -> str:
        if not v or not v[0].isalpha() or not v.replace("-", "").isalnum():
            raise ValueError(f"app_id must match ^[a-z][a-z0-9-]*$, got: {v!r}")
        if v != v.lower():
            raise ValueError(f"app_id must be lowercase, got: {v!r}")
        return v

    @model_validator(mode="after")
    def _surfaces_reference_catalog_tables(self) -> "AppManifest":
        # backed_by may be either a declared catalog table OR a known
        # external physical source (evaluation_run_api_call_logs, evaluation_run_thread_results, …) that
        # Sherlock's fetch_surface_records knows how to query directly.
        known = set(self.catalog_tables.keys()) | EXTERNAL_SURFACE_SOURCES
        for surface in self.data_surfaces:
            if surface.backed_by not in known:
                raise ValueError(
                    f"manifest {self.app_id}: surface {surface.key!r} "
                    f"backed_by={surface.backed_by!r} is not a declared catalog "
                    f"table or known external source"
                )
        return self

    def lookup_column(self, qualified_name: str) -> ManifestColumn | None:
        """Resolve a dotted name to its ``ManifestColumn``.

        Accepts either ``table.column`` or ``schema.table.column``. The
        schema-qualified form is honored only when the schema matches the
        table's declared ``effective_schema``; an explicit mismatch returns
        ``None`` rather than silently masking a wrong-schema lookup.

        Returns ``None`` for unqualified names, unknown tables, unknown
        columns, or schema mismatches.
        """
        if "." not in qualified_name:
            return None
        parts = qualified_name.split(".")
        if len(parts) == 2:
            table_name, col_name = parts
            schema_name: str | None = None
        elif len(parts) == 3:
            schema_name, table_name, col_name = parts
        else:
            return None
        table = self.catalog_tables.get(table_name)
        if table is None:
            return None
        if schema_name is not None and schema_name != table.effective_schema:
            return None
        return table.columns.get(col_name)

    def qualified_table_name(self, table_name: str) -> str | None:
        """Return ``"<schema>.<table>"`` for a declared catalog table.

        ``None`` if the table is not in the manifest. Helpers that emit
        SQL or pg_description rows MUST schema-qualify via this method —
        per Roadmap 01 §9.6, application code never relies on
        ``search_path``.
        """
        table = self.catalog_tables.get(table_name)
        if table is None:
            return None
        return f"{table.effective_schema}.{table_name}"


def load_manifest_from_path(path: Path) -> AppManifest:
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        raise ManifestValidationError(f"invalid YAML in {path}: {exc}") from exc
    try:
        return AppManifest.model_validate(raw)
    except Exception as exc:
        raise ManifestValidationError(str(exc)) from exc


# ── Cache ──────────────────────────────────────────────────────────

_MANIFEST_CACHE: dict[str, AppManifest] = {}


def load_all_manifests() -> dict[str, AppManifest]:
    """Load every *.yaml under MANIFESTS_DIR except _*.yaml; cache in-process."""
    if _MANIFEST_CACHE:
        return _MANIFEST_CACHE
    for path in sorted(MANIFESTS_DIR.glob("*.yaml")):
        if path.stem.startswith("_"):
            continue
        manifest = load_manifest_from_path(path)
        if manifest.app_id in _MANIFEST_CACHE:
            raise ManifestValidationError(
                f"duplicate manifest app_id {manifest.app_id} in {path}"
            )
        _MANIFEST_CACHE[manifest.app_id] = manifest
    return _MANIFEST_CACHE


def get_manifest(app_id: str) -> AppManifest:
    cache = load_all_manifests()
    if app_id not in cache:
        raise KeyError(f"no manifest registered for app_id={app_id!r}")
    return cache[app_id]


def _clear_manifest_cache_for_tests() -> None:
    """Drop the process-wide manifest cache. Test-only; call before reload in tests."""
    _MANIFEST_CACHE.clear()


# Phase 4 §675 acceptance gate: ``sql_agent.py`` must not call
# ``get_manifest(`` directly. Callers that need a narrow slice of manifest
# data reach for these helpers instead, so the SQL agent stays on the
# single derivation path (manifest → comment_emitter → pg_description)
# for metadata and only imports structural helpers for column/table
# validation.


def table_column_names(app_id: str) -> dict[str, set[str]]:
    """Return ``{table_name_lower: {column_name_lower, ...}}`` for an app."""
    try:
        manifest = get_manifest(app_id)
    except KeyError:
        return {}
    return {
        name.lower(): {c.lower() for c in table.columns}
        for name, table in manifest.catalog_tables.items()
    }


def table_schema_map(app_id: str) -> dict[str, str]:
    """Return ``{table_name: effective_schema}`` for an app.

    Used by helpers that issue ``information_schema``/``pg_catalog`` queries
    or emit ``COMMENT ON COLUMN`` statements. Empty dict if the app has no
    manifest. Roadmap 01 §9.6.
    """
    try:
        manifest = get_manifest(app_id)
    except KeyError:
        return {}
    return {
        name: table.effective_schema
        for name, table in manifest.catalog_tables.items()
    }


def known_schemas() -> frozenset[str]:
    """Return every effective schema declared by any loaded manifest.

    Always includes ``DEFAULT_SCHEMA``. Used by SQL-side validators that
    need to recognize a schema prefix (``platform.foo``, ``analytics.bar``)
    as a legitimate qualifier rather than a column reference. Today this is
    just ``{"public"}`` — the set widens automatically as manifests start
    declaring ``pg_schema``.
    """
    cache = load_all_manifests()
    schemas = {DEFAULT_SCHEMA}
    for manifest in cache.values():
        for table in manifest.catalog_tables.values():
            schemas.add(table.effective_schema)
    return frozenset(schemas)


def column_synonym_sets(app_id: str) -> dict[tuple[str, str], list[str]]:
    """Return ``{(table, column): [synonym, ...]}`` for every catalog column.

    Column name itself is always the first entry so callers can treat the
    list as the full alias set for that column.
    """
    try:
        manifest = get_manifest(app_id)
    except KeyError:
        return {}
    out: dict[tuple[str, str], list[str]] = {}
    for table_name, table in manifest.catalog_tables.items():
        for column_name, column in table.columns.items():
            syns = [str(s) for s in (column.synonyms or []) if isinstance(s, str) and s.strip()]
            out[(table_name, column_name)] = [column_name, *syns]
    return out


def manifest_for_result_typer(app_id: str) -> AppManifest | None:
    """Return the manifest for the result-set typer, or ``None`` if unknown.

    The typer accepts an optional manifest for passthrough-column lookups;
    this helper exists so ``sql_agent`` can fetch it without pretending to
    own manifest access itself.
    """
    try:
        return get_manifest(app_id)
    except KeyError:
        return None
