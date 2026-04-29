"""create 4 inside-sales analytics fact / dim tables in analytics schema

Roadmap 01 §6 + §9.3 revision 0018. Brings the four durable
inside-sales analytics tables online directly under their FINAL names
in the ``analytics`` schema. No interim names, no follow-up rename
revision (per §6 / §9.3).

Tables created (4):
  analytics.dim_lead                       — one row per (tenant, app, lead) — SCD-1 dim
  analytics.fact_lead_stage_transition     — append-only, one row per detected stage change
  analytics.fact_lead_activity             — append-only, one row per LSQ ProspectActivity
  analytics.fact_lead_signal               — delete-then-insert per eval_run_id

Population (per plan §8):
  - dim_lead + fact_lead_stage_transition: leads sync side-effect
    (``inside_sales_sync.py`` leads path, same transaction).
  - fact_lead_activity: calls sync side-effect (calls path) + new
    activities sync (``source_family='activities'``). Same txn as
    Layer 1 mirror writes for the calls path; no Layer 1 mirror for
    activities path.
  - fact_lead_signal: ``populate-analytics`` job's new SignalExtractor
    reads ``platform.evaluation_run_thread_results.result.signals``
    (canonical merged top-level array produced by the inside-sales
    runner's runtime structured-output augmentation — see
    ``inside_sales_runner.py`` §8.5).

Cross-schema FKs (per §9.5):
  - all four tables FK ``platform.tenants(id)``
  - fact_lead_signal FKs ``platform.evaluation_runs(id)`` and
    ``platform.evaluation_run_thread_results(id)``
  - fact_lead_stage_transition / fact_lead_activity FK
    ``analytics.log_crm_source_sync(id)`` for sync-run provenance.

Reversibility: downgrade drops all four tables in reverse-dependency
order.

Revision ID: 0018_create_inside_sales_analytics_facts
Revises: 0017_rename_iam_platform_tables
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0018_create_inside_sales_analytics_facts"
down_revision: Union[str, None] = "0017_rename_iam_platform_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── analytics.dim_lead ────────────────────────────────────────────
    # SCD-1 dimension: one row per (tenant, app, lead). Mutable
    # ``latest_stage_observed`` pointer updated on every leads sync.
    op.execute(
        """
        CREATE TABLE analytics.dim_lead (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            lead_id VARCHAR(128) NOT NULL,
            source VARCHAR(64) NOT NULL,
            source_ref VARCHAR(128),
            lsq_created_on TIMESTAMPTZ,
            first_seen_at TIMESTAMPTZ NOT NULL,
            latest_stage_observed VARCHAR(128),
            latest_stage_observed_at TIMESTAMPTZ,
            attributes_at_first_seen JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_dim_lead_tenant_app_lead
                UNIQUE (tenant_id, app_id, lead_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_dim_lead_tenant_app_lsq_created_on
            ON analytics.dim_lead (tenant_id, app_id, lsq_created_on DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_dim_lead_tenant_app_first_seen_at
            ON analytics.dim_lead (tenant_id, app_id, first_seen_at DESC)
        """
    )

    # ── analytics.fact_lead_stage_transition ──────────────────────────
    # Append-only fact. One row per detected stage change.
    # ``detected_at`` is observation time; the real transition happened
    # at or before this timestamp, bounded by the prior detection (per
    # §6.2 column-comment invariant).
    op.execute(
        """
        CREATE TABLE analytics.fact_lead_stage_transition (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            lead_id VARCHAR(128) NOT NULL,
            from_stage VARCHAR(128),
            to_stage VARCHAR(128) NOT NULL,
            detected_at TIMESTAMPTZ NOT NULL,
            transition_at TIMESTAMPTZ,
            sync_run_id UUID REFERENCES analytics.log_crm_source_sync(id) ON DELETE SET NULL,
            attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "COMMENT ON COLUMN analytics.fact_lead_stage_transition.detected_at IS "
        "'observation time; real transition happened at or before this "
        "timestamp, bounded by the prior detection.'"
    )
    op.execute(
        """
        CREATE INDEX idx_fact_lead_stage_transition_tenant_app_lead_detected
            ON analytics.fact_lead_stage_transition
            (tenant_id, app_id, lead_id, detected_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_fact_lead_stage_transition_tenant_app_detected
            ON analytics.fact_lead_stage_transition
            (tenant_id, app_id, detected_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_fact_lead_stage_transition_tenant_app_to_stage
            ON analytics.fact_lead_stage_transition
            (tenant_id, app_id, to_stage, detected_at)
        """
    )

    # ── analytics.fact_lead_activity ──────────────────────────────────
    # Append-only fact. One row per LSQ ProspectActivity. Calls path
    # mirrors ``analytics.crm_call_record`` rows (different grain);
    # activities path is fact-only (no Layer 1 mirror).
    op.execute(
        """
        CREATE TABLE analytics.fact_lead_activity (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            lead_id VARCHAR(128) NOT NULL,
            source_activity_id VARCHAR(128) NOT NULL,
            activity_type VARCHAR(64) NOT NULL,
            activity_subtype VARCHAR(128),
            source_event_code INTEGER,
            occurred_at TIMESTAMPTZ NOT NULL,
            actor_type VARCHAR(32),
            actor_id VARCHAR(128),
            attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
            sync_run_id UUID REFERENCES analytics.log_crm_source_sync(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_fact_lead_activity_tenant_app_source
                UNIQUE (tenant_id, app_id, source_activity_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_fact_lead_activity_tenant_app_lead_occurred
            ON analytics.fact_lead_activity
            (tenant_id, app_id, lead_id, occurred_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_fact_lead_activity_tenant_app_type_occurred
            ON analytics.fact_lead_activity
            (tenant_id, app_id, activity_type, occurred_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_fact_lead_activity_tenant_app_occurred
            ON analytics.fact_lead_activity
            (tenant_id, app_id, occurred_at DESC)
        """
    )

    # ── analytics.fact_lead_signal ────────────────────────────────────
    # Delete-then-insert per ``eval_run_id``. One row per LLM-extracted
    # signal from ``platform.evaluation_run_thread_results.result.signals``.
    op.execute(
        """
        CREATE TABLE analytics.fact_lead_signal (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            eval_run_id UUID NOT NULL
                REFERENCES platform.evaluation_runs(id) ON DELETE CASCADE,
            thread_evaluation_id UUID NOT NULL
                REFERENCES platform.evaluation_run_thread_results(id) ON DELETE CASCADE,
            lead_id VARCHAR(128),
            source_activity_id VARCHAR(128),
            signal_type VARCHAR(64) NOT NULL,
            signal_value VARCHAR(128),
            signal_value_numeric NUMERIC,
            signal_at TIMESTAMPTZ,
            confidence NUMERIC,
            supporting_quote TEXT,
            ordinal INTEGER NOT NULL DEFAULT 0,
            attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_fact_lead_signal_run_thread_signal
                UNIQUE (tenant_id, app_id, eval_run_id, thread_evaluation_id,
                        signal_type, ordinal)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_fact_lead_signal_tenant_app_run
            ON analytics.fact_lead_signal (tenant_id, app_id, eval_run_id)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_fact_lead_signal_tenant_app_lead_type_at
            ON analytics.fact_lead_signal
            (tenant_id, app_id, lead_id, signal_type, signal_at)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_fact_lead_signal_tenant_app_type_created
            ON analytics.fact_lead_signal
            (tenant_id, app_id, signal_type, created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS analytics.fact_lead_signal")
    op.execute("DROP TABLE IF EXISTS analytics.fact_lead_activity")
    op.execute("DROP TABLE IF EXISTS analytics.fact_lead_stage_transition")
    op.execute("DROP TABLE IF EXISTS analytics.dim_lead")
