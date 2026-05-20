"""0070 — per-workflow waiting-tail TTL.

Adds ``orchestration.workflows.max_wait_after_completion_seconds`` (nullable).
When set, the ``orchestration-waiting-tail-sweep`` job aborts recipients still
parked in ``waiting`` after a run completed more than this many seconds ago.
NULL falls back to the sweep's platform default.

Revision ID: 0070
Revises: 0069
Create Date: 2026-05-20
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0070"
down_revision: Union[str, None] = "0069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "workflows",
        sa.Column(
            "max_wait_after_completion_seconds", sa.Integer(), nullable=True
        ),
        schema="orchestration",
    )


def downgrade() -> None:
    op.drop_column(
        "workflows", "max_wait_after_completion_seconds", schema="orchestration"
    )
