"""Evaluator model - custom evaluator definitions."""

import uuid

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantUserMixin, TimestampMixin
from app.models.mixins.shareable import ShareableMixin, shareable_uuid_forked_from


class Evaluator(Base, TimestampMixin, TenantUserMixin, ShareableMixin):
    __tablename__ = "evaluators"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    listing_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    model_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    output_schema: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    linked_rule_ids: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    forked_from: Mapped[uuid.UUID | None] = shareable_uuid_forked_from("evaluators")
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    template_branch_key: Mapped[str | None] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        Index("idx_evaluators_tenant", "tenant_id"),
        Index("idx_evaluators_tenant_user", "tenant_id", "user_id"),
        Index("idx_evaluators_tenant_app", "tenant_id", "app_id"),
    )
