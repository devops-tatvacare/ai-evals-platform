"""ProviderConnection ORM — orchestration.provider_connections.

First-class credential row for the orchestration node engine. Replaces the
env-var rollout (BOLNA_*, WATI_*, LSQ_*, MSG91_*, AISENSY_*).

`config_encrypted` holds a Fernet-encrypted JSON blob; the plaintext shape is
declared in `app.services.orchestration.connections.provider_specs`. ORM never
touches the plaintext — encrypt/decrypt happens via the crypto helper.

Per design spec docs/plans/orchestration/phase-10-connections-and-builder-polish.md §1.1.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, synonym

from app.models.base import Base
from app.models.mixins.shareable import ShareableMixin


class ProviderConnection(ShareableMixin, Base):
    asset_family = "connection"
    __tablename__ = "provider_connections"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "app_id", "provider", "name",
            name="uq_provider_connections_scope_provider_name",
        ),
        # Real DB-side uniqueness on webhook_token is a partial index
        # (WHERE webhook_token IS NOT NULL) owned by migration 0022. The
        # plain Index below mirrors the column for ORM metadata only.
        Index(
            "uq_provider_connections_webhook_token_orm",
            "webhook_token",
            unique=False,
        ),
        Index(
            "idx_provider_connections_tenant_app_provider_active_orm",
            "tenant_id", "app_id", "provider",
            unique=False,
        ),
        Index(
            "idx_provider_connections_tenant_app_visibility_active_orm",
            "tenant_id", "app_id", "visibility", "active",
            unique=False,
        ),
        Index(
            "idx_provider_connections_tenant_app_created_by_active_orm",
            "tenant_id", "app_id", "created_by", "active",
            unique=False,
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    config_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    webhook_token: Mapped[Optional[str]] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    user_id = synonym("created_by")


__all__ = ["ProviderConnection"]
