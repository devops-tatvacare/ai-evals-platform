"""phase 9 — drop crm_lead_record typed cols + legacy backwards-compat views

Revision ID: 0043_drop_crm_lead_record_typed_cols_and_legacy_views
Revises: 0042_crm_lead_record_typed_cols_to_raw_payload
Create Date: 2026-05-14

Plan §3.6 final shape: ``crm_lead_record`` is PII + raw_payload + sync
metadata only. 0042 backfilled the typed-column values into raw_payload +
dim_lead lifts; this revision drops the columns from the table + the two
backwards-compat views.

Dropped columns (20):
  prospect_stage, plan_name, age_group, condition, hba1c_band, intent_to_pay,
  rep_name, source, source_campaign, first_activity_on, last_activity_on,
  rnr_count, answered_count, total_dials, connect_rate, frt_seconds,
  lead_age_days, days_since_last_contact, mql_score, mql_signals

Each of these has a canonical key in ``crm_lead_record.raw_payload`` after
0042 runs; the read path in inside_sales_queries / routes / Phase-5
backfill is migrated to ``lead.bag.get(...)``.

Dropped views (2):
  analytics.crm_call_record_legacy, analytics.crm_lead_record_legacy
The legacy views shipped in Alembic 0038 as the rename safety net; no
in-repo consumer references them.

Schema-qualifies every raw SQL statement per the Roadmap 01 invariant.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0043_drop_crm_lead_record_typed_cols_and_legacy_views"
down_revision: Union[str, None] = "0042_crm_lead_record_typed_cols_to_raw_payload"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DROPPED_COLUMNS: tuple[str, ...] = (
    "prospect_stage",
    "plan_name",
    "age_group",
    "condition",
    "hba1c_band",
    "intent_to_pay",
    "rep_name",
    "source",
    "source_campaign",
    "first_activity_on",
    "last_activity_on",
    "rnr_count",
    "answered_count",
    "total_dials",
    "connect_rate",
    "frt_seconds",
    "lead_age_days",
    "days_since_last_contact",
    "mql_score",
    "mql_signals",
)


# Indexes Alembic 0038 created on the dropped columns Postgres auto-drops
# with the column itself: idx_crm_lead_record_tenant_app_stage_lower,
# *_agent_lower, *_last_activity, *_mql, *_plan_name. Downgrade does not
# recreate them — symmetric column restore is sufficient for rollback
# correctness.


def upgrade() -> None:
    # Drop the two backwards-compat views first so they don't depend on
    # the columns we're about to drop.
    op.execute(sa.text("DROP VIEW IF EXISTS analytics.crm_call_record_legacy"))
    op.execute(sa.text("DROP VIEW IF EXISTS analytics.crm_lead_record_legacy"))

    for col in _DROPPED_COLUMNS:
        op.drop_column("crm_lead_record", col, schema="analytics")


def downgrade() -> None:
    # Restore the dropped columns with permissive types (matches the
    # pre-0043 model). Existing rows get NULL; the operator can replay
    # 0042 in reverse manually if a real reset is needed.
    op.add_column(
        "crm_lead_record",
        sa.Column("prospect_stage", sa.Text(), nullable=False, server_default=""),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("plan_name", sa.Text(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("age_group", sa.Text(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("condition", sa.Text(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("hba1c_band", sa.Text(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("intent_to_pay", sa.Text(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("rep_name", sa.Text(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("source", sa.Text(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("source_campaign", sa.Text(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("first_activity_on", sa.DateTime(timezone=True), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("last_activity_on", sa.DateTime(timezone=True), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("rnr_count", sa.Integer(), nullable=False, server_default="0"),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("answered_count", sa.Integer(), nullable=False, server_default="0"),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("total_dials", sa.Integer(), nullable=False, server_default="0"),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("connect_rate", sa.Numeric(5, 2), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("frt_seconds", sa.Integer(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("lead_age_days", sa.Integer(), nullable=False, server_default="0"),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("days_since_last_contact", sa.Integer(), nullable=True),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column("mql_score", sa.Integer(), nullable=False, server_default="0"),
        schema="analytics",
    )
    op.add_column(
        "crm_lead_record",
        sa.Column(
            "mql_signals",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
            server_default="{}",
        ),
        schema="analytics",
    )

    # Recreate the legacy views.
    op.execute(sa.text(
        """
        CREATE VIEW analytics.crm_call_record_legacy AS
        SELECT *,
               rep_id     AS agent_id,
               rep_name   AS agent_name,
               rep_email  AS agent_email,
               lead_id    AS prospect_id
        FROM analytics.crm_call_record
        """
    ))
    op.execute(sa.text(
        """
        CREATE VIEW analytics.crm_lead_record_legacy AS
        SELECT *,
               lead_id AS prospect_id
        FROM analytics.crm_lead_record
        """
    ))
