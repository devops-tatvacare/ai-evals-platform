"""Generic human review models for evaluation runs."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class EvalReview(Base):
    __tablename__ = "eval_reviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="CASCADE"), nullable=False
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    reviewer_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    overall_decision: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_snapshot: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped["EvalRun"] = relationship("EvalRun", foreign_keys=[run_id], back_populates="reviews")
    items: Mapped[list["EvalReviewItem"]] = relationship(
        back_populates="review", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        Index("idx_eval_reviews_run_status_created", "run_id", "status", "created_at"),
        Index("idx_eval_reviews_reviewer_created", "reviewer_user_id", "created_at"),
        Index(
            "uq_eval_reviews_run_reviewer_draft",
            "run_id",
            "reviewer_user_id",
            unique=True,
            postgresql_where=text("status = 'draft'"),
        ),
        {"schema": "platform"},
    )


class EvalReviewItem(Base):
    __tablename__ = "eval_review_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_reviews.id", ondelete="CASCADE"), nullable=False
    )
    item_key: Mapped[str] = mapped_column(String(200), nullable=False)
    item_type: Mapped[str] = mapped_column(String(80), nullable=False)
    attribute_key: Mapped[str] = mapped_column(String(120), nullable=False)
    original_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision: Mapped[str] = mapped_column(String(20), nullable=False)
    reason_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    review: Mapped["EvalReview"] = relationship(back_populates="items")

    __table_args__ = (
        Index("uq_eval_review_items_review_item_attribute", "review_id", "item_key", "attribute_key", unique=True),
        Index("idx_eval_review_items_review_created", "review_id", "created_at"),
        {"schema": "platform"},
    )
