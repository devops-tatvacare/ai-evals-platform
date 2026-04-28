"""TenantConfig model — per-tenant settings (URL, branding, domain restrictions)."""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class TenantConfig(Base):
    __tablename__ = "tenant_configs"
    __table_args__ = {"schema": "platform"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    # Tenant-specific app URL (e.g. "https://evals.tatvacare.in")
    app_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Tenant logo URL (e.g. "https://cdn.tatvacare.in/logo.svg")
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Allowed email domains for login/signup. Empty list = no restriction.
    # Example: ["@tatvacare.in", "@tatva.com"]
    allowed_domains: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationship
    tenant = relationship("Tenant", backref="config", uselist=False)
