"""add bolna_execution_id / bolna_batch_id / provider_status / provider_terminal columns
on orchestration.workflow_run_recipient_actions, plus a partial index on the
two correlation ids restricted to open rows.

Revision ID: 0024_dispatch_capture_columns
Revises: 0023_create_cohort_datasets
Create Date: 2026-05-04

Phase 13/E.2 prerequisite for the ``poll-bolna-executions`` job:

- ``bolna_execution_id`` / ``bolna_batch_id``: indexed correlation ids. The
  poller fetches open rows whose ``completed_at IS NULL`` and matches
  Bolna's executions against them. JSONB key existence indexes were the
  alternative; explicit columns keep the 30s poller query simple and
  cheap.
- ``provider_status``: lower-cased upstream status string. Surfaces the
  in-flight signal even before the row reaches a terminal state.
- ``provider_terminal``: boolean shortcut used by the poller's WHERE
  clause. Avoids re-deriving terminal-ness from the status string on
  every sweep.

A partial index ``WHERE completed_at IS NULL`` keeps the open-row scan
cheap regardless of total table size.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0024_dispatch_capture_columns"
down_revision: Union[str, None] = "0023_create_cohort_datasets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE orchestration.workflow_run_recipient_actions
            ADD COLUMN bolna_execution_id VARCHAR(128),
            ADD COLUMN bolna_batch_id     VARCHAR(128),
            ADD COLUMN provider_status    VARCHAR(64),
            ADD COLUMN provider_terminal  BOOLEAN NOT NULL DEFAULT FALSE
        """
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_recipient_actions_open_bolna "
        "ON orchestration.workflow_run_recipient_actions "
        "(bolna_execution_id, bolna_batch_id) "
        "WHERE completed_at IS NULL "
        "AND channel = 'bolna' "
        "AND (bolna_execution_id IS NOT NULL OR bolna_batch_id IS NOT NULL)"
    )


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS orchestration.idx_workflow_run_recipient_actions_open_bolna"
    )
    op.execute(
        """
        ALTER TABLE orchestration.workflow_run_recipient_actions
            DROP COLUMN IF EXISTS provider_terminal,
            DROP COLUMN IF EXISTS provider_status,
            DROP COLUMN IF EXISTS bolna_batch_id,
            DROP COLUMN IF EXISTS bolna_execution_id
        """
    )
