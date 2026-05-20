"""Per-tenant curated model allowlist for non-Azure providers.

Each row enables one canonical catalog model (``analytics.ref_llm_models_catalog``)
for one credential. Call-site dropdowns show ONLY curated models (strict — an
empty set means no selectable models). Azure OpenAI curates via
``tenant_llm_deployments`` instead; this table covers openai / anthropic /
gemini / vertex / bedrock.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TenantCuratedModel(Base):
    __tablename__ = "tenant_curated_models"
    __table_args__ = (
        UniqueConstraint(
            "credential_id", "canonical_model_id", name="uq_tenant_curated_model"
        ),
        Index("idx_tenant_curated_models_credential", "credential_id"),
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
    canonical_model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analytics.ref_llm_models_catalog.id", ondelete="RESTRICT"),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
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
