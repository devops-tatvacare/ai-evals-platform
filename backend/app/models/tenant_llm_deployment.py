"""Azure-style deployment registry.

Each row is a tenant-chosen deployment name that resolves to a canonical
catalog model (``analytics.ref_llm_models_catalog``). Forward-declared and
authoritative for dropdown listings + cost-tracking alias generation.

Only Azure OpenAI uses this today. Vertex and Bedrock route to canonical
catalog models directly (location/region travels per-call in ``extra_config``
on the parent credential).

``canonical_model_id`` is nullable because the migration-0050 backfill may
not be able to resolve a deployment name to a catalog model on first pass.
Rows with ``needs_mapping=true`` keep their ``deployment_name`` intact and
are surfaced in the admin UI for operator mapping — they are excluded from
``/api/llm/models`` dropdown results until mapped.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TenantLlmDeployment(Base):
    __tablename__ = "tenant_llm_deployments"
    __table_args__ = (
        UniqueConstraint(
            "credential_id", "deployment_name", name="uq_tenant_llm_deployment_name"
        ),
        Index("idx_tenant_llm_deployments_credential", "credential_id"),
        Index(
            "idx_tenant_llm_deployments_needs_mapping",
            "needs_mapping",
            postgresql_where=text("needs_mapping = true"),
        ),
        {"schema": "platform"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    credential_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenant_llm_credentials.id", ondelete="CASCADE"),
        nullable=False,
    )
    deployment_name: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analytics.ref_llm_models_catalog.id", ondelete="RESTRICT"),
        nullable=True,
    )
    api_version_override: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    needs_mapping: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
