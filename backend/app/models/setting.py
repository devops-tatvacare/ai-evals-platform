"""Setting model - user/app configuration."""
from sqlalchemy import String, JSON, UniqueConstraint, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from app.models.base import Base, UserMixin


class Setting(Base, UserMixin):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    app_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("app_id", "key", "user_id", name="uq_setting"),
    )
