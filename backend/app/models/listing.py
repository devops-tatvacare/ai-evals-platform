"""Listing model - evaluation records."""
import uuid
from sqlalchemy import String, JSON, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, UserMixin


class Listing(Base, TimestampMixin, UserMixin):
    __tablename__ = "listings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    source_type: Mapped[str] = mapped_column(String(20), default="upload")
    audio_file: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    transcript_file: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    structured_json_file: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    transcript: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    api_response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    structured_output_references: Mapped[list] = mapped_column(JSON, default=list)
    structured_outputs: Mapped[list] = mapped_column(JSON, default=list)
    ai_eval: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    human_eval: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    evaluator_runs: Mapped[list] = mapped_column(JSON, default=list)

    __table_args__ = (
        Index("idx_listings_updated_at", "updated_at", postgresql_using="btree"),
    )
