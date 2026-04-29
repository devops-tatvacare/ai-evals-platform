"""ApplicationTag model - tag registry for autocomplete."""
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TenantUserMixin


class ApplicationTag(Base, TenantUserMixin):
    __tablename__ = "application_tags"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0)
    last_used: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "app_id", "name", "user_id", name="uq_application_tag"),
        Index("idx_application_tags_tenant", "tenant_id"),
        Index("idx_application_tags_tenant_user", "tenant_id", "user_id"),
        Index("idx_application_tags_tenant_app", "tenant_id", "app_id"),
        Index("idx_application_tags_tenant_user_app_name", "tenant_id", "user_id", "app_id", "name"),
        {"schema": "platform"},
    )
