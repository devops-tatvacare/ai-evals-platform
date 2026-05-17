"""Per-tenant LLM provider credentials — multi-credential capable.

One row per ``(tenant, provider, name)``. ``secret_blob_encrypted`` is a
Fernet-encrypted JSON dict (see ``app.services.llm_credentials.crypto``)
shaped per provider:

  - openai / anthropic / azure_openai : ``{"api_key": "..."}``
  - gemini (BYOK API key)             : ``{"api_key": "..."}``
  - vertex                            : ``{"service_account_json": "<JSON string>"}``
  - bedrock                           : ``{"access_key_id": "...", "secret_access_key": "...",
                                            "session_token": "..."}``  (session_token optional)

Plaintext non-secret config (Azure endpoint, Vertex project_id, Bedrock
default_region, etc.) lives in ``extra_config`` — never inside the secret
blob. Azure deployments are forward-declared in
``platform.tenant_llm_deployments`` (one row per deployment).
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    UniqueConstraint,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column


from app.models.base import Base


class TenantLlmCredential(Base):
    __tablename__ = "tenant_llm_credentials"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "provider", "name", name="uq_tenant_llm_credential"
        ),
        Index("idx_tenant_llm_credentials_tenant", "tenant_id"),
        {"schema": "platform"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default=text("'default'")
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    secret_blob_encrypted: Mapped[bytes] = mapped_column(
        LargeBinary, nullable=False
    )
    extra_config: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    validation_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="untested", server_default="untested"
    )
    last_validated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
