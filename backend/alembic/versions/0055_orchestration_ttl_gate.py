"""orchestration: add ignore_webhooks_after TTL gate to recipient states

Revision ID: 0055
Revises: 0054
Create Date: 2026-05-19

Phase 1 of the vendor-abstraction plan. Recipient states gain
``ignore_webhooks_after`` (TIMESTAMPTZ). Inbound webhook lookups guard
on this column at runtime so a vendor callback against an aged-out
parent action is audit-logged but never flips state.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0055'
down_revision: Union[str, None] = '0054'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'workflow_run_recipient_states',
        sa.Column('ignore_webhooks_after', sa.DateTime(timezone=True), nullable=True),
        schema='orchestration',
    )
    op.execute(
        "CREATE INDEX idx_wrrs_ignore_webhooks_after "
        "ON orchestration.workflow_run_recipient_states (recipient_id) "
        "WHERE ignore_webhooks_after IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS orchestration.idx_wrrs_ignore_webhooks_after")
    op.drop_column(
        'workflow_run_recipient_states',
        'ignore_webhooks_after',
        schema='orchestration',
    )
