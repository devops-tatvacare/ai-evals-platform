"""Evaluator model - custom evaluator definitions."""
import uuid
from sqlalchemy import String, Text, Boolean, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, UserMixin


class Evaluator(Base, TimestampMixin, UserMixin):
    __tablename__ = "evaluators"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    listing_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    model_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    output_schema: Mapped[list] = mapped_column(JSON, default=list)
    is_global: Mapped[bool] = mapped_column(Boolean, default=False)
    show_in_header: Mapped[bool] = mapped_column(Boolean, default=False)
    forked_from: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evaluators.id", ondelete="SET NULL"), nullable=True
    )
