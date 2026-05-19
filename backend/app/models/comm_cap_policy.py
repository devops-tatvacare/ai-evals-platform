"""Per tenant + app communication cap policy (Phase 2).

One active row per (tenant_id, app_id) governs the rolling-window cap. The
cap_runtime guard on every dispatch node counts recent
``workflow_run_recipient_actions`` rows for the recipient's E.164 phone over
``window_seconds`` and skips when the count >= ``max_count``.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CommCapPolicy(Base):
    __tablename__ = "comm_cap_policies"
    __table_args__ = (
        UniqueConstraint("tenant_id", "app_id", name="uq_comm_cap_per_app"),
        CheckConstraint("max_count > 0", name="ck_comm_cap_max_count_positive"),
        CheckConstraint("window_seconds > 0", name="ck_comm_cap_window_positive"),
        {"schema": "platform"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    max_count: Mapped[int] = mapped_column(Integer, nullable=False)
    window_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
