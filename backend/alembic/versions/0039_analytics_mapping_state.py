"""phase 2 - analytics.mapping_state for operator-disable on mirror->fact mappings

Revision ID: 0039_analytics_mapping_state
Revises: 0038_rename_crm_columns_and_fact_dim_adds
Create Date: 2026-05-13

Phase 2 of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

Persistence for per-mapping operator-disable state. One row per
``(app_id, source_table, target_fact, activity_type)``; ``enabled=false``
means steady-state sync skips fact writes for that mapping (Phase 3 wires
this read into ``inside_sales_sync``). Seeded with the inside-sales call
mapping at ``enabled=true`` so the first mapping ships in a known state.

Schema-qualifies every raw SQL statement per the Roadmap 01 invariant.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0039_analytics_mapping_state"
down_revision: Union[str, None] = "0038_rename_crm_columns_and_fact_dim_adds"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mapping_state",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("app_id", sa.String(length=64), nullable=False),
        sa.Column("source_table", sa.String(length=255), nullable=False),
        sa.Column("target_fact", sa.String(length=255), nullable=False),
        sa.Column("activity_type", sa.String(length=64), nullable=False),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "disabled_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "disabled_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("disabled_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "app_id",
            "source_table",
            "target_fact",
            "activity_type",
            name="uq_mapping_state_app_source_target_activity",
        ),
        schema="analytics",
    )

    # Seed the first mapping. ``ON CONFLICT DO NOTHING`` makes the seed
    # idempotent across upgrade/downgrade/upgrade cycles in dev.
    op.execute(
        sa.text(
            """
            INSERT INTO analytics.mapping_state (
                app_id, source_table, target_fact, activity_type, enabled
            )
            VALUES (
                'inside-sales',
                'analytics.crm_call_record',
                'analytics.fact_lead_activity',
                'call',
                true
            )
            ON CONFLICT ON CONSTRAINT uq_mapping_state_app_source_target_activity
            DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.drop_table("mapping_state", schema="analytics")
