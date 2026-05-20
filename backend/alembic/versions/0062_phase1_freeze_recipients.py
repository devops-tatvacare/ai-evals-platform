"""0062 — workflow_run_recipients (frozen manifest) + recipient-state status extensions.

Adds the immutable frozen-at-T0 manifest of (run_id, recipient_id, phone_e164)
so dispatch nodes can hard-gate against the enrolled set, eliminating post-T0
cohort slip. Extends ``workflow_run_recipient_states.status`` with the status
values used by the run-guardrails phases.

Revision ID: 0062
Revises: 0061
Create Date: 2026-05-19
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0062"
down_revision: Union[str, None] = "0061"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_EXISTING_STATUSES: tuple[str, ...] = (
    "pending",
    "running",
    "waiting",
    "ready",
    "completed",
    "skipped",
    "failed",
    "overridden",
)
_NEW_STATUSES: tuple[str, ...] = (
    "aborted",
    "aborted_expired",
    "skipped_capped",
    "skipped_invalid_phone",
)


def _status_check_clause(statuses: tuple[str, ...]) -> str:
    return "status IN (" + ", ".join(f"'{s}'" for s in statuses) + ")"


def upgrade() -> None:
    op.create_table(
        "workflow_run_recipients",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orchestration.workflow_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("app_id", sa.String(64), nullable=False),
        sa.Column("recipient_id", sa.String(128), nullable=False),
        sa.Column("phone_e164", sa.String(32), nullable=False),
        sa.Column(
            "source_cohort_version_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("predicate_hash", sa.String(64), nullable=False),
        sa.Column(
            "frozen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "run_id",
            "recipient_id",
            name="uq_workflow_run_recipients_run_recipient",
        ),
        schema="orchestration",
    )
    op.create_index(
        "idx_workflow_run_recipients_tenant_app_phone",
        "workflow_run_recipients",
        ["tenant_id", "app_id", "phone_e164"],
        schema="orchestration",
    )
    op.create_index(
        "idx_workflow_run_recipients_run",
        "workflow_run_recipients",
        ["run_id"],
        schema="orchestration",
    )

    op.alter_column(
        "workflow_run_recipient_states",
        "status",
        type_=sa.String(32),
        existing_type=sa.String(16),
        existing_nullable=False,
        existing_server_default=sa.text("'pending'::character varying"),
        schema="orchestration",
    )
    op.execute(
        "ALTER TABLE orchestration.workflow_run_recipient_states "
        "DROP CONSTRAINT IF EXISTS ck_workflow_run_recipient_states_status"
    )
    op.execute(
        "ALTER TABLE orchestration.workflow_run_recipient_states "
        "ADD CONSTRAINT ck_workflow_run_recipient_states_status "
        f"CHECK ({_status_check_clause(_EXISTING_STATUSES + _NEW_STATUSES)})"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE orchestration.workflow_run_recipient_states "
        "DROP CONSTRAINT IF EXISTS ck_workflow_run_recipient_states_status"
    )
    op.execute(
        "ALTER TABLE orchestration.workflow_run_recipient_states "
        "ADD CONSTRAINT ck_workflow_run_recipient_states_status "
        f"CHECK ({_status_check_clause(_EXISTING_STATUSES)})"
    )
    op.alter_column(
        "workflow_run_recipient_states",
        "status",
        type_=sa.String(16),
        existing_type=sa.String(32),
        existing_nullable=False,
        existing_server_default=sa.text("'pending'::character varying"),
        schema="orchestration",
    )
    op.drop_index(
        "idx_workflow_run_recipients_run",
        table_name="workflow_run_recipients",
        schema="orchestration",
    )
    op.drop_index(
        "idx_workflow_run_recipients_tenant_app_phone",
        table_name="workflow_run_recipients",
        schema="orchestration",
    )
    op.drop_table("workflow_run_recipients", schema="orchestration")
