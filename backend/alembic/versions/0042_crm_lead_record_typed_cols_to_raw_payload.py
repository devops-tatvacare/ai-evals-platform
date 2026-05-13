"""phase 9a — copy crm_lead_record typed cols into raw_payload + dim_lead

Revision ID: 0042_crm_lead_record_typed_cols_to_raw_payload
Revises: 0041_fact_lead_stage_transition_backfill_shape
Create Date: 2026-05-14

Phase 9 (retro-Phase-1) of the analytics-facts-canonical-manifest-thinning
plan. Plan §3.6 declares ``crm_lead_record``'s final shape: PII fields +
``raw_payload`` + sync metadata. Twenty domain-typed columns currently
on the table need to migrate before they can be dropped — this revision
is the data-only step that does the lift, leaving the typed columns in
place so a rollback or a missed consumer surfaces loudly. The matching
schema-drop revision (0043) drops those columns + the two backwards-compat
views.

Two operations, both idempotent:

1. **Merge typed cols into ``raw_payload``.** Every row gets a canonical
   set of keys at the top level of ``raw_payload`` mirroring the typed
   column values. ``jsonb_strip_nulls`` keeps the merged JSONB clean.
   Idempotent: re-running over already-merged rows produces the same
   result.

2. **Lift ``rep_name`` → ``dim_lead.assigned_rep_label`` and
   ``source`` / ``source_campaign`` → ``dim_lead.attributes_at_first_seen``.**
   These are the §3.4 lifts that were planned for Phase 1 but never
   shipped. ``dim_lead.assigned_rep_label`` only writes when the dim
   column is currently NULL (preserves any operator overrides);
   ``attributes_at_first_seen`` merges so future custom-field lifts can
   be additive.

Schema-qualifies every raw SQL statement per the Roadmap 01 invariant.
Empty-DB no-op (fresh dev / CI environment).
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0042_crm_lead_record_typed_cols_to_raw_payload"
down_revision: Union[str, None] = "0041_fact_lead_stage_transition_backfill_shape"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Columns lifted into ``raw_payload`` under their canonical lowercase keys.
# Order matches plan §3.6 ``raw_payload`` bag declaration.
_RAW_PAYLOAD_LIFTS: tuple[str, ...] = (
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


def _build_raw_payload_merge_sql() -> str:
    """Build the UPDATE SQL that merges typed cols into ``raw_payload``."""
    # jsonb_build_object accepts arg pairs ('key', value, 'key2', value2, …).
    args = []
    for col in _RAW_PAYLOAD_LIFTS:
        args.append(f"'{col}'")
        # Timestamps need ::text coercion for jsonb_build_object compatibility.
        if col in ("first_activity_on", "last_activity_on"):
            args.append(f"{col}::text")
        else:
            args.append(col)
    args_sql = ", ".join(args)
    return f"""
        UPDATE analytics.crm_lead_record
        SET raw_payload = jsonb_strip_nulls(
            coalesce(raw_payload, '{{}}'::jsonb)
            || jsonb_build_object({args_sql})
        )
    """


def upgrade() -> None:
    # 1. Merge typed cols into raw_payload.
    op.execute(sa.text(_build_raw_payload_merge_sql()))

    # 2. Lift rep_name → dim_lead.assigned_rep_label (only when dim is
    #    currently NULL — preserves operator overrides).
    op.execute(sa.text(
        """
        UPDATE analytics.dim_lead dl
        SET assigned_rep_label = clr.rep_name
        FROM analytics.crm_lead_record clr
        WHERE dl.tenant_id = clr.tenant_id
          AND dl.app_id = clr.app_id
          AND dl.lead_id = clr.lead_id
          AND dl.assigned_rep_label IS NULL
          AND clr.rep_name IS NOT NULL
        """
    ))

    # 3. Lift source / source_campaign → dim_lead.attributes_at_first_seen.
    #    Merge-on-write so any future additions accumulate.
    op.execute(sa.text(
        """
        UPDATE analytics.dim_lead dl
        SET attributes_at_first_seen = jsonb_strip_nulls(
            coalesce(attributes_at_first_seen, '{}'::jsonb)
            || jsonb_build_object(
                'source', clr.source,
                'source_campaign', clr.source_campaign
            )
        )
        FROM analytics.crm_lead_record clr
        WHERE dl.tenant_id = clr.tenant_id
          AND dl.app_id = clr.app_id
          AND dl.lead_id = clr.lead_id
          AND (clr.source IS NOT NULL OR clr.source_campaign IS NOT NULL)
        """
    ))


def downgrade() -> None:
    # Data backfill — there's no symmetric reversal because the source
    # information remains on the typed columns and in raw_payload after
    # the upgrade; rollback is "leave the merged raw_payload in place".
    # If a true reset is needed, the operator can clear the merged keys
    # manually:
    #
    #   UPDATE analytics.crm_lead_record
    #   SET raw_payload = raw_payload - ARRAY['prospect_stage', 'plan_name', ...];
    #
    # — but this is intentionally not the default downgrade because it
    # would lose the operator-visible lift if 0042 ran multiple times.
    pass
