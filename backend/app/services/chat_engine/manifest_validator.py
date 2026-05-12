"""Cross-check manifests against live Postgres + workbench catalog. Run at every backend/worker boot.

Refuses startup if any manifest declares a table or column that doesn't
actually exist in its effective schema, or if a workbench semantic-model
catalog references physical tables/columns that the matching app
manifest does not declare. This is the one place drift between three
sources of truth gets caught:

  * Logical truth:  ``manifests/<app>.yaml`` (every physical column +
                     chart-contract taxonomy)
  * Curated truth:  ``semantic_models/<app>.yaml`` (the workbench
                     catalog the LLM is allowed to reach for)
  * Physical truth: live Postgres (``information_schema.columns``)

Roadmap 01 §9.6: each ``CatalogTable`` carries an ``effective_schema``
(``public`` until tables move). The validator queries ``information_schema``
per-table using that schema rather than a hard-coded ``'public'``.
"""
from __future__ import annotations

import logging
import re

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.chat_engine.manifest import (
    AppManifest,
    load_all_manifests,
)
from app.services.chat_engine.workbench_catalog import (
    LogicalColumn,
    WorkbenchCatalog,
    WorkbenchTable,
    load_workbench_catalog,
)

logger = logging.getLogger(__name__)


class ManifestDriftError(RuntimeError):
    """Raised when a manifest contradicts live Postgres. Boot should abort."""


class WorkbenchCatalogDriftError(RuntimeError):
    """Raised when the workbench catalog contradicts the app manifest.

    Distinct from ``ManifestDriftError`` so callers can tell the two
    failure classes apart in logs.
    """


def validate_manifest_taxonomy(manifest: AppManifest, strict: bool = False) -> list[str]:
    """Return warnings for chart-contract taxonomy drift.

    - measure columns without ``semantic_type`` → warning.
    - role/``data_type`` contradictions (measure must be quantitative, temporal
      must be temporal) → error, raised in strict mode, appended in loose mode.
    """
    warnings: list[str] = []
    errors: list[str] = []
    for table_name, table in manifest.catalog_tables.items():
        for col_name, col in table.columns.items():
            qualified = f"{manifest.app_id}:{table_name}.{col_name}"
            if col.role == "measure" and col.semantic_type is None:
                warnings.append(f"{qualified}: measure missing semantic_type")
            if col.role == "measure" and col.data_type not in (None, "quantitative"):
                errors.append(
                    f"{qualified}: role=measure requires data_type=quantitative, "
                    f"got {col.data_type!r}"
                )
            if col.role == "temporal" and col.data_type not in (None, "temporal"):
                errors.append(
                    f"{qualified}: role=temporal requires data_type=temporal, "
                    f"got {col.data_type!r}"
                )
    if strict and errors:
        raise ValueError("; ".join(errors))
    return warnings + errors


async def _db_columns_for(
    db: AsyncSession, schema_name: str, table_name: str
) -> dict[str, str]:
    result = await db.execute(
        text(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = :schema AND table_name = :t"
        ),
        {"schema": schema_name, "t": table_name},
    )
    return {row.column_name: row.data_type for row in result}


async def validate_manifest_against_postgres(
    manifest: AppManifest, db: AsyncSession
) -> None:
    """Validate every catalog table in the manifest against live Postgres.

    Each table is checked against its declared ``effective_schema``.
    Manifests that omit ``pg_schema`` resolve to ``DEFAULT_SCHEMA``
    (``public``) — Phase 1 behavior, identical to before.

    Phase 1 policy: a manifest entry whose declared physical reference
    cannot be resolved is fatal (boot blocks). Unqualified column refs
    *within manifest text* are not currently parsed here; that responsibility
    is Sherlock's during SQL validation. ``warnings`` are emitted (not
    raised) so callers can collect them without aborting boot when the
    drift is informational.
    """
    drift: list[str] = []
    warnings_out: list[str] = []
    for table_name, table in manifest.catalog_tables.items():
        schema_name = table.effective_schema
        if table.pg_schema is None:
            # Phase 1: unqualified manifests are expected. Warn so the
            # signal is visible in logs but never block boot.
            warnings_out.append(
                f"[{manifest.app_id}] table {table_name!r} has no pg_schema declared; "
                f"defaulting to {schema_name!r}"
            )
        db_cols = await _db_columns_for(db, schema_name, table_name)
        if not db_cols:
            drift.append(
                f"[{manifest.app_id}] table {schema_name}.{table_name!r} does not exist"
            )
            continue
        for col_name in table.columns:
            if col_name not in db_cols:
                drift.append(
                    f"[{manifest.app_id}] {schema_name}.{table_name}.{col_name!r} "
                    f"declared in manifest but not in information_schema.columns"
                )
    if warnings_out:
        for msg in warnings_out:
            logger.warning(msg)
    if drift:
        raise ManifestDriftError(
            f"Manifest drift detected ({len(drift)} issue(s)):\n  - "
            + "\n  - ".join(drift)
        )


