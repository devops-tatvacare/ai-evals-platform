"""phase 11B - one dedup key for every fact_lead_signal row

Revision ID: 0045_unify_fact_lead_signal_dedup_key
Revises: 0044_signal_derivation_framework
Create Date: 2026-05-14

Phase 11B of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

The eval-run-coupled signal path moved fully into the framework in 11B
(``llm_transcript`` strategy + ``fact_populator``), so its unique key is
retired now and the framework key gains ``ordinal``:

* DROP ``uq_fact_lead_signal_run_thread_signal`` (the eval-run-coupled
  unique constraint). ``fact_populator`` delete-then-inserts per
  ``eval_run_id`` and never relied on it for upsert; the framework key
  now covers those rows.
* REBUILD ``uq_fact_lead_signal_framework`` to include ``ordinal``:
  ``(tenant_id, app_id, lead_id, signal_type, detected_at, ordinal)
  WHERE signal_definition_id IS NOT NULL``. ``ordinal`` is required
  because one eval legitimately emits multiple signals of the same
  ``signal_type`` — the dropped eval-run index carried ``ordinal`` for
  exactly this. ``rule``-strategy rows use ``ordinal=0``.

``uq_fact_lead_signal_backfill`` is intentionally **kept** for now: the
``backfill-lead-signals`` job still owns its own upsert path. It is
dropped in the follow-up revision that rewires that job onto the
``llm_profile`` strategy + the framework key — so every step stays
coherent (the migration never drops an index a live writer still uses).

The ``eval_run_id`` / ``sync_run_id`` columns and their btree indexes are
KEPT — useful lineage / rollback handles.

Schema-qualifies every raw SQL statement per the Roadmap 01 invariant.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0045_unify_fact_lead_signal_dedup_key"
down_revision: Union[str, None] = "0044_signal_derivation_framework"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Retire the eval-run-coupled unique constraint — llm_transcript +
    # fact_populator now own that path and key off the framework index.
    op.drop_constraint(
        "uq_fact_lead_signal_run_thread_signal",
        "fact_lead_signal",
        schema="analytics",
        type_="unique",
    )

    # Rebuild the framework dedup key with ordinal appended.
    op.execute(
        sa.text("DROP INDEX IF EXISTS analytics.uq_fact_lead_signal_framework")
    )
    op.execute(
        sa.text(
            """
            CREATE UNIQUE INDEX uq_fact_lead_signal_framework
            ON analytics.fact_lead_signal (
                tenant_id, app_id, lead_id, signal_type, detected_at, ordinal
            )
            WHERE signal_definition_id IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    # Restore the framework key to its 0044 shape (no ordinal).
    op.execute(
        sa.text("DROP INDEX IF EXISTS analytics.uq_fact_lead_signal_framework")
    )
    op.execute(
        sa.text(
            """
            CREATE UNIQUE INDEX uq_fact_lead_signal_framework
            ON analytics.fact_lead_signal (
                tenant_id, app_id, lead_id, signal_type, detected_at
            )
            WHERE signal_definition_id IS NOT NULL
            """
        )
    )

    # Restore the eval-run-coupled unique constraint (baseline shape).
    op.create_unique_constraint(
        "uq_fact_lead_signal_run_thread_signal",
        "fact_lead_signal",
        ["tenant_id", "app_id", "eval_run_id", "thread_evaluation_id",
         "signal_type", "ordinal"],
        schema="analytics",
    )
