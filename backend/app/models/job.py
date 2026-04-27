"""Job model - background job queue for batch evaluations."""
import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, Text, JSON, DateTime, Index, Integer, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TenantUserMixin


class Job(Base, TenantUserMixin):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, default="", server_default="")
    job_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    # Worker skips a job whose dependency isn't completed; cascade-fails when
    # the dependency fails/cancels.
    depends_on_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="SET NULL", name="fk_jobs_depends_on_job_id"),
        nullable=True,
    )
    # Set on every job fired by the scheduler engine (including fire-now).
    # Durable schedule → job linkage, used by the scheduled-jobs detail API
    # to surface the last N fires without a separate audit table.
    scheduled_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scheduled_jobs.id", ondelete="SET NULL", name="fk_jobs_scheduled_job_id"),
        nullable=True,
    )
    # Optional idempotency token supplied via the ``Idempotency-Key`` request
    # header. When set, a partial unique index enforces one live job per
    # ``(tenant_id, idempotency_key)`` — a replay returns the existing row
    # instead of creating a duplicate. NULL means "no idempotency requested"
    # and multiple submissions are allowed.
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    queue_class: Mapped[str] = mapped_column(String(20), nullable=False, default="standard", server_default="standard")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    lease_owner: Mapped[str | None] = mapped_column(String(120), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dead_lettered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dead_letter_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    # Phase 7: generic submission-surface metadata. Jobs submitted through the
    # Sherlock harness carry ``{surface: 'sherlock', session_id, turn_id}`` so
    # the next turn's context loader can find them without a Sherlock-specific
    # FK on the platform jobs schema. JSONB (not JSON) so Postgres ``@>``
    # containment + the GIN ``jsonb_path_ops`` index from startup_schema.py
    # make the per-session pending-jobs query bounded.
    submission_context: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    progress: Mapped[dict] = mapped_column(JSON, default=lambda: {"current": 0, "total": 0, "message": ""})
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_jobs_tenant", "tenant_id"),
        Index("idx_jobs_tenant_user", "tenant_id", "user_id"),
        Index("idx_jobs_status_priority_created", "status", "priority", "created_at"),
        Index("idx_jobs_status_lease_expires", "status", "lease_expires_at"),
        Index("idx_jobs_status_next_retry", "status", "next_retry_at"),
        Index("idx_jobs_tenant_status_created", "tenant_id", "status", "created_at"),
        Index("idx_jobs_tenant_app_status_created", "tenant_id", "app_id", "status", "created_at"),
        Index("idx_jobs_depends_on", "depends_on_job_id"),
        Index(
            "idx_jobs_scheduled_job_created",
            "scheduled_job_id",
            "created_at",
        ),
        Index(
            "uq_jobs_user_idempotency_key",
            "tenant_id",
            "user_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )
