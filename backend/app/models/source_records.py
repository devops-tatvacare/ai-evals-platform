"""Generic CRM-backed source record tables shared across apps.

Tenant/app partitioned so multiple CRM-driven apps can share this storage
model with strict tenant/app isolation. First consumer is Inside Sales.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func, text  # noqa: F401
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SourceRecordMetadataMixin:
    """Common sync metadata for synced source rows."""

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    source_system: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="lsq",
        server_default="lsq",
    )
    source_record_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    first_synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_seen_in_source_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_synced_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    raw_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class SourceCallRecord(Base, TimestampMixin, SourceRecordMetadataMixin):
    __tablename__ = "source_call_records"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    activity_id: Mapped[str] = mapped_column(String(100), nullable=False)
    prospect_id: Mapped[str] = mapped_column(String(100), nullable=False)
    agent_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    agent_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agent_name_normalized: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agent_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    direction: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status_normalized: Mapped[str | None] = mapped_column(String(50), nullable=True)
    call_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    has_recording: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    recording_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    display_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    call_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_session_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "app_id", "activity_id", name="uq_source_call_records_tenant_app_activity"),
        Index("idx_source_call_records_tenant_app_call_started", "tenant_id", "app_id", "call_started_at"),
        Index("idx_source_call_records_tenant_app_created", "tenant_id", "app_id", "created_on"),
        Index(
            "idx_source_call_records_tenant_app_activity_time",
            "tenant_id",
            "app_id",
            func.coalesce(call_started_at, created_on).desc(),
            activity_id.desc(),
        ),
        Index(
            "idx_source_call_records_tenant_app_activity_agent",
            "tenant_id",
            "app_id",
            func.coalesce(call_started_at, created_on),
            "agent_name_normalized",
            "agent_name",
            postgresql_where=text(
                "agent_name IS NOT NULL AND agent_name_normalized IS NOT NULL"
            ),
        ),
        Index("idx_source_call_records_tenant_app_agent", "tenant_id", "app_id", "agent_name_normalized"),
        Index("idx_source_call_records_tenant_app_direction", "tenant_id", "app_id", "direction"),
        Index("idx_source_call_records_tenant_app_status", "tenant_id", "app_id", "status_normalized"),
        Index("idx_source_call_records_tenant_app_prospect", "tenant_id", "app_id", "prospect_id"),
        Index("idx_source_call_records_tenant_app_recording", "tenant_id", "app_id", "has_recording"),
    )


class SourceLeadRecord(Base, TimestampMixin, SourceRecordMetadataMixin):
    __tablename__ = "source_lead_records"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    prospect_id: Mapped[str] = mapped_column(String(100), nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    prospect_stage: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    prospect_stage_normalized: Mapped[str | None] = mapped_column(String(120), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    city_normalized: Mapped[str | None] = mapped_column(String(120), nullable=True)
    age_group: Mapped[str | None] = mapped_column(String(80), nullable=True)
    condition: Mapped[str | None] = mapped_column(String(255), nullable=True)
    condition_normalized: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hba1c_band: Mapped[str | None] = mapped_column(String(120), nullable=True)
    intent_to_pay: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agent_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agent_name_normalized: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source_campaign: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_activity_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_activity_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rnr_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    answered_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_dials: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    connect_rate: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    frt_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lead_age_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    days_since_last_contact: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mql_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    mql_signals: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")

    __table_args__ = (
        UniqueConstraint("tenant_id", "app_id", "prospect_id", name="uq_source_lead_records_tenant_app_prospect"),
        Index("idx_source_lead_records_tenant_app_created", "tenant_id", "app_id", "created_on"),
        Index(
            "idx_source_lead_records_tenant_app_created_prospect",
            "tenant_id",
            "app_id",
            created_on.desc(),
            prospect_id.desc(),
        ),
        Index("idx_source_lead_records_tenant_app_last_activity", "tenant_id", "app_id", "last_activity_on"),
        Index("idx_source_lead_records_tenant_app_stage", "tenant_id", "app_id", "prospect_stage_normalized"),
        Index("idx_source_lead_records_tenant_app_agent", "tenant_id", "app_id", "agent_name_normalized"),
        Index("idx_source_lead_records_tenant_app_city", "tenant_id", "app_id", "city_normalized"),
        Index("idx_source_lead_records_tenant_app_condition", "tenant_id", "app_id", "condition_normalized"),
        Index("idx_source_lead_records_tenant_app_mql", "tenant_id", "app_id", "mql_score"),
    )


class SourceSyncRun(Base, TimestampMixin):
    __tablename__ = "source_sync_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    source_system: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="lsq",
        server_default="lsq",
    )
    source_family: Mapped[str] = mapped_column(String(20), nullable=False)
    sync_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", server_default="queued")
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    targeted_source_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    watermark_from: Mapped[str | None] = mapped_column(String(255), nullable=True)
    watermark_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    records_scanned: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    records_upserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    records_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    # Persistent linkage to the driving job + provenance. Written at sync start
    # so coverage/freshness readers don't have to re-infer scheduled-ness from
    # `jobs.params` (which are transient and easy to misread under renames).
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="SET NULL", name="fk_source_sync_runs_job_id"),
        nullable=True,
    )
    is_scheduled_run: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    __table_args__ = (
        Index("idx_source_sync_runs_tenant_app_created", "tenant_id", "app_id", "created_at"),
        Index("idx_source_sync_runs_tenant_family_status", "tenant_id", "source_family", "status"),
        Index("idx_source_sync_runs_tenant_family_completed", "tenant_id", "source_family", "completed_at"),
        Index(
            "idx_source_sync_runs_tenant_app_family_scheduled",
            "tenant_id",
            "app_id",
            "source_family",
            "is_scheduled_run",
            "completed_at",
        ),
    )
