"""Shared database schema bootstrap for backend and worker entrypoints."""

from sqlalchemy import text

from app.constants import SHERLOCK_CHAT_SOURCE
from app.database import engine
from app.models import Base

SCHEMA_BOOTSTRAP_LOCK_KEY_1 = 8721
SCHEMA_BOOTSTRAP_LOCK_KEY_2 = 1

SCHEMA_BOOTSTRAP_SQL = (
    "CREATE TABLE IF NOT EXISTS sherlock_runtime_turns ("
    "id UUID PRIMARY KEY, "
    "tenant_id UUID NOT NULL, "
    "user_id UUID NOT NULL, "
    "chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE, "
    "app_id TEXT NOT NULL, "
    "client_turn_id TEXT NOT NULL, "
    "provider TEXT NOT NULL, "
    "model TEXT NOT NULL, "
    "user_message TEXT, "
    "status TEXT NOT NULL DEFAULT 'queued', "
    "assistant_message_id UUID, "
    "last_event_seq INTEGER NOT NULL DEFAULT 0, "
    "last_error TEXT, "
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "CONSTRAINT uq_sherlock_runtime_turn_client_id UNIQUE (chat_session_id, client_turn_id))",
    "CREATE INDEX IF NOT EXISTS idx_sherlock_runtime_turn_status ON sherlock_runtime_turns (chat_session_id, status)",
    "DROP TABLE IF EXISTS lsq_call_cache",
    "ALTER TABLE schemas ADD COLUMN IF NOT EXISTS source_type VARCHAR(20)",
    "ALTER TABLE eval_runs DROP COLUMN IF EXISTS report_cache",
    "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private'",
    "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS shared_by UUID",
    "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ",
    "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS latest_review_id UUID",
    "ALTER TABLE adversarial_test_cases ADD COLUMN IF NOT EXISTS persona_tactic VARCHAR(50)",
    "ALTER TABLE sherlock_runtime_sessions ADD COLUMN IF NOT EXISTS last_response_id TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS app_id VARCHAR(50) NOT NULL DEFAULT ''",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS queue_class VARCHAR(20) NOT NULL DEFAULT 'standard'",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_owner VARCHAR(120)",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT",
    """
    DO $$
    BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END $$;
    """,
    "ALTER TABLE analytics_run_facts ADD COLUMN IF NOT EXISTS run_name TEXT",
    "ALTER TABLE analytics_run_facts ADD COLUMN IF NOT EXISTS avg_score DOUBLE PRECISION",
    "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS agent TEXT",
    "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS direction TEXT",
    "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION",
    "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS intent TEXT",
    "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS route TEXT",
    "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS query_type TEXT",
    "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS difficulty TEXT",
    "ALTER TABLE analytics_eval_facts ADD COLUMN IF NOT EXISTS total_turns INTEGER",
    "DROP INDEX IF EXISTS uq_settings_app_scope",
    "CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created ON jobs (status, priority, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_status_lease_expires ON jobs (status, lease_expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_status_next_retry ON jobs (status, next_retry_at)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status_created ON jobs (tenant_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_tenant_app_status_created ON jobs (tenant_id, app_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant_user_app_created ON eval_runs (tenant_id, user_id, app_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant_app_visibility_created ON eval_runs (tenant_id, app_id, visibility, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant_visibility_created ON eval_runs (tenant_id, visibility, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_eval_runs_latest_review ON eval_runs (latest_review_id)",
    "CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant_user_app_updated ON chat_sessions (tenant_id, user_id, app_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant_user_app_source_updated ON chat_sessions (tenant_id, user_id, app_id, server_session_id, updated_at DESC)",
    f"CREATE INDEX IF NOT EXISTS idx_chat_sessions_non_sherlock_updated ON chat_sessions (tenant_id, user_id, app_id, updated_at DESC) WHERE server_session_id IS DISTINCT FROM '{SHERLOCK_CHAT_SOURCE}'",
    "CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON chat_messages (session_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_inside_sales_calls_tenant_app_activity_time ON inside_sales_calls (tenant_id, app_id, COALESCE(call_started_at, created_on) DESC, activity_id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_inside_sales_calls_tenant_app_activity_agent ON inside_sales_calls (tenant_id, app_id, COALESCE(call_started_at, created_on), agent_name_normalized, agent_name) WHERE agent_name IS NOT NULL AND agent_name_normalized IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_inside_sales_leads_tenant_app_created_prospect ON inside_sales_leads (tenant_id, app_id, created_on DESC, prospect_id DESC)",
    "ANALYZE inside_sales_calls",
    "ANALYZE inside_sales_leads",
    "CREATE INDEX IF NOT EXISTS idx_listings_tenant_user_app_updated ON listings (tenant_id, user_id, app_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_evaluators_tenant_user_app_created ON evaluators (tenant_id, user_id, app_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_evaluators_tenant_app_visibility_created ON evaluators (tenant_id, app_id, visibility, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_evaluators_listing_created ON evaluators (listing_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_prompts_tenant_user_app_updated ON prompts (tenant_id, user_id, app_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_prompts_tenant_app_visibility_updated ON prompts (tenant_id, app_id, visibility, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_schemas_tenant_user_app_updated ON schemas (tenant_id, user_id, app_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_schemas_tenant_app_visibility_updated ON schemas (tenant_id, app_id, visibility, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_eval_templates_tenant_user_app_updated ON eval_templates (tenant_id, user_id, app_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_eval_templates_tenant_app_visibility_updated ON eval_templates (tenant_id, app_id, visibility, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant_user_app_status_created ON eval_runs (tenant_id, user_id, app_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_thread_evaluations_thread_id_id ON thread_evaluations (thread_id, id)",
    "CREATE INDEX IF NOT EXISTS idx_api_logs_run_id_id ON api_logs (run_id, id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_tags_tenant_user_app_name ON tags (tenant_id, user_id, app_id, name)",
    "CREATE INDEX IF NOT EXISTS idx_analytics_charts_owned_active ON analytics_charts (tenant_id, user_id, app_id, created_at DESC) WHERE archived_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_analytics_charts_shared_active ON analytics_charts (tenant_id, app_id, visibility, created_at DESC) WHERE archived_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_analytics_dashboards_owned_active ON analytics_dashboards (tenant_id, user_id, app_id, created_at DESC) WHERE archived_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_analytics_dashboards_shared_active ON analytics_dashboards (tenant_id, app_id, visibility, created_at DESC) WHERE archived_at IS NULL",
    """
    DO $$
    BEGIN
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_eval_runs_search_id_trgm ON eval_runs USING gin ((id::text) gin_trgm_ops)';
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_eval_runs_search_summary_evaluator_trgm ON eval_runs USING gin ((COALESCE(summary->>''evaluator_name'', '''')) gin_trgm_ops)';
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_eval_runs_search_config_evaluator_trgm ON eval_runs USING gin ((COALESCE(config->>''evaluator_name'', '''')) gin_trgm_ops)';
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_eval_runs_search_batch_name_trgm ON eval_runs USING gin ((COALESCE(batch_metadata->>''name'', '''')) gin_trgm_ops)';
        END IF;
    END $$;
    """,
    "ANALYZE eval_runs",
    "ANALYZE api_logs",
    "ANALYZE evaluators",
    "ALTER TABLE analytics_charts ADD COLUMN IF NOT EXISTS source_session_id UUID",
    "ALTER TABLE analytics_dashboards ADD COLUMN IF NOT EXISTS source_session_id UUID",
    "ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS source_session_id UUID",
    "ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS template_id UUID",
    "ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS template_branch_key VARCHAR(100)",
    "ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS seed_key VARCHAR(120)",
    "ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS seed_variant VARCHAR(50)",
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_eval_runs_latest_review_id'
        ) THEN
            ALTER TABLE eval_runs
            ADD CONSTRAINT fk_eval_runs_latest_review_id
            FOREIGN KEY (latest_review_id) REFERENCES eval_reviews(id) ON DELETE SET NULL;
        END IF;
    END $$;
    """,
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_analytics_charts_source_session_id'
        ) THEN
            ALTER TABLE analytics_charts
            ADD CONSTRAINT fk_analytics_charts_source_session_id
            FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL;
        END IF;
    END $$;
    """,
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_analytics_dashboards_source_session_id'
        ) THEN
            ALTER TABLE analytics_dashboards
            ADD CONSTRAINT fk_analytics_dashboards_source_session_id
            FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL;
        END IF;
    END $$;
    """,
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_report_configs_source_session_id'
        ) THEN
            ALTER TABLE report_configs
            ADD CONSTRAINT fk_report_configs_source_session_id
            FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL;
        END IF;
    END $$;
    """,
)

