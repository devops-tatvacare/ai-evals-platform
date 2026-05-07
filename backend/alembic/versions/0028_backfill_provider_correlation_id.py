"""backfill provider_correlation_id on historical workflow_run_recipient_actions

Revision ID: 0028_backfill_provider_correlation_id
Revises: 0027_add_provider_correlation_id_on_actions
Create Date: 2026-05-05

Migration 0027 added the channel-agnostic ``provider_correlation_id``
column. New rows write it via ``update_action_result``, but every
historical row stays NULL until backfilled — which would silently break
any reporting query that filters on the column.

This migration walks the table once and populates from the channel-
specific source-of-truth keys:

  - **Bolna**: ``bolna_execution_id`` (singles) or ``bolna_batch_id``
    (batches). Single column on the row; never both.
  - **WATI**: ``response.localMessageId`` if present at the top level,
    otherwise the first non-empty ``receivers[].localMessageId``.
  - **LSQ**: ``response.ProspectActivityId`` for activity rows;
    ``recipient_id`` for stage updates (which don't emit a separate
    correlation id).
  - **Clinical**: ``response.outbox_row_id`` if persisted (rows older
    than 0027 don't have it).

Idempotent — only updates rows where ``provider_correlation_id IS NULL``
and a backfill source exists. Safe to re-run.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0028_backfill_provider_correlation_id"
down_revision: Union[str, None] = "0027_add_provider_correlation_id_on_actions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Bolna — column-level source. Single statement covers both modes
    # (singles set bolna_execution_id, batches set bolna_batch_id).
    op.execute(
        """
        UPDATE orchestration.workflow_run_recipient_actions
        SET provider_correlation_id = COALESCE(bolna_execution_id, bolna_batch_id)
        WHERE provider_correlation_id IS NULL
          AND channel = 'bolna'
          AND (bolna_execution_id IS NOT NULL OR bolna_batch_id IS NOT NULL)
        """
    )

    # WATI top-level localMessageId.
    op.execute(
        """
        UPDATE orchestration.workflow_run_recipient_actions
        SET provider_correlation_id = response->>'localMessageId'
        WHERE provider_correlation_id IS NULL
          AND channel = 'wati'
          AND response ? 'localMessageId'
          AND length(response->>'localMessageId') > 0
        """
    )

    # WATI broadcast shape — receivers[0].localMessageId. The ``->`` /
    # ``->>`` chain navigates JSONB; the IS NOT NULL gate skips rows
    # whose receivers array is empty or malformed.
    op.execute(
        """
        UPDATE orchestration.workflow_run_recipient_actions
        SET provider_correlation_id = response->'receivers'->0->>'localMessageId'
        WHERE provider_correlation_id IS NULL
          AND channel = 'wati'
          AND response->'receivers'->0->>'localMessageId' IS NOT NULL
          AND length(response->'receivers'->0->>'localMessageId') > 0
        """
    )

    # LSQ activity rows — ProspectActivityId is the natural correlation.
    op.execute(
        """
        UPDATE orchestration.workflow_run_recipient_actions
        SET provider_correlation_id = response->>'ProspectActivityId'
        WHERE provider_correlation_id IS NULL
          AND channel = 'lsq'
          AND action_type = 'lsq_activity_logged'
          AND response ? 'ProspectActivityId'
          AND length(response->>'ProspectActivityId') > 0
        """
    )

    # LSQ stage updates — fallback to recipient_id (LSQ Lead.Update has
    # no separate update id; the prospect_id IS the correlation handle).
    op.execute(
        """
        UPDATE orchestration.workflow_run_recipient_actions
        SET provider_correlation_id = recipient_id
        WHERE provider_correlation_id IS NULL
          AND channel = 'lsq'
          AND action_type = 'lsq_stage_updated'
        """
    )

    # Clinical outbox rows — outbox_row_id is captured on the response
    # for rows created after 0027. Older clinical rows stay NULL (no
    # source available).
    op.execute(
        """
        UPDATE orchestration.workflow_run_recipient_actions
        SET provider_correlation_id = response->>'outbox_row_id'
        WHERE provider_correlation_id IS NULL
          AND channel = 'system'
          AND response ? 'outbox_row_id'
          AND length(response->>'outbox_row_id') > 0
        """
    )


def downgrade() -> None:
    # Backfilled values are recoverable from the same source columns
    # / JSONB keys, so the safe downgrade just nulls them out.
    op.execute(
        """
        UPDATE orchestration.workflow_run_recipient_actions
        SET provider_correlation_id = NULL
        """
    )
