"""Evaluation analytics model — unified caching for single-run reports and cross-run aggregates."""
import uuid
from typing import ClassVar
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Index, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class EvaluationAnalytics(Base, TimestampMixin):
    __tablename__ = "evaluation_analytics"

    CACHE_SCHEMA_VERSION: ClassVar[str] = "v1"
    CACHE_KIND_RUN_REPORT: ClassVar[str] = "single_run"
    CACHE_KIND_CROSS_RUN: ClassVar[str] = "cross_run"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)  # 'single_run' | 'cross_run'
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="CASCADE"), nullable=True
    )
    analytics_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    source_run_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latest_source_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ORM relationship — parent (no backref)
    eval_run = relationship("EvalRun")

    __table_args__ = (
        UniqueConstraint("tenant_id", "app_id", "scope", "run_id", name="uq_analytics_app_scope_run"),
        Index(
            "uq_analytics_cross_run_per_app",
            "tenant_id", "app_id",
            unique=True,
            postgresql_where=text("scope = 'cross_run'"),
        ),
        Index("idx_analytics_app_scope", "app_id", "scope"),
        Index("idx_analytics_tenant_app", "tenant_id", "app_id"),
    )
