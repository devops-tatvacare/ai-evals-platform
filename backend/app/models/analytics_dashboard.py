"""Dashboard — ordered collection of chart references with layout metadata."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, TenantUserMixin
from app.models.mixins.shareable import ShareableMixin


class AnalyticsDashboard(Base, TenantUserMixin, ShareableMixin, TimestampMixin):
    __tablename__ = "analytics_dashboards"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")

    # Ordered list of chart IDs + optional per-chart layout overrides
    # [{chart_id: "uuid", width: "half"|"full", order: 0}, ...]
    chart_entries: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    source_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.chat_sessions.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )

    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )

    __table_args__ = (
        Index(
            "idx_analytics_dashboards_owned_active",
            "tenant_id",
            "user_id",
            "app_id",
            text("created_at DESC"),
            postgresql_where=text("archived_at IS NULL"),
        ),
        Index(
            "idx_analytics_dashboards_shared_active",
            "tenant_id",
            "app_id",
            "visibility",
            text("created_at DESC"),
            postgresql_where=text("archived_at IS NULL"),
        ),
        {"schema": "platform"},
    )
