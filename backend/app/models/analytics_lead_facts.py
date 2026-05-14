"""Analytics inside-sales lead facts and dimension.

Created in Roadmap 01 §6 / revision 0018. Lives in the ``analytics``
schema (per §3.2 and §6). App-generic — column names carry ``lead_*``
not ``inside_sales_*``; future CRM-backed apps reuse the same shape.

Population (per §8):
  - ``DimLead`` and ``FactLeadStageTransition`` are written transactionally
    by ``inside_sales_sync.py`` on the leads sync path.
  - ``FactLeadActivity`` is written transactionally by ``inside_sales_sync.py``
    on the calls sync path (``activity_type='call'``) and on the new
    activities path (``source_family='activities'``).
  - ``FactLeadSignal`` is written by ``populate-analytics``'s
    ``SignalExtractor``, which reads the canonical merged top-level
    ``platform.evaluation_run_thread_results.result.signals`` array.
    Delete-then-insert per ``eval_run_id``.

Cross-schema FKs use schema-qualified strings per §9.5.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DimLead(Base):
    """One row per (tenant, app, lead). SCD-1 dimension.

    ``first_seen_at`` and ``attributes_at_first_seen`` never change after
    insert. ``latest_stage_observed`` / ``_at`` and ``updated_at`` are
    refreshed by every leads-sync upsert.
    """

    __tablename__ = "dim_lead"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    lead_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lsq_created_on: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    latest_stage_observed: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    latest_stage_observed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Display name of the current assigned rep, lifted from the lead mirror.
    # See ADR 2026-05-12-rep-and-lead-id-naming — no ``assigned_rep_id`` ships
    # in Phase 1 because LSQ exposes only a name string on the lead record.
    assigned_rep_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 11A — lead-identity columns, all ``pii: true`` in the manifest.
    # The CRM workspace UI reads these from dim_lead (the normalized serving
    # surface); values are masked by applications.config.crmWorkspace.
    # piiVisibility. The mirror keeps its own copies for source fidelity.
    first_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str | None] = mapped_column(Text, nullable=True)
    attributes_at_first_seen: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    # Mutable current-state bag distinct from ``attributes_at_first_seen``.
    # Nullable in Phase 1; populator wiring lands in later phases.
    attributes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "app_id", "lead_id", name="uq_dim_lead_tenant_app_lead"
        ),
        Index(
            "idx_dim_lead_tenant_app_lsq_created_on",
            "tenant_id",
            "app_id",
            text("lsq_created_on DESC"),
        ),
        Index(
            "idx_dim_lead_tenant_app_first_seen_at",
            "tenant_id",
            "app_id",
            text("first_seen_at DESC"),
        ),
        {"schema": "analytics"},
    )


class FactLeadStageTransition(Base):
    """Append-only stage-transition fact, one row per detected change.

    ``detected_at`` is observation time (sync-cycle start). The real
    transition happened at or before this timestamp, bounded by the prior
    detection. ``transition_at`` is reserved for future webhook-derived
    rows and is always NULL in v1. Idempotency is guaranteed by the
    detector's "new stage != latest known stage" read in
    ``inside_sales_sync.py`` (no DB-level uniqueness on value).
    """

    __tablename__ = "fact_lead_stage_transition"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    lead_id: Mapped[str] = mapped_column(String(128), nullable=False)
    from_stage: Mapped[str | None] = mapped_column(String(128), nullable=True)
    to_stage: Mapped[str] = mapped_column(String(128), nullable=False)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    transition_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sync_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analytics.log_crm_source_sync.id", ondelete="SET NULL"),
        nullable=True,
    )
    attributes: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index(
            "idx_fact_lead_stage_transition_tenant_app_lead_detected",
            "tenant_id",
            "app_id",
            "lead_id",
            text("detected_at DESC"),
        ),
        Index(
            "idx_fact_lead_stage_transition_tenant_app_detected",
            "tenant_id",
            "app_id",
            text("detected_at DESC"),
        ),
        Index(
            "idx_fact_lead_stage_transition_tenant_app_to_stage",
            "tenant_id",
            "app_id",
            "to_stage",
            "detected_at",
        ),
        # Phase 6 (Alembic 0041) — partial unique index covers rows stamped
        # by a backfill or steady-state sync. ``to_stage`` is intentionally
        # NOT part of the key: a lead has one prospect_stage at any moment,
        # so reruns of the backfill (same detected_at, possibly different
        # current to_stage) UPDATE the seed row instead of forking. Existing
        # pre-sync_run_id rows remain unconstrained.
        Index(
            "uq_fact_lead_stage_transition_backfill",
            "tenant_id",
            "app_id",
            "lead_id",
            "detected_at",
            unique=True,
            postgresql_where=text("sync_run_id IS NOT NULL"),
        ),
        Index(
            "ix_fact_lead_stage_transition_tenant_app_sync_run",
            "tenant_id",
            "app_id",
            "sync_run_id",
        ),
        {"schema": "analytics"},
    )


class FactLeadActivity(Base):
    """Append-only activity fact, one row per LSQ ProspectActivity.

    ``activity_type`` is normalized: ``call`` / ``email`` / ``web`` /
    ``sms`` / ``form_submit`` / ``custom`` / ``revenue``. Calls path
    (``activity_type='call'``) duplicates ``analytics.crm_call_record``
    rows at a different grain. Activities path is fact-only — no Layer 1
    mirror write.
    """

    __tablename__ = "fact_lead_activity"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    lead_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_activity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    activity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    activity_subtype: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_event_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    actor_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    actor_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Denormalized actor display name. Avoids a dim_actor join on every chart axis.
    actor_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    attributes: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    sync_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analytics.log_crm_source_sync.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # Wider unique key includes ``activity_type`` so multiple CRM apps /
        # activity types can reuse the same fact table without colliding on
        # ``source_activity_id`` namespaces. Created as ``CREATE UNIQUE INDEX
        # CONCURRENTLY`` in Alembic 0038, not as a constraint, so we declare
        # an ``Index(unique=True)`` to match what's in the DB.
        Index(
            "uq_fact_lead_activity_source",
            "tenant_id",
            "app_id",
            "source_activity_id",
            "activity_type",
            unique=True,
        ),
        Index(
            "idx_fact_lead_activity_tenant_app_lead_occurred",
            "tenant_id",
            "app_id",
            "lead_id",
            text("occurred_at DESC"),
        ),
        Index(
            "idx_fact_lead_activity_tenant_app_type_occurred",
            "tenant_id",
            "app_id",
            "activity_type",
            text("occurred_at DESC"),
        ),
        Index(
            "idx_fact_lead_activity_tenant_app_occurred",
            "tenant_id",
            "app_id",
            text("occurred_at DESC"),
        ),
        {"schema": "analytics"},
    )


class FactLeadSignal(Base):
    """Signal fact: one row per LLM-extracted signal about a lead.

    Two population paths share this table (Phase 5 amendment, 2026-05-14):

    1. **Eval-run-coupled** rows come from ``populate-analytics``'s
       ``SignalExtractor`` reading
       ``platform.evaluation_run_thread_results.result.signals`` — these
       set ``eval_run_id`` + ``thread_evaluation_id`` and are dedup'd by
       ``uq_fact_lead_signal_run_thread_signal``.
    2. **Backfill / scheduled-extraction** rows come from
       ``backfill_lead_signals_job`` walking the CRM lead mirror — these
       leave ``eval_run_id`` / ``thread_evaluation_id`` NULL, set
       ``sync_run_id`` to the owning ``analytics.log_crm_source_sync`` id,
       and are dedup'd by the partial unique index
       ``uq_fact_lead_signal_backfill (tenant_id, app_id, lead_id,
       signal_type, detected_at) WHERE sync_run_id IS NOT NULL``.

    Rollback for path 2: ``DELETE WHERE sync_run_id = '<run_id>'``.
    Never written by request handlers.
    """

    __tablename__ = "fact_lead_signal"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Nullable since 0040 — backfill rows have no eval-run lineage.
    eval_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.evaluation_runs.id", ondelete="CASCADE"),
        nullable=True,
    )
    thread_evaluation_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "platform.evaluation_run_thread_results.id", ondelete="CASCADE"
        ),
        nullable=True,
    )
    # Owns rollback-by-run for backfill / scheduled-extraction writes.
    sync_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analytics.log_crm_source_sync.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Phase 11A — lineage for signal-derivation-framework rows. Every row
    # written by the scheduled ``derive-signals`` Transform carries the
    # owning ``signal_definition`` id; it is the dedup key for framework
    # rows (uq_fact_lead_signal_framework) and the rollback handle.
    signal_definition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analytics.signal_definition.id", ondelete="SET NULL"),
        nullable=True,
    )
    lead_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_activity_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    signal_type: Mapped[str] = mapped_column(String(64), nullable=False)
    signal_value: Mapped[str | None] = mapped_column(String(128), nullable=True)
    signal_value_numeric: Mapped[Decimal | None] = mapped_column(
        Numeric, nullable=True
    )
    signal_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Observation timestamp for backfill rows. Distinct from signal_at,
    # which is the source-side moment of the signal as reported.
    detected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    confidence: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    supporting_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    ordinal: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    attributes: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # Phase 11B — the framework dedup key. Rows written through the
        # signal derivation framework carry ``signal_definition_id``.
        # ``ordinal`` is in the key because one eval legitimately emits
        # multiple signals of the same ``signal_type``; ``rule`` rows use
        # ``ordinal=0``. The eval-run-coupled
        # ``uq_fact_lead_signal_run_thread_signal`` constraint was dropped
        # in migration 0045. ``eval_run_id`` / ``sync_run_id`` stay as
        # lineage columns.
        Index(
            "uq_fact_lead_signal_framework",
            "tenant_id",
            "app_id",
            "lead_id",
            "signal_type",
            "detected_at",
            "ordinal",
            unique=True,
            postgresql_where=text("signal_definition_id IS NOT NULL"),
        ),
        Index(
            "idx_fact_lead_signal_tenant_app_run",
            "tenant_id",
            "app_id",
            "eval_run_id",
        ),
        Index(
            "ix_fact_lead_signal_tenant_app_sync_run",
            "tenant_id",
            "app_id",
            "sync_run_id",
        ),
        # Powers the rollback DELETE / per-definition scan.
        Index(
            "ix_fact_lead_signal_tenant_app_definition",
            "tenant_id",
            "app_id",
            "signal_definition_id",
        ),
        Index(
            "idx_fact_lead_signal_tenant_app_lead_type_at",
            "tenant_id",
            "app_id",
            "lead_id",
            "signal_type",
            "signal_at",
        ),
        Index(
            "idx_fact_lead_signal_tenant_app_type_created",
            "tenant_id",
            "app_id",
            "signal_type",
            text("created_at DESC"),
        ),
        {"schema": "analytics"},
    )


__all__ = [
    "DimLead",
    "FactLeadStageTransition",
    "FactLeadActivity",
    "FactLeadSignal",
]
