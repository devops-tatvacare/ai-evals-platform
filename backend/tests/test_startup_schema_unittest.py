import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_BOOTSTRAP_PATH = ROOT / 'app' / 'startup_schema.py'


class StartupSchemaTests(unittest.TestCase):
    def test_sherlock_runtime_session_dataclass_has_last_response_id(self):
        from app.services.report_builder.runtime_store import SherlockRuntimeSession
        import dataclasses

        field_names = {field.name for field in dataclasses.fields(SherlockRuntimeSession)}

        self.assertIn('last_response_id', field_names)

    def test_schema_bootstrap_serializes_concurrent_startup(self):
        contents = SCHEMA_BOOTSTRAP_PATH.read_text()

        self.assertIn('pg_advisory_xact_lock', contents)

    def test_schema_bootstrap_repairs_settings_scope_indexes_as_unique(self):
        contents = SCHEMA_BOOTSTRAP_PATH.read_text()

        expected_snippets = [
            "DROP INDEX IF EXISTS uq_settings_private_scope",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_settings_private_scope",
            "DROP INDEX IF EXISTS uq_settings_shared_scope",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_settings_shared_scope",
        ]

        for snippet in expected_snippets:
            self.assertIn(snippet, contents)

    def test_schema_bootstrap_adds_evaluator_seed_identity_columns(self):
        contents = SCHEMA_BOOTSTRAP_PATH.read_text()

        self.assertIn("ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS seed_key VARCHAR(120)", contents)
        self.assertIn("ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS seed_variant VARCHAR(50)", contents)

    def test_schema_bootstrap_adds_sherlock_lineage_columns(self):
        contents = SCHEMA_BOOTSTRAP_PATH.read_text()

        self.assertIn("ALTER TABLE analytics_charts ADD COLUMN IF NOT EXISTS source_session_id UUID", contents)
        self.assertIn("ALTER TABLE analytics_dashboards ADD COLUMN IF NOT EXISTS source_session_id UUID", contents)
        self.assertIn("ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS source_session_id UUID", contents)

    def test_schema_bootstrap_seeds_catalog_column_comments(self):
        contents = SCHEMA_BOOTSTRAP_PATH.read_text()

        self.assertIn('COLUMN_COMMENT_SQL = (', contents)
        self.assertIn('COMMENT ON COLUMN analytics_run_facts.eval_type IS', contents)
        self.assertIn('COMMENT ON COLUMN analytics_eval_facts.result_status IS', contents)
        self.assertIn('COMMENT ON COLUMN eval_runs.batch_metadata IS', contents)

    def test_schema_bootstrap_adds_sherlock_runtime_turns_table(self):
        contents = SCHEMA_BOOTSTRAP_PATH.read_text()

        self.assertIn('CREATE TABLE IF NOT EXISTS sherlock_runtime_turns', contents)
        self.assertIn("status TEXT NOT NULL DEFAULT 'queued'", contents)
        self.assertIn(
            "CONSTRAINT uq_sherlock_runtime_turn_client_id UNIQUE (chat_session_id, client_turn_id)",
            contents,
        )
        self.assertIn(
            'CREATE INDEX IF NOT EXISTS idx_sherlock_runtime_turn_status ON sherlock_runtime_turns (chat_session_id, status)',
            contents,
        )
