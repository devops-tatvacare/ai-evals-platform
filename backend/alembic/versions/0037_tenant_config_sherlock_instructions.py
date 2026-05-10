"""sherlock v3 — tenant_configurations.sherlock_instructions (Phase 3)

Revision ID: 0037_tenant_config_sherlock_instructions
Revises: 0036_sherlock_verified_queries
Create Date: 2026-05-10

Adds the per-tenant override slot for the data_specialist instruction
block. App-default rules live in
``backend/app/services/sherlock_v3/instructions/<app_id>.md``; this column
is the live override surface tenant admins can set without a deploy.

Nullable on purpose — empty / NULL means "use app default only".
``instructions.load_instructions`` concatenates app default first, then
this override, so tenant rules take precedence by document order.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0037_tenant_config_sherlock_instructions"
down_revision: Union[str, None] = "0036_sherlock_verified_queries"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenant_configurations",
        sa.Column("sherlock_instructions", sa.Text(), nullable=True),
        schema="platform",
    )


def downgrade() -> None:
    op.drop_column(
        "tenant_configurations",
        "sherlock_instructions",
        schema="platform",
    )
