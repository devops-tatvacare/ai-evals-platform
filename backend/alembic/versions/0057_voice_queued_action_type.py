"""rename bolna_queued → voice_queued in the no-double-dispatch partial index

Revision ID: 0057
Revises: 0056
Create Date: 2026-05-19

The capability-named voice node now emits action_type='voice_queued' instead
of the vendor-named 'bolna_queued'. The partial unique index from 0019
gates pending-dispatch deduplication on this string, so it must be rebuilt
to recognise the new name.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = '0057'
down_revision: Union[str, None] = '0056'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS orchestration.idx_orch_actions_no_double_dispatch")
    op.execute(
        "CREATE UNIQUE INDEX idx_orch_actions_no_double_dispatch "
        "ON orchestration.workflow_run_recipient_actions (tenant_id, recipient_id) "
        "WHERE status = 'pending' AND action_type IN ('wa_dispatched', 'voice_queued')"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS orchestration.idx_orch_actions_no_double_dispatch")
    op.execute(
        "CREATE UNIQUE INDEX idx_orch_actions_no_double_dispatch "
        "ON orchestration.workflow_run_recipient_actions (tenant_id, recipient_id) "
        "WHERE status = 'pending' AND action_type IN ('wa_dispatched', 'bolna_queued')"
    )
