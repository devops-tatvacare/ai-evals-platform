"""0066 — communication cap policy table + action phone generated column.

Adds ``platform.comm_cap_policies`` for per tenant + app rolling-window
communication caps, plus a stored ``contact_phone_e164`` generated column on
``orchestration.workflow_run_recipient_actions`` so cap counting is a cheap
index seek over ``(tenant_id, app_id, contact_phone_e164, created_at)``.

The generated column reads ``payload ->> 'contact'``, which is the canonical
phone key written by every dispatch node (CLAUDE.md invariant).

Revision ID: 0066
Revises: 0065
Create Date: 2026-05-20
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0066"
down_revision: Union[str, None] = "0065"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "comm_cap_policies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("app_id", sa.String(64), nullable=False),
        sa.Column("max_count", sa.Integer(), nullable=False),
        sa.Column("window_seconds", sa.Integer(), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.CheckConstraint("max_count > 0", name="ck_comm_cap_max_count_positive"),
        sa.CheckConstraint(
            "window_seconds > 0", name="ck_comm_cap_window_positive"
        ),
        sa.UniqueConstraint("tenant_id", "app_id", name="uq_comm_cap_per_app"),
        schema="platform",
    )

    op.execute(
        "ALTER TABLE orchestration.workflow_run_recipient_actions "
        "ADD COLUMN contact_phone_e164 TEXT "
        "GENERATED ALWAYS AS (payload ->> 'contact') STORED"
    )
    op.create_index(
        "ix_orch_actions_phone_window",
        "workflow_run_recipient_actions",
        ["tenant_id", "app_id", "contact_phone_e164", "created_at"],
        schema="orchestration",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_orch_actions_phone_window",
        table_name="workflow_run_recipient_actions",
        schema="orchestration",
    )
    op.execute(
        "ALTER TABLE orchestration.workflow_run_recipient_actions "
        "DROP COLUMN contact_phone_e164"
    )
    op.drop_table("comm_cap_policies", schema="platform")
