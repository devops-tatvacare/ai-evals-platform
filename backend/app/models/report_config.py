"""Persisted report definitions for the reporting composer."""

import uuid

from sqlalchemy import Boolean, Enum as SAEnum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantUserMixin, TimestampMixin
from app.models.mixins.shareable import ShareableMixin, Visibility


class ReportConfiguration(Base, TimestampMixin, TenantUserMixin, ShareableMixin):
    __tablename__ = "report_configurations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    report_id: Mapped[str] = mapped_column(String(100), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    source_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.chat_sessions.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )
    presentation_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    narrative_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    export_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    default_report_run_visibility: Mapped[Visibility] = mapped_column(
        SAEnum(Visibility, name="asset_visibility", native_enum=False),
        nullable=False,
        default=Visibility.PRIVATE,
        server_default=Visibility.PRIVATE.name,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (
        UniqueConstraint("tenant_id", "app_id", "report_id", name="uq_report_configurations_tenant_app_report"),
        Index("idx_report_configurations_tenant_app_scope", "tenant_id", "app_id", "scope"),
        Index("idx_report_configurations_tenant_app_default", "tenant_id", "app_id", "is_default"),
        {"schema": "platform"},
    )