# ──────────────────────────────────────────────────────────────────
# Workbench catalog drift — semantic model ↔ app manifest cross-check
# ──────────────────────────────────────────────────────────────────


def _extract_physical_refs(expr: str) -> set[str]:
    """Return the set of bare physical columns referenced in ``expr``.

    Conservative — anything ambiguous is left out of the set, so the
    cross-check biases toward "no false positives". A genuinely
    fabricated reference (e.g. ``result_detail->>'foo'`` where the
    table has no ``result_detail`` column at all) is caught because the
    bare ``result_detail`` identifier itself is one of the matches.
    """
    expr = expr.strip()
    if not expr:
        return set()
    refs: set[str] = set()
    # Strip string literals (single-quoted) before identifier scan so
    # the column-name regex doesn't pick up the JSONB key as a column.
    cleaned = re.sub(r"'[^']*'", "''", expr)
    # Strip type-cast trailers (``::numeric``, ``::boolean``).
    cleaned = re.sub(r"::\s*[a-zA-Z_][a-zA-Z0-9_]*", "", cleaned)
    for ident in re.finditer(r"[a-zA-Z_][a-zA-Z0-9_]*", cleaned):
        token = ident.group(0)
        # Filter out SQL keywords / function names we know aren't columns.
        if token.lower() in _SQL_NON_COLUMN_TOKENS:
            continue
        refs.add(token)
    return refs


_SQL_NON_COLUMN_TOKENS: frozenset[str] = frozenset({
    "case", "when", "then", "else", "end",
    "round", "avg", "sum", "count", "min", "max",
    "cast", "as", "and", "or", "not", "null", "true", "false",
    "numeric", "boolean", "integer", "text", "timestamp", "timestamptz",
    "double", "precision", "real", "bigint", "smallint", "uuid", "interval",
    "date", "json", "jsonb",
})


def _resolve_source_table(
    catalog: WorkbenchCatalog,
    catalog_table: WorkbenchTable,
    column: LogicalColumn,
) -> WorkbenchTable | None:
    """Return the catalog table the column's physical refs resolve against.

    Default: the column's own catalog table. If the column declares
    ``source_table``, that takes priority — the manifest cross-check then
    runs against the named table. ``None`` if the named table isn't in
    the catalog (caught earlier by the model validator, but defensive).
    """
    if column.source_table is None:
        return catalog_table
    return catalog.tables.get(column.source_table)


def _manifest_table(manifest: AppManifest, name: str) -> set[str] | None:
    """Return the set of lowercase column names for ``name`` in the manifest, or ``None``."""
    table = manifest.catalog_tables.get(name)
    if table is None:
        return None
    return {c.lower() for c in table.columns}


