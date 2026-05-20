"""scheduled_job notify columns — owner-checkbox, extra-emails list, owner-email snapshot.

Revision ID: 0065
Revises: 0064
Create Date: 2026-05-19
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0065"
down_revision: Union[str, None] = "0064"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "scheduled_job_definitions",
        sa.Column(
            "notify_owner_on_failure",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema="platform",
    )
    op.add_column(
        "scheduled_job_definitions",
        sa.Column(
            "notify_emails_on_failure",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        schema="platform",
    )
    op.add_column(
        "scheduled_job_definitions",
        sa.Column(
            "created_by_user_email_snapshot",
            sa.Text(),
            nullable=True,
        ),
        schema="platform",
    )

    # Backfill the snapshot from platform.users.email for existing schedules
    # so the "notify owner on failure" checkbox has a recipient on day one.
    op.execute(
        """
        UPDATE platform.scheduled_job_definitions sjd
        SET created_by_user_email_snapshot = u.email
        FROM platform.users u
        WHERE sjd.created_by = u.id
          AND sjd.created_by_user_email_snapshot IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column(
        "scheduled_job_definitions",
        "created_by_user_email_snapshot",
        schema="platform",
    )
    op.drop_column(
        "scheduled_job_definitions",
        "notify_emails_on_failure",
        schema="platform",
    )
    op.drop_column(
        "scheduled_job_definitions",
        "notify_owner_on_failure",
        schema="platform",
    )
