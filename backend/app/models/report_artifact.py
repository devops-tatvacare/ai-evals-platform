"""Persisted report artifacts emitted by report runs."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ReportArtifact(Base, TimestampMixin):
    __tablename__ = "report_artifacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.report_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    report_id: Mapped[str] = mapped_column(String(100), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    artifact_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    content_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_run_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latest_source_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("report_run_id", name="uq_report_artifacts_report_run"),
        Index("idx_report_artifacts_tenant_app_scope", "tenant_id", "app_id", "scope"),
        Index("idx_report_artifacts_content_hash", "content_hash"),
        {"schema": "platform"},
    )
