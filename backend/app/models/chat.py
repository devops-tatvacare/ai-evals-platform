"""Chat models - sessions and messages."""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, JSON, ForeignKey, DateTime, Index, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.constants import SHERLOCK_CHAT_SOURCE
from app.models.base import Base, TimestampMixin, TenantUserMixin


class ChatSession(Base, TimestampMixin, TenantUserMixin):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    external_user_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    thread_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    server_session_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_response_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    title: Mapped[str] = mapped_column(String(500), default="New Chat")
    status: Mapped[str] = mapped_column(String(20), default="active")
    is_first_message: Mapped[bool] = mapped_column(Boolean, default=True)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )

    # Eval runs cascade from here
    eval_runs = relationship(
        "EvalRun", back_populates="session",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    __table_args__ = (
        Index("idx_chat_sessions_tenant", "tenant_id"),
        Index("idx_chat_sessions_tenant_user", "tenant_id", "user_id"),
        Index("idx_chat_sessions_tenant_app", "tenant_id", "app_id"),
        Index(
            "idx_chat_sessions_tenant_user_app_updated",
            "tenant_id",
            "user_id",
            "app_id",
            text("updated_at DESC"),
        ),
        Index(
            "idx_chat_sessions_tenant_user_app_source_updated",
            "tenant_id",
            "user_id",
            "app_id",
            "server_session_id",
            text("updated_at DESC"),
        ),
        Index(
            "idx_chat_sessions_non_sherlock_updated",
            "tenant_id",
            "user_id",
            "app_id",
            text("updated_at DESC"),
            postgresql_where=text(
                f"server_session_id IS DISTINCT FROM '{SHERLOCK_CHAT_SOURCE}'"
            ),
        ),
        {"schema": "platform"},
    )


class ChatMessage(Base, TenantUserMixin):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="complete")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    session: Mapped["ChatSession"] = relationship(back_populates="messages")

    __table_args__ = (
        Index("idx_chat_messages_tenant", "tenant_id"),
        Index("idx_chat_messages_tenant_user", "tenant_id", "user_id"),
        Index("idx_chat_messages_session_created", "session_id", "created_at"),
        {"schema": "platform"},
    )
