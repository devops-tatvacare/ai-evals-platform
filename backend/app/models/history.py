"""History model - audit log for evaluator runs and events."""
import uuid
from sqlalchemy import String, Float, BigInteger, JSON, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, UserMixin


class History(Base, UserMixin):
    __tablename__ = "history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    triggered_by: Mapped[str] = mapped_column(String(20), default="manual")
    schema_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    user_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        Index("idx_history_timestamp", "timestamp"),
        Index("idx_history_entity", "entity_type", "entity_id", "timestamp"),
        Index("idx_history_source", "source_type", "source_id", "timestamp"),
        Index("idx_history_app_source", "app_id", "source_type", "timestamp"),
        Index("idx_history_entity_source", "entity_id", "source_type", "source_id", "timestamp"),
    )
