"""Shared database schema bootstrap for backend and worker entrypoints."""

import logging
import time

from sqlalchemy import text

from app.constants import SHERLOCK_CHAT_SOURCE
from app.database import engine
from app.models import Base

_log = logging.getLogger(__name__)

SCHEMA_BOOTSTRAP_LOCK_KEY_1 = 8721
SCHEMA_BOOTSTRAP_LOCK_KEY_2 = 1

# Rename the legacy `inside_sales_*` CRM-backed tables (plus their constraints
# and indexes) to the generic `source_*` names before `create_all` runs.
# create_all would otherwise create empty `source_*` tables alongside the
# still-named legacy tables. Each block is idempotent: it only acts when the
# source object exists AND the destination does not, so repeat runs are safe.
PRE_CREATE_RENAME_SQL = (
    """
    DO $$
    BEGIN
        IF to_regclass('public.inside_sales_calls') IS NOT NULL
           AND to_regclass('public.source_call_records') IS NULL THEN
            ALTER TABLE inside_sales_calls RENAME TO source_call_records;
        END IF;
        IF to_regclass('public.inside_sales_leads') IS NOT NULL
           AND to_regclass('public.source_lead_records') IS NULL THEN
            ALTER TABLE inside_sales_leads RENAME TO source_lead_records;
        END IF;
        IF to_regclass('public.inside_sales_sync_runs') IS NOT NULL
           AND to_regclass('public.source_sync_runs') IS NULL THEN
            ALTER TABLE inside_sales_sync_runs RENAME TO source_sync_runs;
        END IF;
    END $$;
    """,
    """
    DO $$
    DECLARE
        r RECORD;
        renames CONSTANT text[][] := ARRAY[
            ['uq_inside_sales_calls_tenant_app_activity', 'uq_source_call_records_tenant_app_activity', 'source_call_records'],
            ['uq_inside_sales_leads_tenant_app_prospect',  'uq_source_lead_records_tenant_app_prospect',  'source_lead_records']
        ];
        pair text[];
    BEGIN
        FOREACH pair SLICE 1 IN ARRAY renames LOOP
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = pair[1])
               AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = pair[2]) THEN
                EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', pair[3], pair[1], pair[2]);
            END IF;
        END LOOP;
    END $$;
    """,
    """
    DO $$
    DECLARE
        renames CONSTANT text[][] := ARRAY[
            ['idx_inside_sales_calls_tenant_app_call_started',       'idx_source_call_records_tenant_app_call_started'],
            ['idx_inside_sales_calls_tenant_app_created',            'idx_source_call_records_tenant_app_created'],
            ['idx_inside_sales_calls_tenant_app_activity_time',      'idx_source_call_records_tenant_app_activity_time'],
            ['idx_inside_sales_calls_tenant_app_activity_agent',     'idx_source_call_records_tenant_app_activity_agent'],
            ['idx_inside_sales_calls_tenant_app_agent',              'idx_source_call_records_tenant_app_agent'],
            ['idx_inside_sales_calls_tenant_app_direction',          'idx_source_call_records_tenant_app_direction'],
            ['idx_inside_sales_calls_tenant_app_status',             'idx_source_call_records_tenant_app_status'],
            ['idx_inside_sales_calls_tenant_app_prospect',           'idx_source_call_records_tenant_app_prospect'],
            ['idx_inside_sales_calls_tenant_app_recording',          'idx_source_call_records_tenant_app_recording'],
            ['idx_inside_sales_leads_tenant_app_created',            'idx_source_lead_records_tenant_app_created'],
            ['idx_inside_sales_leads_tenant_app_created_prospect',   'idx_source_lead_records_tenant_app_created_prospect'],
            ['idx_inside_sales_leads_tenant_app_last_activity',      'idx_source_lead_records_tenant_app_last_activity'],
            ['idx_inside_sales_leads_tenant_app_stage',              'idx_source_lead_records_tenant_app_stage'],
            ['idx_inside_sales_leads_tenant_app_agent',              'idx_source_lead_records_tenant_app_agent'],
            ['idx_inside_sales_leads_tenant_app_city',               'idx_source_lead_records_tenant_app_city'],
            ['idx_inside_sales_leads_tenant_app_condition',          'idx_source_lead_records_tenant_app_condition'],
            ['idx_inside_sales_leads_tenant_app_mql',                'idx_source_lead_records_tenant_app_mql'],
            ['idx_inside_sales_sync_runs_tenant_app_created',        'idx_source_sync_runs_tenant_app_created'],
            ['idx_inside_sales_sync_runs_tenant_family_status',      'idx_source_sync_runs_tenant_family_status'],
            ['idx_inside_sales_sync_runs_tenant_family_completed',   'idx_source_sync_runs_tenant_family_completed']
        ];
        pair text[];
    BEGIN
        FOREACH pair SLICE 1 IN ARRAY renames LOOP
            IF EXISTS (
                SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = pair[1] AND c.relkind = 'i' AND n.nspname = 'public'
            ) AND NOT EXISTS (
                SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = pair[2] AND c.relkind = 'i' AND n.nspname = 'public'
            ) THEN
                EXECUTE format('ALTER INDEX %I RENAME TO %I', pair[1], pair[2]);
            END IF;
        END LOOP;
    END $$;
    """,
)

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
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS depends_on_job_id UUID",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_job_id UUID",
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_jobs_depends_on_job_id'
        ) THEN
            ALTER TABLE jobs ADD CONSTRAINT fk_jobs_depends_on_job_id
            FOREIGN KEY (depends_on_job_id) REFERENCES jobs(id) ON DELETE SET NULL;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_jobs_scheduled_job_id'
        ) THEN
            ALTER TABLE jobs ADD CONSTRAINT fk_jobs_scheduled_job_id
            FOREIGN KEY (scheduled_job_id) REFERENCES scheduled_jobs(id) ON DELETE SET NULL;
        END IF;
    END $$;
    """,
    "CREATE INDEX IF NOT EXISTS idx_jobs_depends_on ON jobs (depends_on_job_id)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_job_created ON jobs (scheduled_job_id, created_at)",
    "ALTER TABLE source_sync_runs ADD COLUMN IF NOT EXISTS job_id UUID",
    "ALTER TABLE source_sync_runs ADD COLUMN IF NOT EXISTS is_scheduled_run BOOLEAN NOT NULL DEFAULT FALSE",
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_source_sync_runs_job_id'
        ) THEN
            ALTER TABLE source_sync_runs ADD CONSTRAINT fk_source_sync_runs_job_id
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
        END IF;
    END $$;
    """,
    "CREATE INDEX IF NOT EXISTS idx_source_sync_runs_tenant_app_family_scheduled ON source_sync_runs (tenant_id, app_id, source_family, is_scheduled_run, completed_at)",
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
    "CREATE INDEX IF NOT EXISTS idx_source_call_records_tenant_app_activity_time ON source_call_records (tenant_id, app_id, COALESCE(call_started_at, created_on) DESC, activity_id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_source_call_records_tenant_app_activity_agent ON source_call_records (tenant_id, app_id, COALESCE(call_started_at, created_on), agent_name_normalized, agent_name) WHERE agent_name IS NOT NULL AND agent_name_normalized IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_source_lead_records_tenant_app_created_prospect ON source_lead_records (tenant_id, app_id, created_on DESC, prospect_id DESC)",
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
    "ALTER TABLE analytics_charts ADD COLUMN IF NOT EXISTS source_session_id UUID",
    "ALTER TABLE analytics_dashboards ADD COLUMN IF NOT EXISTS source_session_id UUID",
    "ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS source_session_id UUID",
    "ALTER TABLE sherlock_runtime_turns ADD COLUMN IF NOT EXISTS correlation_id UUID",
    "CREATE INDEX IF NOT EXISTS idx_sherlock_runtime_turn_correlation_id ON sherlock_runtime_turns (correlation_id) WHERE correlation_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_llm_usage_correlation_id ON llm_usage (correlation_id) WHERE correlation_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_llm_usage_status_error ON llm_usage (tenant_id, created_at) WHERE status <> 'ok'",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_usage_idempotency_key ON llm_usage (idempotency_key) WHERE idempotency_key IS NOT NULL",
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
    t0 = time.perf_counter()
    _log.info("bootstrap_database_schema: start")
    async with engine.begin() as conn:
        await conn.execute(
            text(
                f'SELECT pg_advisory_xact_lock({SCHEMA_BOOTSTRAP_LOCK_KEY_1}, {SCHEMA_BOOTSTRAP_LOCK_KEY_2})'
            )
        )

        for statement in PRE_CREATE_RENAME_SQL:
            await conn.execute(text(statement))

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
    _log.info(
        "bootstrap_database_schema: done took_ms=%.0f",
        (time.perf_counter() - t0) * 1000.0,
    )
