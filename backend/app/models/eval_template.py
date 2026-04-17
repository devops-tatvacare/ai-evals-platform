"""EvalTemplate model — versioned prompt+schema pairs."""

import uuid

from sqlalchemy import Boolean, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantUserMixin, TimestampMixin
from app.models.mixins.shareable import ShareableMixin, shareable_uuid_forked_from


class EvalTemplate(Base, TimestampMixin, TenantUserMixin, ShareableMixin):
    __tablename__ = "eval_templates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    template_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    branch_key: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    schema_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    schema_format: Mapped[str] = mapped_column(
        String(20), nullable=False, default="output_fields"
    )
    variables_used: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    change_summary: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    forked_from: Mapped[uuid.UUID | None] = shareable_uuid_forked_from("eval_templates")

    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "app_id",
            "template_type",
            "source_type",
            "branch_key",
            "version",
            name="uq_eval_template_branch_version",
        ),
        Index("idx_eval_templates_tenant", "tenant_id"),
        Index("idx_eval_templates_tenant_user", "tenant_id", "user_id"),
        Index("idx_eval_templates_tenant_app", "tenant_id", "app_id"),
        Index(
            "idx_eval_templates_tenant_user_app_updated",
            "tenant_id",
            "user_id",
            "app_id",
            text("updated_at DESC"),
        ),
        Index(
            "idx_eval_templates_tenant_app_visibility_updated",
            "tenant_id",
            "app_id",
            "visibility",
            text("updated_at DESC"),
        ),
        Index("idx_eval_templates_tenant_branch", "tenant_id", "branch_key"),
    )
