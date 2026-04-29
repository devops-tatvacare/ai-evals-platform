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
    attributes_at_first_seen: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
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
        UniqueConstraint(
            "tenant_id",
            "app_id",
            "source_activity_id",
            name="uq_fact_lead_activity_tenant_app_source",
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
    """Signal fact: one row per LLM-extracted signal from an evaluated call.

    Delete-then-insert per ``eval_run_id`` (the only inside-sales fact
    using delete-then-insert; the other three are append-only, per §13).
    Populated by the ``SignalExtractor`` inside ``populate-analytics``
    from ``platform.evaluation_run_thread_results.result.signals`` —
    never by request handlers.
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
    eval_run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.evaluation_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    thread_evaluation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "platform.evaluation_run_thread_results.id", ondelete="CASCADE"
        ),
        nullable=False,
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
        UniqueConstraint(
            "tenant_id",
            "app_id",
            "eval_run_id",
            "thread_evaluation_id",
            "signal_type",
            "ordinal",
            name="uq_fact_lead_signal_run_thread_signal",
        ),
        Index(
            "idx_fact_lead_signal_tenant_app_run",
            "tenant_id",
            "app_id",
            "eval_run_id",
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
