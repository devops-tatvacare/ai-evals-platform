"""Durable runtime state and event log for Sherlock chat sessions."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantUserMixin, TimestampMixin


class SherlockRuntimeSession(Base, TenantUserMixin, TimestampMixin):
    __tablename__ = 'sherlock_runtime_sessions'

    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('chat_sessions.id', ondelete='CASCADE'),
        primary_key=True,
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    message_state: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    scratchpad: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{\"findings\": [], \"composed_report\": null, \"errors\": []}'::jsonb"),
    )
    next_event_seq: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1'))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index('idx_sherlock_runtime_tenant_app', 'tenant_id', 'app_id'),
    )


class SherlockRuntimeEvent(Base, TenantUserMixin):
    __tablename__ = 'sherlock_runtime_events'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('chat_sessions.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint('chat_session_id', 'seq'),
        Index('idx_sherlock_runtime_events_session_seq', 'chat_session_id', 'seq'),
    )
