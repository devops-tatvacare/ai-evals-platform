import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_BOOTSTRAP_PATH = ROOT / 'app' / 'startup_schema.py'
SYNC_COMMENTS_PATH = ROOT / 'scripts' / 'sync_column_comments.py'


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

    def test_schema_bootstrap_adds_analytics_semantic_columns(self):
        contents = SCHEMA_BOOTSTRAP_PATH.read_text()

        expected_snippets = [
            "ALTER TABLE analytics_run_facts ADD COLUMN IF NOT EXISTS run_name TEXT",
            "ALTER TABLE analytics_run_facts ADD COLUMN IF NOT EXISTS avg_score DOUBLE PRECISION",
            "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS intent TEXT",
            "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS route TEXT",
            "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS query_type TEXT",
            "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS agent TEXT",
            "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS direction TEXT",
            "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION",
            "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS difficulty TEXT",
            "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS total_turns INTEGER",
        ]

        for snippet in expected_snippets:
            self.assertIn(snippet, contents)

    def test_schema_bootstrap_adds_eval_run_perf_indexes(self):
        contents = SCHEMA_BOOTSTRAP_PATH.read_text()

        expected_snippets = [
            "CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant_user_app_created ON eval_runs (tenant_id, user_id, app_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant_app_visibility_created ON eval_runs (tenant_id, app_id, visibility, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_api_logs_run_id_id ON api_logs (run_id, id DESC)",
        ]

        for snippet in expected_snippets:
            self.assertIn(snippet, contents)

    def test_schema_bootstrap_adds_eval_run_trigram_indexes(self):
        contents = SCHEMA_BOOTSTRAP_PATH.read_text()

        expected_snippets = [
            "CREATE EXTENSION IF NOT EXISTS pg_trgm",
            "idx_eval_runs_search_id_trgm",
            "idx_eval_runs_search_summary_evaluator_trgm",
            "idx_eval_runs_search_config_evaluator_trgm",
            "idx_eval_runs_search_batch_name_trgm",
        ]

        for snippet in expected_snippets:
            self.assertIn(snippet, contents)

    def test_schema_bootstrap_seeds_catalog_column_comments(self):
        # Phase 4 of the Alembic adoption moved the manifest-driven
        # COMMENT ON COLUMN sync out of startup_schema and into
        # backend/scripts/sync_column_comments.py. The Sherlock SQL agent
        # still relies on those pg_description rows; this test pins the
        # new location so a future refactor doesn't silently drop the call.
        contents = SYNC_COMMENTS_PATH.read_text()

        self.assertIn(
            'from app.services.chat_engine.comment_emitter import emit_column_comments',
            contents,
        )
        self.assertIn('emit_column_comments()', contents)

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