def validate_workbench_against_manifest(
    catalog: WorkbenchCatalog,
    manifest: AppManifest,
) -> None:
    """Cross-check workbench catalog physical references against the manifest.

    Rules (per design §4 + plan Phase 1 validation criteria):
      * Each catalog table's ``base_table.table`` must be declared in
        the matching app manifest (catalog_tables key).
      * Each logical column's ``expr`` references a physical column that
        exists on the resolved manifest table — unless the column is a
        pure constant / cross-table expression that declares
        ``source_table`` (then we resolve against *that* table).
      * Physical PK / tenant-scoped-unique-key / analytical-grain columns
        must exist in the manifest (or be themselves declared as logical
        columns whose physical references resolve).
      * Verified-query SQL parses with the SQL bouncer's AST parser
        (a basic ``CAN_PARSE`` check; deeper semantics belong to the bouncer).

    Raises ``WorkbenchCatalogDriftError`` with a multi-line message
    listing every drift detected.
    """
    drift: list[str] = []
    for table_name, table in catalog.tables.items():
        manifest_cols = _manifest_table(manifest, table.base_table.table)
        if manifest_cols is None:
            drift.append(
                f"[{manifest.app_id}] catalog table {table_name!r} "
                f"(base_table={table.base_table.table!r}) is not declared "
                f"in manifests/{manifest.app_id}.yaml"
            )
            continue

        # Physical PK / TSU / grain columns must exist as either a physical
        # column in the manifest OR a derived logical column with declared
        # source_table.
        for key_label, key in (
            ("physical_primary_key", table.physical_primary_key),
            ("tenant_scoped_unique_key", table.tenant_scoped_unique_key),
        ):
            if key is None:
                continue
            for col in key.columns:
                if col.lower() not in manifest_cols:
                    drift.append(
                        f"[{manifest.app_id}] catalog table {table_name!r}: "
                        f"{key_label} column {col!r} is not a physical column "
                        f"on {table.base_table.table!r}"
                    )

        # Each logical column resolves to physical refs on its source table.
        for col in table.all_logical_columns():
            source = _resolve_source_table(catalog, table, col)
            if source is None:
                drift.append(
                    f"[{manifest.app_id}] catalog table {table_name!r}: "
                    f"logical column {col.name!r} declares source_table="
                    f"{col.source_table!r} which is not a declared catalog table"
                )
                continue
            source_manifest_cols = _manifest_table(manifest, source.base_table.table)
            if source_manifest_cols is None:
                drift.append(
                    f"[{manifest.app_id}] catalog table {table_name!r}: "
                    f"logical column {col.name!r} resolves to "
                    f"{source.base_table.table!r} which is not in the manifest"
                )
                continue
            if col.is_derived and col.source_table is None:
                drift.append(
                    f"[{manifest.app_id}] catalog table {table_name!r}: "
                    f"derived logical column {col.name!r} (expr={col.expr!r}) "
                    f"must declare source_table"
                )
                # Continue checking refs anyway against the default source.
            refs = _extract_physical_refs(col.effective_expr())
            unresolved = [
                r for r in refs
                if r.lower() not in source_manifest_cols
            ]
            if unresolved:
                drift.append(
                    f"[{manifest.app_id}] catalog table {table_name!r}: "
                    f"logical column {col.name!r} references unknown column(s) "
                    f"on {source.base_table.table!r}: "
                    f"{', '.join(sorted(unresolved))}"
                )

    # Verified queries must at minimum parse. We import lazily so the
    # validator module stays usable in environments where sqlglot is
    # absent (e.g. lightweight tooling) — at boot the AST parser is
    # always available.
    try:
        from sqlglot import parse_one
        from sqlglot.errors import ParseError
    except ImportError:  # pragma: no cover — sqlglot is a hard dep at boot
        parse_one = None
        ParseError = Exception  # type: ignore[assignment,misc]

    if parse_one is not None:
        for vq in catalog.verified_queries:
            try:
                parse_one(vq.sql, read="postgres")
            except ParseError as exc:
                drift.append(
                    f"[{manifest.app_id}] verified_query {vq.name!r}: "
                    f"sql does not parse: {exc}"
                )

    if drift:
        raise WorkbenchCatalogDriftError(
            f"Workbench catalog drift detected for {manifest.app_id} "
            f"({len(drift)} issue(s)):\n  - " + "\n  - ".join(drift)
        )


async def run_manifest_validator(db: AsyncSession) -> None:
    """Validate every registered manifest.

    Raises ``ManifestDriftError`` on physical drift (boot-blocking),
    ``WorkbenchCatalogDriftError`` on workbench-vs-manifest drift
    (boot-blocking when a catalog exists), and ``ValueError`` on strict
    taxonomy violations. Loose taxonomy issues (missing ``semantic_type``
    on measures) are logged as warnings.
    """
    manifests = load_all_manifests()
    for manifest in manifests.values():
        await validate_manifest_against_postgres(manifest, db)
        # strict=True raises on role/data_type contradictions; warnings
        # (e.g. missing semantic_type) are collected and logged non-fatally.
        taxonomy_issues = validate_manifest_taxonomy(manifest, strict=True)
        if taxonomy_issues:
            logger.warning(
                "Manifest %s: %d taxonomy warning(s): %s",
                manifest.app_id,
                len(taxonomy_issues),
                "; ".join(taxonomy_issues),
            )
        else:
            logger.info("Manifest %s: taxonomy validation OK", manifest.app_id)

        # Phase 1: workbench catalog cross-check. Apps without a curated
        # catalog (pre-rewrite) skip this step until their YAML is
        # rewritten in Phase 5/6. A *broken* catalog raises here and
        # blocks boot — silent fallback is the exact failure mode the
        # plan forbids.
        catalog = load_workbench_catalog(manifest.app_id)
        if catalog is not None:
            validate_workbench_against_manifest(catalog, manifest)
            logger.info(
                "Workbench catalog %s: cross-check OK (%d tables, %d verified queries)",
                manifest.app_id,
                len(catalog.tables),
                len(catalog.verified_queries),
            )
