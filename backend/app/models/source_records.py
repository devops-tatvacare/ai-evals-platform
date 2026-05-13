"""Generic CRM-backed source record tables shared across apps.

Tenant/app partitioned so multiple CRM-driven apps can share this storage
model with strict tenant/app isolation. First consumer is Inside Sales.

Schema-qualified to ``analytics`` per Roadmap 01 §3.2 / §5.12. Class
and table names follow the role-prefix convention from §4 — ``crm_``
for the rolling source mirror, ``log_`` for the per-sync audit row.
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
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
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
        ForeignKey("platform.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    raw_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class CrmCallRecord(Base, TimestampMixin, SourceRecordMetadataMixin):
    __tablename__ = "crm_call_record"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    activity_id: Mapped[str] = mapped_column(String(100), nullable=False)
    lead_id: Mapped[str] = mapped_column(String(100), nullable=False)
    rep_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    rep_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rep_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    direction: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True)
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
        UniqueConstraint(
            "tenant_id", "app_id", "activity_id", name="uq_crm_call_record_tenant_app_activity"
        ),
        Index("idx_crm_call_record_tenant_app_call_started", "tenant_id", "app_id", "call_started_at"),
        Index("idx_crm_call_record_tenant_app_created", "tenant_id", "app_id", "created_on"),
        Index(
            "idx_crm_call_record_tenant_app_activity_time",
            "tenant_id",
            "app_id",
            func.coalesce(call_started_at, created_on).desc(),
            activity_id.desc(),
        ),
        # Index name retains the legacy ``_agent_lower`` suffix because the
        # underlying Postgres index is renamed by Alembic 0038 against the
        # renamed column; renaming the index identifier itself is a Phase 9
        # cleanup. The expression now indexes ``rep_name``.
        Index(
            "idx_crm_call_record_tenant_app_agent_lower",
            "tenant_id",
            "app_id",
            func.lower(rep_name),
            postgresql_where=text("rep_name IS NOT NULL"),
        ),
        Index("idx_crm_call_record_tenant_app_direction", "tenant_id", "app_id", "direction"),
        Index(
            "idx_crm_call_record_tenant_app_status_lower",
            "tenant_id",
            "app_id",
            func.lower(status),
            postgresql_where=text("status IS NOT NULL"),
        ),
        # Same legacy index name; column is now ``lead_id``.
        Index("idx_crm_call_record_tenant_app_prospect", "tenant_id", "app_id", "lead_id"),
        Index("idx_crm_call_record_tenant_app_recording", "tenant_id", "app_id", "has_recording"),
        {"schema": "analytics"},
    )


class CrmLeadRecord(Base, TimestampMixin, SourceRecordMetadataMixin):
    __tablename__ = "crm_lead_record"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    # Plan §3.6 final shape: PII + raw_payload + sync metadata only.
    # The 20 domain-typed columns that used to live here (prospect_stage,
    # plan_name, age_group, condition, hba1c_band, intent_to_pay, rep_name,
    # source, source_campaign, first_activity_on, last_activity_on,
    # rnr_count, answered_count, total_dials, connect_rate, frt_seconds,
    # lead_age_days, days_since_last_contact, mql_score, mql_signals) are
    # dropped by Alembic 0043 and now live as canonical lowercase keys in
    # ``raw_payload``. Read them via the ``.bag`` accessor.
    lead_id: Mapped[str] = mapped_column(String(100), nullable=False)
    first_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def bag(self) -> dict:
        """Stable read-side accessor for the raw_payload domain bag.

        Returns the lead's raw_payload coerced to a dict. Phase 9 moves
        the typed domain columns (hba1c_band, condition, ...) into this
        bag; callers should pull every domain field via ``lead.bag.get(...)``
        rather than attribute access so the read path keeps working after
        the typed columns are dropped in Alembic 0043.
        """
        return self.raw_payload or {}

    __table_args__ = (
        # Constraint name retains the legacy ``_prospect`` suffix; the
        # underlying Postgres constraint is renamed in place by 0038 and
        # references the new ``lead_id`` column. Constraint-identifier
        # rename is a Phase 9 cleanup item.
        UniqueConstraint(
            "tenant_id", "app_id", "lead_id", name="uq_crm_lead_record_tenant_app_prospect"
        ),
        Index("idx_crm_lead_record_tenant_app_created", "tenant_id", "app_id", "created_on"),
        Index(
            "idx_crm_lead_record_tenant_app_created_prospect",
            "tenant_id",
            "app_id",
            created_on.desc(),
            lead_id.desc(),
        ),
        Index(
            "idx_crm_lead_record_tenant_app_city_lower",
            "tenant_id",
            "app_id",
            func.lower(city),
            postgresql_where=text("city IS NOT NULL"),
        ),
        {"schema": "analytics"},
    )


class LogCrmSourceSync(Base, TimestampMixin):
    __tablename__ = "log_crm_source_sync"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
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
        ForeignKey("platform.users.id", ondelete="SET NULL"),
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
        ForeignKey(
            "platform.background_jobs.id",
            ondelete="SET NULL",
            name="fk_log_crm_source_sync_job_id",
        ),
        nullable=True,
    )
    is_scheduled_run: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    __table_args__ = (
        Index("idx_log_crm_source_sync_tenant_app_created", "tenant_id", "app_id", "created_at"),
        Index("idx_log_crm_source_sync_tenant_family_status", "tenant_id", "source_family", "status"),
        Index("idx_log_crm_source_sync_tenant_family_completed", "tenant_id", "source_family", "completed_at"),
        Index(
            "idx_log_crm_source_sync_tenant_app_family_scheduled",
            "tenant_id",
            "app_id",
            "source_family",
            "is_scheduled_run",
            "completed_at",
        ),
        {"schema": "analytics"},
    )
