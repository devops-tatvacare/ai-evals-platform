"""Per-(tenant, call_site) LLM resolution defaults.

One row per (tenant_id, call_site). ``tenant_id IS NULL`` rows are the
platform-wide fallback consulted when a tenant has no explicit row.

``credential_name`` references ``platform.tenant_llm_credentials.name`` by
convention only (no FK — credentials are tenant-scoped while platform-default
rows have ``tenant_id IS NULL``). Resolver falls back to single-credential
auto-resolution when the named credential doesn't exist for the tenant.

``model_or_deployment`` carries either a catalog model id (non-Azure) or an
Azure deployment name (which the resolver maps to a canonical catalog row via
``tenant_llm_deployments``).

UNIQUE constraint ``(tenant_id, call_site)`` uses Postgres 15+
``NULLS NOT DISTINCT`` semantics so the single platform-default row per
call_site (NULL tenant_id) is enforced alongside per-tenant rows.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TenantCallSiteDefault(Base):
    __tablename__ = "tenant_call_site_defaults"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "call_site",
            name="uq_tenant_call_site_defaults",
            postgresql_nulls_not_distinct=True,
        ),
        Index("idx_tenant_call_site_defaults_tenant", "tenant_id"),
        Index("idx_tenant_call_site_defaults_call_site", "call_site"),
        {"schema": "platform"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Nullable: ``NULL`` = platform-wide default row, consulted when no
    # tenant-specific row matches.
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=True,
    )
    call_site: Mapped[str] = mapped_column(String(64), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    credential_name: Mapped[str] = mapped_column(
        String(64), nullable=False, default="default"
    )
    model_or_deployment: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="SET NULL"),
        nullable=True,
    )
