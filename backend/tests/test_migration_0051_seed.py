"""Phase 2 of 2026-05-18-llm-call-site-architecture: migration 0051.

Shape contract — confirms the revision file exists, chains off 0050, calls
every schema-touch the plan requires, and seeds the 11 platform-default rows
plus Sherlock-tenant rows.
"""
from pathlib import Path


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0051_tenant_call_site_defaults.py"
)


def test_migration_file_exists():
    assert MIGRATION_PATH.exists(), f"missing migration: {MIGRATION_PATH}"


def test_revision_chains_off_0050():
    source = MIGRATION_PATH.read_text()
    assert 'revision: str = "0051"' in source
    assert 'down_revision: Union[str, None] = "0050"' in source
    assert "def upgrade()" in source
    assert "def downgrade()" in source


def test_migration_creates_defaults_table_with_correct_columns():
    import re
    source = MIGRATION_PATH.read_text()
    # Regex tolerant of autoformatter line-wrap differences.
    assert re.search(
        r'create_table\(\s*"tenant_call_site_defaults"', source
    ), "missing create_table call for tenant_call_site_defaults"
    for col in (
        "tenant_id",
        "call_site",
        "provider",
        "credential_name",
        "model_or_deployment",
    ):
        assert f'"{col}"' in source, f"missing column {col!r}"


def test_migration_uses_nulls_not_distinct_unique():
    source = MIGRATION_PATH.read_text()
    assert "UNIQUE NULLS NOT DISTINCT (tenant_id, call_site)" in source
    # And a guard that refuses to run on Postgres < 15.
    assert "server_version_num" in source
    assert "150000" in source


def test_migration_creates_lookup_indexes():
    source = MIGRATION_PATH.read_text()
    assert "idx_tenant_call_site_defaults_tenant" in source
    assert "idx_tenant_call_site_defaults_call_site" in source


def test_migration_seeds_eleven_platform_defaults():
    source = MIGRATION_PATH.read_text()
    expected_call_sites = (
        "chat_text",
        "chat_vision",
        "chat_reasoning",
        "audio_transcription",
        "audio_synthesis",
        "evaluator_draft",
        "lead_signal_extraction",
        "report_generation",
        "analytics_supervisor",
        "analytics_specialist",
        "assist_prompt_or_schema",
    )
    for call_site in expected_call_sites:
        assert f'"{call_site}"' in source, f"missing platform default seed: {call_site}"
    # Catalog FK guard — skipped (with WARNING) when the row is missing.
    assert "analytics.ref_llm_models_catalog" in source
    assert "skipping platform default" in source


def test_migration_seeds_tenant_sherlock_defaults():
    """For every tenant with an enabled Azure credential, supervisor +
    specialist rows pointing at the env-var deployment names (with literal
    fallback) preserve today's behavior after the env vars are deleted."""
    source = MIGRATION_PATH.read_text()
    assert "SHERLOCK_SUPERVISOR_MODEL" in source
    assert "SHERLOCK_SPECIALIST_MODEL" in source
    assert "ai-evals-gpt-5.4" in source  # legacy fallback
    assert "ai-evals-gpt-5.4-mini" in source
    assert "WHERE provider = 'azure_openai' AND is_enabled = true" in source


def test_migration_schema_qualifies_raw_sql():
    source = MIGRATION_PATH.read_text()
    assert "platform.tenant_call_site_defaults" in source
    assert "platform.tenant_llm_credentials" in source
    assert "analytics.ref_llm_models_catalog" in source
