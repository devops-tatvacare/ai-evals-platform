"""Shared database schema bootstrap for backend and worker entrypoints."""

from sqlalchemy import text

from app.database import engine
from app.models import Base

SCHEMA_BOOTSTRAP_LOCK_KEY_1 = 8721
SCHEMA_BOOTSTRAP_LOCK_KEY_2 = 1

SCHEMA_BOOTSTRAP_SQL = (
    "DROP TABLE IF EXISTS lsq_call_cache",
    "ALTER TABLE schemas ADD COLUMN IF NOT EXISTS source_type VARCHAR(20)",
    "ALTER TABLE eval_runs DROP COLUMN IF EXISTS report_cache",
    "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private'",
    "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS shared_by UUID",
    "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ",
    "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS latest_review_id UUID",
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
    "CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant_visibility_created ON eval_runs (tenant_id, visibility, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_eval_runs_latest_review ON eval_runs (latest_review_id)",
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
