"""Setting model - user/app configuration."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantUserMixin
from app.models.mixins.shareable import ShareableMixin, shareable_int_forked_from


class Setting(Base, TenantUserMixin, ShareableMixin):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    app_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    forked_from: Mapped[int | None] = shareable_int_forked_from("settings")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_settings_tenant", "tenant_id"),
        Index("idx_settings_tenant_user", "tenant_id", "user_id"),
        UniqueConstraint("tenant_id", "app_id", "key", "user_id", "visibility", name="uq_setting"),
        Index(
            "uq_settings_private_scope",
            "tenant_id",
            "app_id",
            "key",
            "user_id",
            unique=True,
            postgresql_where=text("visibility = 'PRIVATE'"),
        ),
        Index(
            "uq_settings_shared_scope",
            "tenant_id",
            "app_id",
            "key",
            "visibility",
            unique=True,
            postgresql_where=text("visibility = 'SHARED'"),
        ),
        {"schema": "platform"},
    )
