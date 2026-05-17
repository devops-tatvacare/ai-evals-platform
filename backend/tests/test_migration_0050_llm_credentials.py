"""Phase 1 of 2026-05-18-llm-call-site-architecture: migration 0050.

Shape contract — confirms the revision file exists, chains off 0049, and
calls every schema-touch the plan requires (table rename, new columns,
backfill, deployment table, catalog column add, seed). The end-to-end DB
backfill test against live Postgres is parked for a follow-up commit; this
file enforces structural invariants so a future "drive-by refactor" of the
migration is loud.
"""
from pathlib import Path


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0050_llm_credentials_and_deployments.py"
)


def test_migration_file_exists():
    assert MIGRATION_PATH.exists(), f"missing migration: {MIGRATION_PATH}"


def test_revision_chains_off_0049():
    source = MIGRATION_PATH.read_text()
    assert 'revision: str = "0050"' in source
    assert (
        'down_revision: Union[str, None] = "0049_signal_definition_execution_mode"'
        in source
    ), "down_revision must chain off 0049"
    assert "def upgrade()" in source
    assert "def downgrade()" in source


def test_migration_renames_table_and_adds_columns():
    source = MIGRATION_PATH.read_text()
    assert 'rename_table(' in source
    assert '"tenant_llm_providers", "tenant_llm_credentials"' in source
    assert '"secret_blob_encrypted"' in source
    assert '"name"' in source
    # Old columns are dropped (plain drop_column, not batch_alter_table).
    assert 'drop_column("tenant_llm_credentials", "api_key_encrypted"' in source
    assert 'drop_column("tenant_llm_credentials", "base_url"' in source
    assert 'drop_column("tenant_llm_credentials", "curated_models"' in source


def test_migration_creates_deployment_table_and_catalog_column():
    source = MIGRATION_PATH.read_text()
    assert 'create_table(\n        "tenant_llm_deployments"' in source
    assert 'canonical_model_id' in source
    assert 'needs_mapping' in source
    # Capability flag mandated by Phase 2's helper.
    assert '"supports_structured_output"' in source


def test_migration_backfills_deployments_with_alias_writeback():
    source = MIGRATION_PATH.read_text()
    assert 'analytics.ref_llm_model_alias' in source
    assert 'analytics.ref_llm_models_catalog' in source
    # Resolution helper that walks alias → catalog → unmapped.
    assert '_resolve_deployment' in source


def test_migration_seeds_curated_catalog_rows():
    source = MIGRATION_PATH.read_text()
    assert '_SEED_CATALOG' in source
    # A representative sample — full list lives in the migration itself.
    for model in ("gpt-4o", "gpt-4o-transcribe", "gemini-2.5-pro", "claude-sonnet-4-5"):
        assert model in source, f"missing curated catalog seed entry: {model}"


def test_migration_schema_qualifies_raw_sql():
    """Per the Roadmap-01 invariant: every raw SQL must schema-prefix."""
    source = MIGRATION_PATH.read_text()
    assert "platform.tenant_llm_credentials" in source
    assert "platform.tenant_llm_deployments" in source
    assert "analytics.ref_llm_models_catalog" in source
    assert "analytics.ref_llm_model_alias" in source
    assert "analytics.ref_llm_model_pricing" in source
