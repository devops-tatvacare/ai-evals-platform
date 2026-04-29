"""Persisted report execution history rows."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantUserMixin, TimestampMixin
from app.models.mixins.shareable import ShareableMixin


class ReportGenerationRun(Base, TimestampMixin, TenantUserMixin, ShareableMixin):
    __tablename__ = "report_generation_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    report_id: Mapped[str] = mapped_column(String(100), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    source_eval_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.evaluation_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", server_default="queued")
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.background_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    llm_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    report_config_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_asset_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    schema_asset_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_report_generation_runs_tenant_app_report", "tenant_id", "app_id", "report_id"),
        Index("idx_report_generation_runs_tenant_app_scope", "tenant_id", "app_id", "scope"),
        Index("idx_report_generation_runs_tenant_status_created", "tenant_id", "status", "created_at"),
        Index("idx_report_generation_runs_job_id", "job_id"),
        {"schema": "platform"},
    )
