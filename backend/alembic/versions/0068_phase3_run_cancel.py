"""0068 — run cancel metadata + workflow_run_cancel_audits.

Adds three nullable ``cancel_*`` columns to ``orchestration.workflow_runs`` so a
hard-Stop records who requested termination, when, and when the async provider
cancel finalised. Adds ``orchestration.workflow_run_cancel_audits`` — one row per
``CancelDispatchResult`` written by the ``finalize-run-cancel`` job.

Revision ID: 0068
Revises: 0067
Create Date: 2026-05-20
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0068"
down_revision: Union[str, None] = "0067"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "workflow_runs",
        sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True),
        schema="orchestration",
    )
    op.add_column(
        "workflow_runs",
        sa.Column("cancel_requested_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema="orchestration",
    )
    op.add_column(
        "workflow_runs",
        sa.Column("cancel_finalized_at", sa.DateTime(timezone=True), nullable=True),
        schema="orchestration",
    )

    op.create_table(
        "workflow_run_cancel_audits",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "provider_connection_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column("action_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("batch_correlation_id", sa.Text(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("provider_status_code", sa.Integer(), nullable=True),
        sa.Column("provider_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["orchestration.workflow_runs.id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "outcome IN ('stopped','cancelled','noop_unsupported',"
            "'noop_already_delivered','noop_already_terminal','provider_error')",
            name="ck_cancel_audit_outcome",
        ),
        schema="orchestration",
    )
    op.create_index(
        "ix_cancel_audit_run",
        "workflow_run_cancel_audits",
        ["run_id"],
        schema="orchestration",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_cancel_audit_run",
        table_name="workflow_run_cancel_audits",
        schema="orchestration",
    )
    op.drop_table("workflow_run_cancel_audits", schema="orchestration")
    op.drop_column("workflow_runs", "cancel_finalized_at", schema="orchestration")
    op.drop_column("workflow_runs", "cancel_requested_by", schema="orchestration")
    op.drop_column("workflow_runs", "cancel_requested_at", schema="orchestration")
