"""Analytics fact tables — pre-extracted from eval runs for fast querying."""
import uuid
from datetime import datetime
from sqlalchemy import Text, Integer, Float, Boolean, ForeignKey, DateTime, Index, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TenantUserMixin


class AnalyticsRunFact(Base, TenantUserMixin):
    __tablename__ = "analytics_run_facts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    eval_type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    thread_count: Mapped[int | None] = mapped_column(Integer, default=0)
    pass_count: Mapped[int | None] = mapped_column(Integer, default=0)
    fail_count: Mapped[int | None] = mapped_column(Integer, default=0)
    error_count: Mapped[int | None] = mapped_column(Integer, default=0)
    pass_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_intent_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    adversarial_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    adversarial_blocked: Mapped[int | None] = mapped_column(Integer, nullable=True)
    adversarial_block_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    run_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    avg_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'"))

    __table_args__ = (
        Index("idx_arf_tenant_app", "tenant_id", "app_id", created_at.desc()),
        Index("idx_arf_app_type", "app_id", "eval_type", created_at.desc()),
        Index("idx_arf_context", "context", postgresql_using="gin"),
    )


class AnalyticsEvalFact(Base):
    __tablename__ = "analytics_eval_facts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    eval_type: Mapped[str] = mapped_column(Text, nullable=False)
    item_id: Mapped[str] = mapped_column(Text, nullable=False)
    item_type: Mapped[str] = mapped_column(Text, nullable=False)
    evaluator_type: Mapped[str] = mapped_column(Text, nullable=False)
    evaluator_name: Mapped[str] = mapped_column(Text, nullable=False)
    evaluator_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    result_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    result_verdict: Mapped[str | None] = mapped_column(Text, nullable=True)
    success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    direction: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    intent: Mapped[str | None] = mapped_column(Text, nullable=True)
    route: Mapped[str | None] = mapped_column(Text, nullable=True)
    query_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_turns: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_detail: Mapped[dict | None] = mapped_column(JSONB, server_default=text("'{}'"))
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("idx_aef_run", "run_id"),
        Index("idx_aef_tenant_app", "tenant_id", "app_id", created_at.desc()),
        Index("idx_aef_item", "item_id", "evaluator_type"),
        Index("idx_aef_evaluator", "evaluator_type", "evaluator_name", "result_status"),
        Index("idx_aef_context", "context", postgresql_using="gin"),
    )


class AnalyticsCriterionFact(Base):
    __tablename__ = "analytics_criterion_facts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[str] = mapped_column(Text, nullable=False)
    criterion_source: Mapped[str] = mapped_column(Text, nullable=False)
    criterion_id: Mapped[str] = mapped_column(Text, nullable=False)
    criterion_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    evaluator_type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("idx_acf_run", "run_id"),
        Index("idx_acf_tenant_app", "tenant_id", "app_id"),
        Index("idx_acf_criterion", "criterion_id", "status"),
        Index("idx_acf_tenant_app_criterion", "tenant_id", "app_id", "criterion_id", "status"),
        Index("idx_acf_item", "item_id"),
    )
