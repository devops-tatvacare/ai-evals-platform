"""drop inside-sales normalized shadow columns and replace their indexes

The legacy serving layer carried `*_normalized` shadow columns next to
the raw text columns on `source_call_records` and `source_lead_records`,
populated only at sync time. The listing query matched against the
shadow columns; the suggestions endpoint read the raw columns. Any row
that pre-dated the normalize sync code (or any drift between writes)
silently filtered out of the listing while still appearing in the
dropdowns.

This revision collapses that asymmetry: drop the shadow columns, drop
the indexes that reference them, and add functional `LOWER(col)`
indexes on the raw columns so case-insensitive equality (`func.lower(...)
.in_(...)`) stays cheap.

Revision ID: 0004_drop_inside_sales_cols
Revises: 0003_drop_redundant_fks_and_lsq
Create Date: 2026-04-27
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0004_drop_inside_sales_cols"
down_revision: Union[str, None] = "0003_drop_redundant_fks_and_lsq"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing prod DBs still have ``public.alembic_version.version_num`` as
    # ``varchar(32)`` from the pre-Alembic bootstrap path. Widen it here, in
    # the first post-0003 migration, before later long-form revision IDs are
    # written during normal ``alembic upgrade head`` boot.
    op.execute(
        "ALTER TABLE public.alembic_version "
        "ALTER COLUMN version_num TYPE varchar(255)"
    )

    # Drop indexes that reference the normalized shadow columns.
    op.execute(
        "DROP INDEX IF EXISTS idx_source_call_records_tenant_app_activity_agent"
    )
    op.execute("DROP INDEX IF EXISTS idx_source_call_records_tenant_app_agent")
    op.execute("DROP INDEX IF EXISTS idx_source_call_records_tenant_app_status")
    op.execute("DROP INDEX IF EXISTS idx_source_lead_records_tenant_app_stage")
    op.execute("DROP INDEX IF EXISTS idx_source_lead_records_tenant_app_agent")
    op.execute("DROP INDEX IF EXISTS idx_source_lead_records_tenant_app_city")
    op.execute("DROP INDEX IF EXISTS idx_source_lead_records_tenant_app_condition")

    # Drop the shadow columns themselves.
    op.execute(
        "ALTER TABLE source_call_records DROP COLUMN IF EXISTS agent_name_normalized"
    )
    op.execute(
        "ALTER TABLE source_call_records DROP COLUMN IF EXISTS status_normalized"
    )
    op.execute(
        "ALTER TABLE source_lead_records DROP COLUMN IF EXISTS prospect_stage_normalized"
    )
    op.execute(
        "ALTER TABLE source_lead_records DROP COLUMN IF EXISTS city_normalized"
    )
    op.execute(
        "ALTER TABLE source_lead_records DROP COLUMN IF EXISTS condition_normalized"
    )
    op.execute(
        "ALTER TABLE source_lead_records DROP COLUMN IF EXISTS agent_name_normalized"
    )

    # Functional LOWER(...) indexes on the raw columns to keep the new
    # case-insensitive filter clauses cheap. `IF NOT EXISTS` so a re-run
    # is safe.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_call_records_tenant_app_agent_lower "
        "ON source_call_records (tenant_id, app_id, LOWER(agent_name)) "
        "WHERE agent_name IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_call_records_tenant_app_status_lower "
        "ON source_call_records (tenant_id, app_id, LOWER(status)) "
        "WHERE status IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_lead_records_tenant_app_stage_lower "
        "ON source_lead_records (tenant_id, app_id, LOWER(prospect_stage))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_lead_records_tenant_app_agent_lower "
        "ON source_lead_records (tenant_id, app_id, LOWER(agent_name)) "
        "WHERE agent_name IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_lead_records_tenant_app_city_lower "
        "ON source_lead_records (tenant_id, app_id, LOWER(city)) "
        "WHERE city IS NOT NULL"
    )


def downgrade() -> None:
    # Drop the new functional indexes.
    op.execute(
        "DROP INDEX IF EXISTS idx_source_call_records_tenant_app_agent_lower"
    )
    op.execute(
        "DROP INDEX IF EXISTS idx_source_call_records_tenant_app_status_lower"
    )
    op.execute(
        "DROP INDEX IF EXISTS idx_source_lead_records_tenant_app_stage_lower"
    )
    op.execute(
        "DROP INDEX IF EXISTS idx_source_lead_records_tenant_app_agent_lower"
    )
    op.execute(
        "DROP INDEX IF EXISTS idx_source_lead_records_tenant_app_city_lower"
    )

    # Re-add the shadow columns (nullable, no backfill — restore is for
    # rollback safety, not data parity; a sync rerun would have repopulated
    # them in the legacy world).
    op.execute(
        "ALTER TABLE source_call_records ADD COLUMN IF NOT EXISTS agent_name_normalized varchar(255)"
    )
    op.execute(
        "ALTER TABLE source_call_records ADD COLUMN IF NOT EXISTS status_normalized varchar(50)"
    )
    op.execute(
        "ALTER TABLE source_lead_records ADD COLUMN IF NOT EXISTS prospect_stage_normalized text"
    )
    op.execute(
        "ALTER TABLE source_lead_records ADD COLUMN IF NOT EXISTS city_normalized text"
    )
    op.execute(
        "ALTER TABLE source_lead_records ADD COLUMN IF NOT EXISTS condition_normalized text"
    )
    op.execute(
        "ALTER TABLE source_lead_records ADD COLUMN IF NOT EXISTS agent_name_normalized text"
    )

    # Re-create the legacy indexes that referenced the shadow columns.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_call_records_tenant_app_activity_agent "
        "ON source_call_records (tenant_id, app_id, "
        "COALESCE(call_started_at, created_on), agent_name_normalized, agent_name) "
        "WHERE agent_name IS NOT NULL AND agent_name_normalized IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_call_records_tenant_app_agent "
        "ON source_call_records (tenant_id, app_id, agent_name_normalized)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_call_records_tenant_app_status "
        "ON source_call_records (tenant_id, app_id, status_normalized)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_lead_records_tenant_app_stage "
        "ON source_lead_records (tenant_id, app_id, prospect_stage_normalized)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_lead_records_tenant_app_agent "
        "ON source_lead_records (tenant_id, app_id, agent_name_normalized)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_lead_records_tenant_app_city "
        "ON source_lead_records (tenant_id, app_id, city_normalized)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_source_lead_records_tenant_app_condition "
        "ON source_lead_records (tenant_id, app_id, condition_normalized)"
    )

    op.execute(
        "ALTER TABLE public.alembic_version "
        "ALTER COLUMN version_num TYPE varchar(32)"
    )
