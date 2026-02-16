"""Chat models - sessions and messages."""
import uuid
from sqlalchemy import String, Text, Boolean, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin, UserMixin


class ChatSession(Base, TimestampMixin, UserMixin):
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


class ChatMessage(Base, UserMixin):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="complete")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(
        String, server_default="now()"
    )

    session: Mapped["ChatSession"] = relationship(back_populates="messages")
