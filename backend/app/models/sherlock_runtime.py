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
        server_default=text(
            "'{\"findings\": [], \"composed_report\": null, \"errors\": [], \"discovery\": null, \"lookups\": {}, \"resolved_entities\": {}, \"active_filters\": {}, \"discovered_schema\": {\"tables_inspected\": [], \"columns_by_table\": {}, \"relations_found\": [], \"json_structures\": {}}, \"last_analysis\": null, \"analysis_history\": [], \"last_evidence\": null, \"last_data_check\": null}'::jsonb"
        ),
    )
    next_event_seq: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1'))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_response_id: Mapped[str | None] = mapped_column(Text, nullable=True)

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


class SherlockRuntimeTurn(Base, TenantUserMixin, TimestampMixin):
    __tablename__ = 'sherlock_runtime_turns'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('chat_sessions.id', ondelete='CASCADE'),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    client_turn_id: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    user_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'queued'"))
    assistant_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    last_event_seq: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint('chat_session_id', 'client_turn_id', name='uq_sherlock_runtime_turn_client_id'),
        Index('idx_sherlock_runtime_turn_status', 'chat_session_id', 'status'),
        Index('idx_sherlock_runtime_turn_correlation_id', 'correlation_id'),
    )
