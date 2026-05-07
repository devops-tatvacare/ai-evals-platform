"""soft-archive orchestration workflows

Revision ID: 0029_soft_archive_workflows
Revises: 0028_backfill_provider_correlation_id
Create Date: 2026-05-05

The archive endpoint should preserve workflow lineage and runtime history.
Hard-deleting a workflow row breaks once `workflow_runs` and related runtime
tables reference it, so archive becomes a soft delete backed by a persisted
`workflows.active` flag.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0029_soft_archive_workflows"
down_revision: Union[str, None] = "0028_backfill_provider_correlation_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "workflows",
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema="orchestration",
    )


def downgrade() -> None:
    op.drop_column("workflows", "active", schema="orchestration")
