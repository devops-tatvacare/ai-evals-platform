"""LogClinicalActionOutbox — stub queue for clinical orchestration handlers.

Phase 9 introduces a generic outbox table that ``clinical.*`` node handlers
write into instead of calling external EMR APIs directly. Downstream
consumers (EMR sync workers, care-team UIs) poll
``WHERE status='pending'`` and update ``status='consumed' / 'failed'``
once they've processed the row.

Cross-schema FK to ``platform.tenants`` matches the rest of the
analytics schema's tenant ownership pattern.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LogClinicalActionOutbox(Base):
    __tablename__ = "log_clinical_action_outbox"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "recipient_id",
            "idempotency_key",
            name="uq_log_clinical_action_outbox_idem",
        ),
        CheckConstraint(
            "status IN ('pending', 'consumed', 'failed')",
            name="ck_log_clinical_action_outbox_status",
        ),
        Index(
            "idx_log_clinical_action_outbox_pending",
            "tenant_id",
            "app_id",
            "action_type",
            "created_at",
            postgresql_where="status = 'pending'",
        ),
        Index(
            "idx_log_clinical_action_outbox_recipient",
            "tenant_id",
            "recipient_id",
            "created_at",
        ),
        {"schema": "analytics"},
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
    recipient_id: Mapped[str] = mapped_column(String(128), nullable=False)
    action_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    consumed_by: Mapped[Optional[str]] = mapped_column(String(64))
    error: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
