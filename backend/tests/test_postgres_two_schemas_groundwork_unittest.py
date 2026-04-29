"""Roadmap 01 Phase 1 groundwork: schema-aware helpers without table moves.

Plan: docs/plans/2026-04-24-implementation-sequence/roadmap-01-foundation-postgres-two-schemas.md

These tests pin the contract that:
  1. Manifests accept an optional ``pg_schema`` field.
  2. Unset ``pg_schema`` resolves to ``public`` (Phase 1 default).
  3. ``lookup_column`` accepts both ``table.column`` and ``schema.table.column``.
  4. ``known_schemas`` reports every effective schema in scope.
  5. ``COMMENT ON COLUMN`` emission is schema-qualified.
  6. SQL validator accepts schema prefixes (``platform.``, ``analytics.``).
  7. ``ToolVocabulary`` carries ``schema`` on each ``ColumnTarget`` and
     resolves ``schema.table.column`` exactly.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.chat_engine.comment_emitter import emit_column_comments
from app.services.chat_engine.manifest import (
    DEFAULT_SCHEMA,
    _clear_manifest_cache_for_tests,
    known_schemas,
    load_manifest_from_path,
    table_schema_map,
)


def setup_function(_):
    _clear_manifest_cache_for_tests()


# ── Manifest CatalogTable ──────────────────────────────────────────────


def _write_minimal_manifest(path: Path, app_id: str, *, pg_schema: str | None = None) -> Path:
    schema_line = f"    pg_schema: {pg_schema}\n" if pg_schema else ""
    path.write_text(
        f"""
app_id: {app_id}
catalog_tables:
  agg_evaluation_run:
    orm: AggEvaluationRun
{schema_line}    columns:
      pass_rate:
        role: measure
        measure_kind: percent
      created_at:
        role: temporal
data_surfaces:
  - key: runs
    backed_by: agg_evaluation_run
""".lstrip()
    )
    return path


def test_catalog_table_defaults_to_public_when_pg_schema_unset(tmp_path: Path):
    manifest = load_manifest_from_path(_write_minimal_manifest(tmp_path / "a.yaml", "app-a"))
    table = manifest.catalog_tables["agg_evaluation_run"]
    assert table.pg_schema is None
    assert table.effective_schema == DEFAULT_SCHEMA == "public"


def test_catalog_table_honors_explicit_pg_schema(tmp_path: Path):
    manifest = load_manifest_from_path(
        _write_minimal_manifest(tmp_path / "b.yaml", "app-b", pg_schema="analytics")
    )
    assert manifest.catalog_tables["agg_evaluation_run"].effective_schema == "analytics"


def test_qualified_table_name_uses_effective_schema(tmp_path: Path):
    manifest = load_manifest_from_path(
        _write_minimal_manifest(tmp_path / "c.yaml", "app-c", pg_schema="platform")
    )
    assert manifest.qualified_table_name("agg_evaluation_run") == "platform.agg_evaluation_run"
    assert manifest.qualified_table_name("missing_table") is None


# ── lookup_column accepts both forms ───────────────────────────────────


def test_lookup_column_accepts_table_column_form(tmp_path: Path):
    manifest = load_manifest_from_path(_write_minimal_manifest(tmp_path / "d.yaml", "app-d"))
    col = manifest.lookup_column("agg_evaluation_run.pass_rate")
    assert col is not None
    assert col.role == "measure"


def test_lookup_column_accepts_schema_table_column_form(tmp_path: Path):
    """Schema-qualified lookup must succeed when the schema matches."""
    manifest = load_manifest_from_path(_write_minimal_manifest(tmp_path / "e.yaml", "app-e"))
    col = manifest.lookup_column("public.agg_evaluation_run.pass_rate")
    assert col is not None
    assert col.role == "measure"


def test_lookup_column_rejects_schema_mismatch(tmp_path: Path):
    """A wrong schema must not silently match — phase 1 returns None instead."""
    manifest = load_manifest_from_path(_write_minimal_manifest(tmp_path / "f.yaml", "app-f"))
    # Manifest declares no pg_schema → effective is ``public``.
    assert manifest.lookup_column("analytics.agg_evaluation_run.pass_rate") is None


def test_lookup_column_rejects_too_many_parts(tmp_path: Path):
    manifest = load_manifest_from_path(_write_minimal_manifest(tmp_path / "g.yaml", "app-g"))
    assert manifest.lookup_column("foo.bar.baz.qux") is None


# ── Module-level helpers ───────────────────────────────────────────────


def test_known_schemas_includes_default_for_loaded_apps():
    """``known_schemas`` always reports ``public`` once any manifest loads."""
    schemas = known_schemas()
    assert "public" in schemas


def test_table_schema_map_returns_effective_schema_per_table():
    schema_map = table_schema_map("kaira-bot")
    if schema_map:
        # Phase 3: analytics fact tables now declare ``pg_schema: analytics``
        # alongside the existing ``platform``-qualified OLTP tables.
        assert schema_map["evaluation_runs"] == "platform"
        assert schema_map["agg_evaluation_run"] == "analytics"


# ── COMMENT ON COLUMN emission is schema-qualified ─────────────────────


def test_comment_emitter_schema_qualifies_every_statement():
    """Every COMMENT ON COLUMN must be qualified ``<schema>.<table>.<col>``."""
    stmts = emit_column_comments()
    assert stmts, "expected at least one comment emitted from registered manifests"
    for stmt in stmts:
        head = stmt.split(" IS ", 1)[0]
        # head looks like: "COMMENT ON COLUMN <schema>.<table>.<col>"
        target = head[len("COMMENT ON COLUMN ") :]
        parts = target.split(".")
        assert len(parts) == 3, f"expected schema.table.col, got: {head!r}"
        # Phase 3: ``platform`` for OLTP tables, ``analytics`` for facts /
        # aggregates / refs / logs / caches; ``public`` only persists for
        # tables that haven't yet declared a manifest schema.
        assert parts[0] in {"public", "platform", "analytics"}, (
            f"expected schema to be public/platform/analytics during the transition, got: {head!r}"
        )


# ── SQL validator recognizes schema prefixes ───────────────────────────


def test_sql_validator_accepts_known_schema_prefixes():
    """``platform.t.c`` and ``analytics.t.c`` must not trip the manifest-column
    validator. The ``<schema>.<table>`` segment is a passthrough qualifier;
    only ``<table>.<column>`` references should be checked.
    """
    from app.services.chat_engine.sql_agent import (
        SQLValidationError,
        validate_sql_columns_against_manifest,
    )

    # Real apps registered in the repo. ``agg_evaluation_run.pass_rate``
    # is a known column on ``kaira-bot``; the schema prefix should be
    # treated as a qualifier and not rejected.
    sql = (
        "SELECT agg_evaluation_run.pass_rate "
        "FROM public.agg_evaluation_run"
    )
    # Should not raise.
    validate_sql_columns_against_manifest(sql, app_id="kaira-bot")

    # Negative control: a column that does NOT exist on a known table
    # must still raise even when the FROM is schema-qualified.
    with pytest.raises(SQLValidationError):
        validate_sql_columns_against_manifest(
            "SELECT agg_evaluation_run.does_not_exist FROM public.agg_evaluation_run",
            app_id="kaira-bot",
        )


# ── ToolVocabulary carries schema ──────────────────────────────────────


def test_column_target_default_schema_is_public():
    from app.services.report_builder.analytics.vocabulary import ColumnTarget

    target = ColumnTarget(table="t", column="c", role="dimension")
    assert target.schema == "public"


def test_resolve_column_accepts_schema_table_column_form():
    """``resolve_column`` accepts ``schema.table.column`` and exact-matches
    against the canonical target's ``schema``."""
    from app.services.report_builder.analytics.vocabulary import (
        ColumnTarget,
        ToolVocabulary,
    )

    target = ColumnTarget(
        table="agg_evaluation_run",
        column="pass_rate",
        role="measure",
        schema="public",
    )
    vocab = ToolVocabulary(
        app_id="test-app",
        dimensions={},
        surfaces={},
        block_types={},
        entity_types=frozenset(),
        column_alias_index={"pass_rate": (target,)},
    )

    # 3-part: schema must match.
    res = vocab.resolve_column("public.agg_evaluation_run.pass_rate")
    assert res.status == "unique"
    assert res.canonical == target

    # 3-part with wrong schema is strict: it does NOT fall through to a
    # bare-name lookup. The dotted term is treated as fully qualified, and
    # if the schema part doesn't match the canonical target, the resolver
    # reports ``unknown``. This matches the strict semantics of
    # ``manifest.lookup_column``.
    res_wrong = vocab.resolve_column("analytics.agg_evaluation_run.pass_rate")
    assert res_wrong.status == "unknown"

    # 2-part: existing behavior preserved.
    res2 = vocab.resolve_column("agg_evaluation_run.pass_rate")
    assert res2.status == "unique"
    assert res2.canonical == target

    # Bare term: existing behavior preserved.
    res_bare = vocab.resolve_column("pass_rate")
    assert res_bare.status == "unique"
    assert res_bare.canonical == target


