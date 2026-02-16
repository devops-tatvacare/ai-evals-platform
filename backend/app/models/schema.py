"""Schema model - versioned JSON schemas for structured LLM output."""
from sqlalchemy import String, Text, Integer, Boolean, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, UserMixin


class Schema(Base, TimestampMixin, UserMixin):
    __tablename__ = "schemas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    prompt_type: Mapped[str] = mapped_column(String(50), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    schema_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        UniqueConstraint("app_id", "prompt_type", "version", "user_id", name="uq_schema_version"),
    )
