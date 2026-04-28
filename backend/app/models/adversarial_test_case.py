"""Saved adversarial test cases for reusable regression coverage."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantUserMixin


class AdversarialSavedTestCase(Base, TenantUserMixin):
    __tablename__ = "adversarial_test_cases"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, default="kaira-bot")
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    synthetic_input: Mapped[str] = mapped_column(Text, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="MEDIUM")
    goal_flow: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    active_traits: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    expected_challenges: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Optional tactic pin — when set, running this case restricts the persona's
    # attack tactic catalog to this single tactic id. Used by Moriarty regression
    # runs so a pinned case consistently exercises one attack family.
    persona_tactic: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    created_from_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="SET NULL"), nullable=True
    )
    created_from_eval_id: Mapped[int | None] = mapped_column(nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    use_count: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_adversarial_test_cases_tenant_user", "tenant_id", "user_id", "created_at"),
        Index("idx_adversarial_test_cases_tenant_app", "tenant_id", "app_id", "created_at"),
        {"schema": "platform"},
    )
