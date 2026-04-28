"""Eval run models — single source of truth for evaluation runs."""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Float, Boolean, JSON, ForeignKey, DateTime, Index, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TenantUserMixin
from app.models.mixins.shareable import ShareableMixin


class EvalRun(Base, TenantUserMixin, ShareableMixin):
    __tablename__ = "eval_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    eval_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # 'custom' | 'full_evaluation' | 'call_quality' | 'batch_thread' | 'batch_adversarial'

    # Source FKs (polymorphic — exactly one set per row)
    listing_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.listings.id", ondelete="CASCADE"), nullable=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.chat_sessions.id", ondelete="CASCADE"), nullable=True
    )

    # Evaluator FK (for eval_type='custom')
    evaluator_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.evaluators.id", ondelete="SET NULL"), nullable=True
    )

    # Job FK (for async runs)
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.jobs.id", ondelete="SET NULL"), nullable=True
    )
    latest_review_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_reviews.id", ondelete="SET NULL"), nullable=True
    )

    # Execution
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    # LLM context
    llm_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Eval inputs snapshot (prompts, schemas, prerequisites, model config)
    config: Mapped[dict] = mapped_column(JSON, default=dict)

    # Eval output (the full structured result — critique, transcript, scores, etc.)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Quick-access summary for list views (main score, verdict, counts)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Batch-specific metadata (data_path, data_file_hash, thread count, flags, name, description)
    batch_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Standard
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # ORM relationships — children
    thread_evaluations: Mapped[list["ThreadEvaluation"]] = relationship(
        back_populates="eval_run", cascade="all, delete-orphan", passive_deletes=True
    )
    adversarial_evaluations: Mapped[list["AdversarialEvaluation"]] = relationship(
        back_populates="eval_run", cascade="all, delete-orphan", passive_deletes=True
    )
    api_logs: Mapped[list["ApiLog"]] = relationship(
        back_populates="eval_run", cascade="all, delete-orphan", passive_deletes=True
    )
    reviews: Mapped[list["EvalReview"]] = relationship(
        "EvalReview",
        foreign_keys="EvalReview.run_id",
        back_populates="run",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    # ORM relationships — parents
    listing = relationship("Listing", back_populates="eval_runs")
    session = relationship("ChatSession", back_populates="eval_runs")

    __table_args__ = (
        Index("idx_eval_runs_listing", "listing_id", "created_at"),
        Index("idx_eval_runs_session", "session_id", "created_at"),
        Index("idx_eval_runs_app_type", "app_id", "eval_type", "created_at"),
        Index("idx_eval_runs_evaluator", "evaluator_id"),
        Index("idx_eval_runs_tenant", "tenant_id"),
        Index("idx_eval_runs_tenant_app", "tenant_id", "app_id", "created_at"),
        Index("idx_eval_runs_tenant_user", "tenant_id", "user_id", "created_at"),
        Index("idx_eval_runs_tenant_user_app_created", "tenant_id", "user_id", "app_id", "created_at"),
        Index("idx_eval_runs_tenant_app_visibility_created", "tenant_id", "app_id", "visibility", "created_at"),
        Index(
            "idx_eval_runs_tenant_user_app_status_created",
            "tenant_id",
            "user_id",
            "app_id",
            "status",
            "created_at",
        ),
        Index("idx_eval_runs_tenant_visibility_created", "tenant_id", "visibility", "created_at"),
        Index("idx_eval_runs_latest_review", "latest_review_id"),
        {"schema": "platform"},
    )


class ThreadEvaluation(Base):
    __tablename__ = "thread_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    thread_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    data_file_hash: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    intent_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    worst_correctness: Mapped[str | None] = mapped_column(String(20), nullable=True)
    efficiency_verdict: Mapped[str | None] = mapped_column(String(20), nullable=True)
    success_status: Mapped[bool] = mapped_column(Boolean, default=False)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    eval_run: Mapped["EvalRun"] = relationship(back_populates="thread_evaluations")

    __table_args__ = (
        Index("idx_thread_evaluations_thread_id_id", "thread_id", "id"),
        {"schema": "platform"},
    )


class AdversarialEvaluation(Base):
    __tablename__ = "adversarial_evaluations"
    __table_args__ = {"schema": "platform"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    goal_flow: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # ["meal_logged", "cgm_insight"]
    difficulty: Mapped[str | None] = mapped_column(String(20), nullable=True)
    active_traits: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # ["ambiguous_qty", ...]
    verdict: Mapped[str | None] = mapped_column(String(20), nullable=True)
    goal_achieved: Mapped[bool] = mapped_column(Boolean, default=False)
    total_turns: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    eval_run: Mapped["EvalRun"] = relationship(back_populates="adversarial_evaluations")


class ApiLog(Base):
    __tablename__ = "api_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    thread_id: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    test_case_label: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    method: Mapped[str] = mapped_column(String(50), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    response: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    eval_run: Mapped["EvalRun | None"] = relationship(back_populates="api_logs")

    __table_args__ = (
        Index("idx_api_logs_run_id_id", "run_id", id.desc()),
        {"schema": "platform"},
    )