INDEX_REPAIR_SQL = (
    """
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1
            FROM pg_class idx
            JOIN pg_index i ON i.indexrelid = idx.oid
            WHERE idx.relkind = 'i'
              AND idx.relname = 'uq_settings_private_scope'
              AND NOT i.indisunique
        ) THEN
            EXECUTE 'DROP INDEX IF EXISTS uq_settings_private_scope';
        END IF;
    END $$;
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_settings_private_scope
    ON settings (tenant_id, app_id, key, user_id, visibility)
    WHERE visibility = 'PRIVATE'
    """,
    """
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1
            FROM pg_class idx
            JOIN pg_index i ON i.indexrelid = idx.oid
            WHERE idx.relkind = 'i'
              AND idx.relname = 'uq_settings_shared_scope'
              AND NOT i.indisunique
        ) THEN
            EXECUTE 'DROP INDEX IF EXISTS uq_settings_shared_scope';
        END IF;
    END $$;
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_settings_shared_scope
    ON settings (tenant_id, app_id, key, visibility)
    WHERE visibility = 'SHARED'
    """,
)


async def bootstrap_database_schema() -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                f'SELECT pg_advisory_xact_lock({SCHEMA_BOOTSTRAP_LOCK_KEY_1}, {SCHEMA_BOOTSTRAP_LOCK_KEY_2})'
            )
        )
        await conn.run_sync(Base.metadata.create_all)

        for statement in SCHEMA_BOOTSTRAP_SQL:
            await conn.execute(text(statement))

        for statement in INDEX_REPAIR_SQL:
            await conn.execute(text(statement))

        # Column comments are generated from the Sherlock manifests instead
        # of the hand-maintained COLUMN_COMMENT_SQL list, so the pg_description
        # rows SQL-agent reads never drift from role/unit/synonym declarations.
        from app.services.chat_engine.comment_emitter import emit_column_comments
        for statement in emit_column_comments():
            await conn.execute(text(statement))