# ── Alembic env.py schema-aware configuration ──────────────────────────


def test_alembic_env_includes_schemas_and_pins_version_table():
    """env.py must set ``include_schemas=True`` and pin the version table
    to ``public`` per Roadmap 01 §9.5.

    File-level grep keeps this test independent of importing alembic.
    """
    env_path = (
        Path(__file__).parent.parent / "alembic" / "env.py"
    )
    body = env_path.read_text()
    assert "include_schemas=True" in body
    assert 'version_table_schema="public"' in body or "version_table_schema='public'" in body


def test_boot_paths_query_public_alembic_version():
    """Boot diagnostics must keep reading the version table from ``public``.

    Roadmap 01 keeps ``alembic_version`` in ``public`` while app tables move
    through ``platform``/``analytics``.
    """
    main_path = Path(__file__).parent.parent / "app" / "main.py"
    worker_path = Path(__file__).parent.parent / "app" / "worker.py"
    assert "public.alembic_version" in main_path.read_text()
    assert "public.alembic_version" in worker_path.read_text()


def test_entrypoint_uses_locked_migration_runner():
    entrypoint_path = Path(__file__).parent.parent / "entrypoint.sh"
    body = entrypoint_path.read_text()
    assert "python -m app.services.migration.run_alembic_with_lock" in body


def test_locked_migration_runner_serializes_boot_and_widens_version_column():
    helper_path = (
        Path(__file__).parent.parent
        / "app"
        / "services"
        / "migration"
        / "run_alembic_with_lock.py"
    )
    body = helper_path.read_text()
    assert "pg_advisory_lock" in body
    assert "ALTER TABLE public.alembic_version " in body
    assert "_TARGET_VERSION_NUM_LENGTH = 255" in body
    assert "ALTER COLUMN version_num TYPE varchar(" in body


def test_analytics_schema_revision_stays_schema_only():
    """Revision 0007 must avoid privileged role / DB DDL in the app-owned chain."""
    migration_path = (
        Path(__file__).parent.parent / "alembic" / "versions" / "0007_create_analytics_schema_and_role.py"
    )
    body = migration_path.read_text()
    assert "CREATE SCHEMA IF NOT EXISTS analytics" in body
    assert "CREATE ROLE analytics_reader" not in body
    assert "ALTER ROLE analytics_reader" not in body
    assert "ALTER DATABASE" not in body
