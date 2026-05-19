"""Durable agent state and event log for Sherlock chat sessions."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantUserMixin, TimestampMixin

# v3 — sherlock_state and sherlock_evidence are added by Alembic
# 0035_sherlock_v3_state_evidence. Models below mirror the migration shape.


class SherlockAgentSession(Base, TenantUserMixin, TimestampMixin):
    __tablename__ = 'sherlock_agent_sessions'

    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.chat_sessions.id', ondelete='CASCADE'),
        primary_key=True,
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    message_state: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    next_event_seq: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1'))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_response_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 7 audit fix (Gap 7): watermark for "jobs completed since last
    # turn". The chat handler surfaces terminal (completed/failed/cancelled)
    # jobs in the per-turn context exactly once; updating this column after
    # each turn prevents replaying the whole session's job history.
    last_job_observed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # Running input-token total across all turns since the last
    # server-side compaction. Used by the chat widget's "context
    # filling" progress pill (renders once the ratio crosses
    # CONTEXT_PROGRESS_START_RATIO from compaction.py). Reset to zero
    # when a ``compaction_emitted`` event fires.
    cumulative_input_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text('0'),
    )

    __table_args__ = (
        Index('idx_sherlock_agent_sessions_tenant_app', 'tenant_id', 'app_id'),
        {"schema": "platform"},
    )


class SherlockConversationTurn(Base, TenantUserMixin, TimestampMixin):
    __tablename__ = 'sherlock_conversation_turns'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.chat_sessions.id', ondelete='CASCADE'),
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
        UniqueConstraint('chat_session_id', 'client_turn_id', name='uq_sherlock_conversation_turn_client_id'),
        Index('idx_sherlock_conversation_turn_status', 'chat_session_id', 'status'),
        Index(
            'idx_sherlock_conversation_turn_correlation_id',
            'correlation_id',
            postgresql_where=text('correlation_id IS NOT NULL'),
        ),
        {"schema": "platform"},
    )


class SherlockPart(Base, TenantUserMixin):
    """One typed row per emit through PartEmitter — payload shape is identical to SSE wire + React prop."""

    __tablename__ = 'sherlock_parts'

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.chat_sessions.id', ondelete='CASCADE'),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    call_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    __table_args__ = (
        UniqueConstraint('chat_session_id', 'seq', name='uq_sherlock_parts_session_seq'),
        Index('idx_sherlock_parts_session_seq', 'chat_session_id', 'seq'),
        Index('idx_sherlock_parts_type', 'type'),
        Index(
            'idx_sherlock_parts_call_id',
            'call_id',
            postgresql_where=text('call_id IS NOT NULL'),
        ),
        Index(
            'idx_sherlock_parts_tenant_created',
            'tenant_id', 'created_at',
        ),
        {"schema": "platform"},
    )


class SherlockState(Base):
    """v3 — small structured cross-turn state, one row per chat_session.

    DORMANT today. Replaced the legacy 17-key scratchpad on
    ``SherlockAgentSession``; supervisor reads at the start of each
    turn via ``state_store.load_state``. No producer wires writes today,
    so the table stays empty for every session; awaiting a future
    structured-output PR.
    """

    __tablename__ = 'sherlock_state'

    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.chat_sessions.id', ondelete='CASCADE'),
        primary_key=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.tenants.id', ondelete='CASCADE'),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.users.id', ondelete='CASCADE'),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    resolved_entities: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"),
    )
    active_filters: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"),
    )
    last_artifact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )
    last_specialist_call_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    __table_args__ = (
        Index(
            'idx_sherlock_state_tenant_user_app',
            'tenant_id', 'user_id', 'app_id',
        ),
        {"schema": "platform"},
    )


class SherlockEvidence(Base):
    """v3 — append-only evidence ledger.

    Specialists write one row per piece of evidence (sql_row, vector_chunk,
    kg_triple, action_receipt, doc_excerpt). ``SpecialistResult.evidence`` is
    a list of ``ref_id`` references; the supervisor passes refs between
    specialists rather than inlining payloads.

    Composite scope (tenant_id, user_id, app_id, chat_session_id) mirrors the
    rest of Sherlock. ``ON DELETE CASCADE`` from ``platform.chat_sessions``
    handles cleanup.
    """

    __tablename__ = 'sherlock_evidence'

    ref_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.chat_sessions.id', ondelete='CASCADE'),
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.tenants.id', ondelete='CASCADE'),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.users.id', ondelete='CASCADE'),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    locator: Mapped[dict] = mapped_column(JSONB, nullable=False)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    __table_args__ = (
        Index(
            'idx_sherlock_evidence_session',
            'chat_session_id', 'created_at',
        ),
        Index(
            'idx_sherlock_evidence_tenant_user_app',
            'tenant_id', 'user_id', 'app_id', 'created_at',
        ),
        {"schema": "platform"},
    )
