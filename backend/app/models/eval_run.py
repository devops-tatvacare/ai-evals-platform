"""Eval run models — single source of truth for ALL evaluations.

Unified model: custom, full_evaluation, human, batch_thread, batch_adversarial.
Proper FKs, cascading deletes, normalized structure.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Float, Boolean, JSON, ForeignKey, DateTime, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, UserMixin


class EvalRun(Base, UserMixin):
    __tablename__ = "eval_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    eval_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # 'custom' | 'full_evaluation' | 'human' | 'batch_thread' | 'batch_adversarial'

    # Source FKs (polymorphic — exactly one set per row)
    listing_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=True
    )

    # Evaluator FK (for eval_type='custom')
    evaluator_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evaluators.id", ondelete="SET NULL"), nullable=True
    )

    # Job FK (for async runs)
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
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

    # ORM relationships — parents
    listing = relationship("Listing", back_populates="eval_runs")
    session = relationship("ChatSession", back_populates="eval_runs")

    __table_args__ = (
        Index("idx_eval_runs_listing", "listing_id", "created_at"),
        Index("idx_eval_runs_session", "session_id", "created_at"),
        Index("idx_eval_runs_app_type", "app_id", "eval_type", "created_at"),
        Index("idx_eval_runs_evaluator", "evaluator_id"),
    )


class ThreadEvaluation(Base):
    __tablename__ = "thread_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False, index=True
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


class AdversarialEvaluation(Base):
    __tablename__ = "adversarial_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(20), nullable=True)
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
        UUID(as_uuid=True), ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=True, index=True
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
