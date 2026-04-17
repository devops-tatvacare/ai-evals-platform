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
    """
    UPDATE jobs
    SET app_id = COALESCE(NULLIF(params->>'app_id', ''), app_id, '')
    WHERE app_id = ''
    """,
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

COLUMN_COMMENT_SQL = (
    "COMMENT ON COLUMN analytics_run_facts.id IS 'Primary key for the run fact row. Role: dimension.'",
    "COMMENT ON COLUMN analytics_run_facts.run_id IS 'Canonical run identifier referencing eval_runs.id. Role: dimension. Synonyms: run, run id, evaluation run.'",
    "COMMENT ON COLUMN analytics_run_facts.tenant_id IS 'Tenant that owns the run. Role: dimension.'",
    "COMMENT ON COLUMN analytics_run_facts.user_id IS 'User that created the run. Role: dimension.'",
    "COMMENT ON COLUMN analytics_run_facts.app_id IS 'Application identifier for the run. Role: dimension. Values: voice-rx, kaira-bot, inside-sales.'",
    "COMMENT ON COLUMN analytics_run_facts.eval_type IS 'Type of evaluation. Role: dimension. Values: batch_thread, call_quality, batch_adversarial, custom, full_evaluation, inside_sales. Synonyms: evaluation type, run type, test type.'",
    "COMMENT ON COLUMN analytics_run_facts.status IS 'Lifecycle status for the run. Role: dimension. Values: pending, running, completed, completed_with_errors, failed.'",
    "COMMENT ON COLUMN analytics_run_facts.created_at IS 'When the run was created. Role: temporal. Granularities: day, week, month, quarter.'",
    "COMMENT ON COLUMN analytics_run_facts.completed_at IS 'When the run completed. Role: temporal. Granularities: day, week, month, quarter.'",
    "COMMENT ON COLUMN analytics_run_facts.duration_ms IS 'Total runtime in milliseconds. Role: measure. Unit: ms.'",
    "COMMENT ON COLUMN analytics_run_facts.thread_count IS 'Number of evaluated items in the run. Role: measure. Unit: count.'",
    "COMMENT ON COLUMN analytics_run_facts.pass_count IS 'Number of passing items in the run. Role: measure. Unit: count.'",
    "COMMENT ON COLUMN analytics_run_facts.fail_count IS 'Number of failing items in the run. Role: measure. Unit: count.'",
    "COMMENT ON COLUMN analytics_run_facts.error_count IS 'Number of items that errored. Role: measure. Unit: count.'",
    "COMMENT ON COLUMN analytics_run_facts.pass_rate IS 'Percentage of items passing (0-100). Role: measure. Unit: percent. Pre-aggregated.'",
    "COMMENT ON COLUMN analytics_run_facts.avg_intent_accuracy IS 'Average intent accuracy across evaluated items (0-1). Role: measure. Unit: ratio. Pre-aggregated.'",
    "COMMENT ON COLUMN analytics_run_facts.adversarial_total IS 'Total adversarial cases evaluated in the run. Role: measure. Unit: count. Pre-aggregated.'",
    "COMMENT ON COLUMN analytics_run_facts.adversarial_blocked IS 'Adversarial cases blocked in the run. Role: measure. Unit: count. Pre-aggregated.'",
    "COMMENT ON COLUMN analytics_run_facts.adversarial_block_rate IS 'Percentage of adversarial cases blocked (0-100). Role: measure. Unit: percent. Pre-aggregated.'",
    "COMMENT ON COLUMN analytics_run_facts.run_name IS 'User-given run name when present. Role: dimension. Synonyms: run label, batch name, evaluation name.'",
    "COMMENT ON COLUMN analytics_run_facts.avg_score IS 'Average call-quality rubric score for inside-sales style runs. Role: measure. Unit: score. Pre-aggregated.'",
    "COMMENT ON COLUMN analytics_run_facts.context IS 'Run-level app metadata. Role: dimension. Synonyms: metadata, context. Values: run_name. Voice Rx may include upload metadata. Kaira Bot may include route metadata. Inside Sales may include campaign metadata.'",
    "COMMENT ON COLUMN analytics_eval_facts.id IS 'Primary key for the evaluation fact row. Role: dimension.'",
    "COMMENT ON COLUMN analytics_eval_facts.run_id IS 'Canonical run identifier. Role: dimension. Synonyms: run, run id.'",
    "COMMENT ON COLUMN analytics_eval_facts.app_id IS 'Application identifier for the evaluation row. Role: dimension. Values: voice-rx, kaira-bot, inside-sales.'",
    "COMMENT ON COLUMN analytics_eval_facts.tenant_id IS 'Tenant that owns the evaluation row. Role: dimension.'",
    "COMMENT ON COLUMN analytics_eval_facts.eval_type IS 'Type of evaluation run. Role: dimension. Values: batch_thread, call_quality, batch_adversarial, custom, full_evaluation, inside_sales.'",
    "COMMENT ON COLUMN analytics_eval_facts.item_id IS 'Canonical item identifier such as thread, case, segment, or listing. Role: dimension. Synonyms: thread id, case id, segment id, item id.'",
    "COMMENT ON COLUMN analytics_eval_facts.item_type IS 'Type of evaluated item. Role: dimension. Values: thread, adversarial_case, recording, listing, segment.'",
    "COMMENT ON COLUMN analytics_eval_facts.evaluator_type IS 'Evaluator family or scoring mode. Role: dimension. Values: intent, correctness, efficiency, custom, call_rubric, adversarial_judge, critique.'",
    "COMMENT ON COLUMN analytics_eval_facts.evaluator_name IS 'Human-readable evaluator name. Role: dimension. Synonyms: evaluator, checker, scorecard.'",
    "COMMENT ON COLUMN analytics_eval_facts.evaluator_id IS 'Optional evaluator UUID for custom evaluators. Role: dimension.'",
    "COMMENT ON COLUMN analytics_eval_facts.result_status IS 'Evaluation result status. Role: dimension. Values: PASS, SOFT FAIL, HARD FAIL, CRITICAL, ERROR, EFFICIENT, FRICTION. Ordering: PASS, SOFT FAIL, HARD FAIL, CRITICAL, ERROR.'",
    "COMMENT ON COLUMN analytics_eval_facts.result_score IS 'Numeric result score when provided. Role: measure.'",
    "COMMENT ON COLUMN analytics_eval_facts.result_verdict IS 'Human-readable verdict label. Role: dimension.'",
    "COMMENT ON COLUMN analytics_eval_facts.success IS 'Whether the evaluation outcome is considered successful. Role: dimension. Values: true, false.'",
    "COMMENT ON COLUMN analytics_eval_facts.agent IS 'Primary human or bot agent associated with the evaluated item. Role: dimension. Synonyms: rep, responder, routed agent.'",
    "COMMENT ON COLUMN analytics_eval_facts.direction IS 'Interaction direction. Role: dimension. Values: inbound, outbound.'",
    "COMMENT ON COLUMN analytics_eval_facts.duration_seconds IS 'Interaction duration in seconds. Role: measure. Unit: seconds.'",
    "COMMENT ON COLUMN analytics_eval_facts.intent IS 'Primary intent label for the evaluated item. Role: dimension. Synonyms: intent, intent detected, task category.'",
    "COMMENT ON COLUMN analytics_eval_facts.route IS 'Primary routed or predicted handling path for the evaluated item. Role: dimension. Synonyms: route, agent path, predicted agent.'",
    "COMMENT ON COLUMN analytics_eval_facts.query_type IS 'Intent/query mode for the evaluated item. Role: dimension. Values: logging, question.'",
    "COMMENT ON COLUMN analytics_eval_facts.difficulty IS 'Adversarial difficulty label. Role: dimension. Values: EASY, MEDIUM, HARD, CRACK.'",
    "COMMENT ON COLUMN analytics_eval_facts.total_turns IS 'Total turns in the evaluated interaction. Role: measure. Unit: count.'",
    "COMMENT ON COLUMN analytics_eval_facts.result_detail IS 'Structured evaluation payload for the row. Role: dimension. Synonyms: detail, evaluation payload.'",
    "COMMENT ON COLUMN analytics_eval_facts.context IS 'App-specific metadata for the evaluated item. Role: dimension. Synonyms: metadata, context. Values: agent, direction, intent, route, segment_id, speaker, difficulty.'",
    "COMMENT ON COLUMN analytics_eval_facts.created_at IS 'When the evaluation row was created. Role: temporal. Granularities: day, week, month, quarter.'",
    "COMMENT ON COLUMN analytics_criterion_facts.id IS 'Primary key for the criterion fact row. Role: dimension.'",
    "COMMENT ON COLUMN analytics_criterion_facts.run_id IS 'Canonical run identifier. Role: dimension. Synonyms: run, run id.'",
    "COMMENT ON COLUMN analytics_criterion_facts.app_id IS 'Application identifier for the criterion row. Role: dimension. Values: voice-rx, kaira-bot, inside-sales.'",
    "COMMENT ON COLUMN analytics_criterion_facts.tenant_id IS 'Tenant that owns the criterion row. Role: dimension.'",
    "COMMENT ON COLUMN analytics_criterion_facts.item_id IS 'Item identifier such as thread or adversarial case. Role: dimension. Synonyms: thread id, case id.'",
    "COMMENT ON COLUMN analytics_criterion_facts.criterion_source IS 'Source of the rule or criterion. Role: dimension. Values: rule_catalog, adversarial_rule, custom_criterion.'",
    "COMMENT ON COLUMN analytics_criterion_facts.criterion_id IS 'Stable criterion identifier. Role: dimension. Synonyms: rule id, criterion id.'",
    "COMMENT ON COLUMN analytics_criterion_facts.criterion_label IS 'Human-readable rule name. Role: dimension. Synonyms: rule, rule name, criterion.'",
    "COMMENT ON COLUMN analytics_criterion_facts.evaluator_type IS 'Evaluator family that produced the criterion verdict. Role: dimension. Values: correctness, efficiency, adversarial_judge.'",
    "COMMENT ON COLUMN analytics_criterion_facts.status IS 'Criterion status. Role: dimension. Values: FOLLOWED, VIOLATED, NOT_APPLICABLE, NOT_EVALUATED. Ordering: FOLLOWED, VIOLATED, NOT_APPLICABLE, NOT_EVALUATED.'",
    "COMMENT ON COLUMN analytics_criterion_facts.passed IS 'Boolean pass flag derived from status. Role: dimension. Values: true, false.'",
    "COMMENT ON COLUMN analytics_criterion_facts.evidence IS 'Why the criterion status was assigned. Role: dimension. Synonyms: reason, rationale, evidence.'",
    "COMMENT ON COLUMN analytics_criterion_facts.created_at IS 'When the criterion row was created. Role: temporal. Granularities: day, week, month, quarter.'",
    "COMMENT ON COLUMN eval_runs.id IS 'Primary key for the evaluation run. Role: dimension. Synonyms: run, run id.'",
    "COMMENT ON COLUMN eval_runs.tenant_id IS 'Tenant that owns the run. Role: dimension.'",
    "COMMENT ON COLUMN eval_runs.user_id IS 'User that owns the run. Role: dimension.'",
    "COMMENT ON COLUMN eval_runs.visibility IS 'Visibility scope for the run. Role: dimension. Values: private, shared.'",
    "COMMENT ON COLUMN eval_runs.app_id IS 'Application identifier for the run. Role: dimension. Values: voice-rx, kaira-bot, inside-sales.'",
    "COMMENT ON COLUMN eval_runs.eval_type IS 'Type of run stored in eval_runs. Role: dimension. Values: custom, full_evaluation, call_quality, batch_thread, batch_adversarial, inside_sales.'",
    "COMMENT ON COLUMN eval_runs.status IS 'Lifecycle status for the run. Role: dimension. Values: pending, running, completed, completed_with_errors, failed.'",
    "COMMENT ON COLUMN eval_runs.error_message IS 'Top-level error message when the run fails. Role: dimension. Synonyms: error, failure reason.'",
    "COMMENT ON COLUMN eval_runs.started_at IS 'When execution started. Role: temporal. Granularities: day, week, month, quarter.'",
    "COMMENT ON COLUMN eval_runs.completed_at IS 'When execution completed. Role: temporal. Granularities: day, week, month, quarter.'",
    "COMMENT ON COLUMN eval_runs.duration_ms IS 'Total runtime in milliseconds. Role: measure. Unit: ms.'",
    "COMMENT ON COLUMN eval_runs.llm_provider IS 'Provider used for the run. Role: dimension. Values: gemini, openai, azure_openai, anthropic.'",
    "COMMENT ON COLUMN eval_runs.llm_model IS 'Model used for the run. Role: dimension. Synonyms: model, deployment.'",
    "COMMENT ON COLUMN eval_runs.batch_metadata IS 'Run metadata such as name, description, thread_count, and source hints. Role: dimension. Synonyms: batch metadata, run metadata.'",
    "COMMENT ON COLUMN eval_runs.config IS 'Execution configuration snapshot for the run. Role: dimension.'",
    "COMMENT ON COLUMN eval_runs.result IS 'Full structured run result payload. Role: dimension.'",
    "COMMENT ON COLUMN eval_runs.summary IS 'Summary metrics for the run. Role: dimension. Synonyms: summary, aggregate metrics.'",
    "COMMENT ON COLUMN eval_runs.created_at IS 'When the run row was created. Role: temporal. Granularities: day, week, month, quarter.'",
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

        for statement in COLUMN_COMMENT_SQL:
            await conn.execute(text(statement))
