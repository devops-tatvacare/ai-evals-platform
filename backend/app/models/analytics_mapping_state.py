"""Operator-controlled mirror -> fact mapping state (Phase 2).

One row per ``(app_id, source_table, target_fact, activity_type)``.
``enabled=false`` means steady-state sync skips fact-writing for that
mapping and proceeds mirror-only; backfill is required before re-enable.
Disable is a manual operator action, never code (per invariant 1.1.6 of
``docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md``).
Admin endpoints land in Phase 3.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MappingState(Base):
    """Persistence for per-mapping operator-disable state."""

    __tablename__ = "mapping_state"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_table: Mapped[str] = mapped_column(String(255), nullable=False)
    target_fact: Mapped[str] = mapped_column(String(255), nullable=False)
    activity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    disabled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    disabled_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "app_id",
            "source_table",
            "target_fact",
            "activity_type",
            name="uq_mapping_state_app_source_target_activity",
        ),
        {"schema": "analytics"},
    )


__all__ = ["MappingState"]
