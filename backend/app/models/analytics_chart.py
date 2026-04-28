"""Saved chart — stores SQL query + chart config for live re-execution."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, TenantUserMixin
from app.models.mixins.shareable import ShareableMixin


class AnalyticsChart(Base, TenantUserMixin, ShareableMixin, TimestampMixin):
    __tablename__ = "analytics_charts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")

    # The SQL query (with :tenant_id, :app_id placeholders) — re-executed on every load
    sql_query: Mapped[str] = mapped_column(Text, nullable=False)

    # Chart rendering config: {type, xKey, yKey, seriesKeys, colorMap, ...}
    chart_config: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Optional: the natural language question that generated this chart
    source_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.chat_sessions.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )

    # Soft delete
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )

    __table_args__ = (
        Index(
            "idx_analytics_charts_owned_active",
            "tenant_id",
            "user_id",
            "app_id",
            text("created_at DESC"),
            postgresql_where=text("archived_at IS NULL"),
        ),
        Index(
            "idx_analytics_charts_shared_active",
            "tenant_id",
            "app_id",
            "visibility",
            text("created_at DESC"),
            postgresql_where=text("archived_at IS NULL"),
        ),
        {"schema": "platform"},
    )
