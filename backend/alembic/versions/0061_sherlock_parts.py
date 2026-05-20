"""platform.sherlock_parts — typed Part stream replacing turn_events + log_sherlock_tool_call.

Phase 1A introduces the new table additively; downstream commits drop
``platform.sherlock_turn_events`` and ``analytics.log_sherlock_tool_call``
once the wire-in is complete. Keeping them through Phase 1A means the
running chat widget keeps working until the SSE collapse + frontend swap
ship together.

Revision ID: 0061
Revises: 0060
Create Date: 2026-05-19
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0061"
down_revision: Union[str, None] = "0060"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sherlock_parts",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "chat_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.chat_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("app_id", sa.Text(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("call_id", sa.Text(), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "chat_session_id", "seq", name="uq_sherlock_parts_session_seq",
        ),
        schema="platform",
    )
    op.create_index(
        "idx_sherlock_parts_session_seq",
        "sherlock_parts",
        ["chat_session_id", "seq"],
        schema="platform",
    )
    op.create_index(
        "idx_sherlock_parts_type",
        "sherlock_parts",
        ["type"],
        schema="platform",
    )
    op.create_index(
        "idx_sherlock_parts_call_id",
        "sherlock_parts",
        ["call_id"],
        schema="platform",
        postgresql_where=sa.text("call_id IS NOT NULL"),
    )
    op.create_index(
        "idx_sherlock_parts_tenant_created",
        "sherlock_parts",
        ["tenant_id", "created_at"],
        schema="platform",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_sherlock_parts_tenant_created",
        table_name="sherlock_parts",
        schema="platform",
    )
    op.drop_index(
        "idx_sherlock_parts_call_id",
        table_name="sherlock_parts",
        schema="platform",
    )
    op.drop_index(
        "idx_sherlock_parts_type",
        table_name="sherlock_parts",
        schema="platform",
    )
    op.drop_index(
        "idx_sherlock_parts_session_seq",
        table_name="sherlock_parts",
        schema="platform",
    )
    op.drop_table("sherlock_parts", schema="platform")
