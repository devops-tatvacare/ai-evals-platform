"""phase 11B - drop the legacy backfill unique index

Revision ID: 0046_drop_fact_lead_signal_backfill_index
Revises: 0045_unify_fact_lead_signal_dedup_key
Create Date: 2026-05-14

Phase 11B of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

The ``backfill-lead-signals`` job was rewired onto the ``llm_profile``
signal-derivation strategy + the shared framework upsert, so nothing
writes against ``uq_fact_lead_signal_backfill`` any more. Dropping it now
completes the unification: ``uq_fact_lead_signal_framework`` is the single
dedup key for every ``analytics.fact_lead_signal`` row.

This pairs with the job rewire by design — migration 0045 deliberately
kept this index until the writer that used it was retired, so no migration
ever drops an index a live writer still depends on.

Schema-qualifies every raw SQL statement per the Roadmap 01 invariant.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0046_drop_fact_lead_signal_backfill_index"
down_revision: Union[str, None] = "0045_unify_fact_lead_signal_dedup_key"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text("DROP INDEX IF EXISTS analytics.uq_fact_lead_signal_backfill")
    )


def downgrade() -> None:
    # Recreate the partial unique index in its migration 0040 shape.
    op.execute(
        sa.text(
            """
            CREATE UNIQUE INDEX uq_fact_lead_signal_backfill
            ON analytics.fact_lead_signal (
                tenant_id, app_id, lead_id, signal_type, detected_at
            )
            WHERE sync_run_id IS NOT NULL
            """
        )
    )
