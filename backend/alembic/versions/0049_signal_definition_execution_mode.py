"""add execution mode to analytics.signal_definition

Revision ID: 0049_signal_definition_execution_mode
Revises: 0048
Create Date: 2026-05-17

Separates "definition is active" (enabled=true) from "definition may run in
the scheduled derive-signals scan". The scheduled scanner can run rule-based
dim_lead definitions, but eval-run projection and operator-triggered LLM
backfills require caller-specific context.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0049_signal_definition_execution_mode"
down_revision: Union[str, None] = "0048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "signal_definition",
        sa.Column(
            "execution_mode",
            sa.String(length=32),
            nullable=False,
            server_default="scheduled_scan",
        ),
        schema="analytics",
    )
    op.execute(
        sa.text(
            """
            UPDATE analytics.signal_definition
            SET execution_mode = CASE
                WHEN strategy = 'llm_transcript' THEN 'eval_run_projection'
                WHEN strategy = 'llm_profile' THEN 'operator_backfill'
                ELSE 'scheduled_scan'
            END
            """
        )
    )
    op.create_check_constraint(
        "ck_signal_definition_execution_mode",
        "signal_definition",
        (
            "execution_mode IN ("
            "'scheduled_scan', "
            "'eval_run_projection', "
            "'operator_backfill'"
            ")"
        ),
        schema="analytics",
    )
    op.create_index(
        "ix_signal_definition_execution_enabled",
        "signal_definition",
        ["execution_mode", "enabled"],
        schema="analytics",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_signal_definition_execution_enabled",
        table_name="signal_definition",
        schema="analytics",
    )
    op.drop_constraint(
        "ck_signal_definition_execution_mode",
        "signal_definition",
        schema="analytics",
        type_="check",
    )
    op.drop_column("signal_definition", "execution_mode", schema="analytics")
