"""Schema model - versioned JSON schemas for structured LLM output."""

import uuid

from sqlalchemy import Boolean, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantUserMixin, TimestampMixin
from app.models.mixins.shareable import ShareableMixin, shareable_int_forked_from


class Schema(Base, TimestampMixin, TenantUserMixin, ShareableMixin):
    __tablename__ = "schemas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    prompt_type: Mapped[str] = mapped_column(String(50), nullable=False)
    branch_key: Mapped[str] = mapped_column(String(64), nullable=False, default=lambda: str(uuid.uuid4()))
    version: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    schema_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    source_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # 'upload' | 'api'
    forked_from: Mapped[int | None] = shareable_int_forked_from("schemas")

    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "app_id",
            "prompt_type",
            "source_type",
            "branch_key",
            "version",
            name="uq_schema_branch_version",
        ),
        Index("idx_schemas_tenant", "tenant_id"),
        Index("idx_schemas_tenant_user", "tenant_id", "user_id"),
        Index("idx_schemas_tenant_app", "tenant_id", "app_id"),
        Index(
            "idx_schemas_tenant_user_app_updated",
            "tenant_id",
            "user_id",
            "app_id",
            text("updated_at DESC"),
        ),
        Index(
            "idx_schemas_tenant_app_visibility_updated",
            "tenant_id",
            "app_id",
            "visibility",
            text("updated_at DESC"),
        ),
        Index(
            "idx_schemas_branch_latest",
            "tenant_id",
            "app_id",
            "prompt_type",
            "branch_key",
            "version",
        ),
        {"schema": "platform"},
    )
