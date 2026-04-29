"""Listing model - evaluation records."""
import uuid
from sqlalchemy import String, JSON, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin, TenantUserMixin


class Listing(Base, TimestampMixin, TenantUserMixin):
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

    # Evaluation runs cascade from here
    evaluation_runs = relationship(
        "EvaluationRun", back_populates="listing",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    __table_args__ = (
        Index("idx_listings_updated_at", "updated_at", postgresql_using="btree"),
        Index("idx_listings_tenant", "tenant_id"),
        Index("idx_listings_tenant_user", "tenant_id", "user_id"),
        Index("idx_listings_tenant_app", "tenant_id", "app_id"),
        Index(
            "idx_listings_tenant_user_app_updated",
            "tenant_id",
            "user_id",
            "app_id",
            text("updated_at DESC"),
        ),
        {"schema": "platform"},
    )
