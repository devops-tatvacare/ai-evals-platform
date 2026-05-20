"""mail_send_log.html_cached_at_send — cached rendered HTML for admin preview.

Revision ID: 0067
Revises: 0066
Create Date: 2026-05-20
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0067"
down_revision: Union[str, None] = "0066"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "mail_send_log",
        sa.Column("html_cached_at_send", sa.Text(), nullable=True),
        schema="platform",
    )


def downgrade() -> None:
    op.drop_column("mail_send_log", "html_cached_at_send", schema="platform")
