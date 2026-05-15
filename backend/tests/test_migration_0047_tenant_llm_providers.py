"""Phase 1 of llm-byok: migration 0047 creates platform.tenant_llm_providers
and backfills from application_settings.llm-settings. The revision must chain
off the current head (0046) and expose upgrade/downgrade.
"""
from pathlib import Path


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0047_tenant_llm_providers.py"
)


def test_migration_file_exists():
    assert MIGRATION_PATH.exists(), f"missing migration: {MIGRATION_PATH}"


def test_revision_chains_off_current_head():
    source = MIGRATION_PATH.read_text()
    assert 'revision: str = "0047"' in source, "expected typed revision literal \"0047\""
    assert (
        'down_revision: Union[str, None] = "0046_drop_fact_lead_signal_backfill_index"'
        in source
    ), "down_revision must chain off 0046_drop_fact_lead_signal_backfill_index"
    assert "def upgrade()" in source
    assert "def downgrade()" in source


def test_migration_creates_schema_qualified_table():
    source = MIGRATION_PATH.read_text()
    # Per Roadmap 01: all raw SQL/DDL must be schema-qualified
    assert 'schema="platform"' in source
    assert "platform.application_settings" in source
    assert "platform.tenant_llm_providers" in source
