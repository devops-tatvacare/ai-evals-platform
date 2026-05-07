"""add provider_correlation_id column on orchestration.workflow_run_recipient_actions

Revision ID: 0027_add_provider_correlation_id_on_actions
Revises: 0026_retire_legacy_poller_schedules
Create Date: 2026-05-05

Channel-agnostic upstream correlation id captured at dispatch time:

  - Bolna single  → execution_id
  - Bolna batch   → batch_id   (also stamped on bolna_batch_id for the
                                Phase 13/E.2 poller index)
  - WATI          → localMessageId
  - SMS / generic → provider-returned id

Lets cross-channel reporting queries SELECT one column instead of a
COALESCE ladder over JSONB blobs. The pre-existing channel-specific
``bolna_execution_id`` / ``bolna_batch_id`` columns stay because the
per-correlation poller's partial index targets them by name; this new
column is additive.

Partial index restricts to non-null values so workflows that don't
write a correlation id (logic / sink nodes) don't bloat the index.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0027_add_provider_correlation_id_on_actions"
down_revision: Union[str, None] = "0026_retire_legacy_poller_schedules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE orchestration.workflow_run_recipient_actions
            ADD COLUMN provider_correlation_id VARCHAR(128)
        """
    )
    op.execute(
        "CREATE INDEX idx_orch_actions_provider_correlation_id "
        "ON orchestration.workflow_run_recipient_actions "
        "(provider_correlation_id) "
        "WHERE provider_correlation_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS orchestration.idx_orch_actions_provider_correlation_id"
    )
    op.execute(
        """
        ALTER TABLE orchestration.workflow_run_recipient_actions
            DROP COLUMN IF EXISTS provider_correlation_id
        """
    )
