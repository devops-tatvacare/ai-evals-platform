"""add available_at column on platform.background_jobs (delayed-delivery primitive)

Revision ID: 0025_background_jobs_available_at
Revises: 0024_dispatch_capture_columns
Create Date: 2026-05-05

Foundation for the per-correlation Bolna polling redesign and event-driven
``logic.wait`` / webhook resume paths. The worker claim query gates queued
jobs on ``available_at IS NULL OR available_at <= now()``. NULL means
"run-now" — every existing job written before this migration keeps that
semantic, so no backfill or migration of in-flight rows is needed.

Partial index keeps the worker pickup query bounded: only rows that are
*queued and deferred* sit in the index, the rest fall through under the
existing ``idx_background_jobs_status_priority_created``.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0025_background_jobs_available_at"
down_revision: Union[str, None] = "0024_dispatch_capture_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE platform.background_jobs
            ADD COLUMN available_at TIMESTAMPTZ
        """
    )
    op.execute(
        "CREATE INDEX idx_background_jobs_queued_available_at "
        "ON platform.background_jobs (available_at) "
        "WHERE status = 'queued' AND available_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS platform.idx_background_jobs_queued_available_at"
    )
    op.execute(
        """
        ALTER TABLE platform.background_jobs
            DROP COLUMN IF EXISTS available_at
        """
    )
