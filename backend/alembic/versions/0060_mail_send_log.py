"""mail_send_log table — one row per transactional send attempt.

Revision ID: 0060
Revises: 0059
Create Date: 2026-05-19
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0060"
down_revision: Union[str, None] = "0059"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mail_send_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("call_site", sa.String(64), nullable=False),
        sa.Column("recipient", sa.String(320), nullable=False),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("provider_response", postgresql.JSONB(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("correlation_id", sa.String(64), nullable=True),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["platform.tenants.id"], ondelete="CASCADE"
        ),
        schema="platform",
    )
    op.create_index(
        "idx_mail_send_log_tenant_sent_at",
        "mail_send_log",
        ["tenant_id", "sent_at"],
        schema="platform",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_mail_send_log_tenant_sent_at",
        table_name="mail_send_log",
        schema="platform",
    )
    op.drop_table("mail_send_log", schema="platform")
