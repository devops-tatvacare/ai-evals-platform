"""Tag model - tag registry for autocomplete."""
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, UserMixin


class Tag(Base, UserMixin):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0)
    last_used: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("app_id", "name", "user_id", name="uq_tag"),
    )
