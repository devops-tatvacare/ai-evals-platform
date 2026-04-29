"""AccessRole models — RBAC roles, app access grants, and action permissions."""
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, ForeignKey, DateTime, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class AccessRole(Base):
    __tablename__ = "access_roles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    app_access: Mapped[list["AccessRoleApplicationGrant"]] = relationship(
        "AccessRoleApplicationGrant", back_populates="role", cascade="all, delete-orphan"
    )
    permissions: Mapped[list["AccessRolePermission"]] = relationship(
        "AccessRolePermission", back_populates="role", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_access_role_name_per_tenant"),
        {"schema": "platform"},
    )


class AccessRoleApplicationGrant(Base):
    __tablename__ = "access_role_application_grants"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.access_roles.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.applications.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    role: Mapped["AccessRole"] = relationship("AccessRole", back_populates="app_access")
    app: Mapped["Application"] = relationship("Application")

    __table_args__ = (
        UniqueConstraint("role_id", "app_id", name="uq_access_role_application_grant"),
        {"schema": "platform"},
    )


class AccessRolePermission(Base):
    __tablename__ = "access_role_permissions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.access_roles.id", ondelete="CASCADE"), nullable=False
    )
    permission: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    role: Mapped["AccessRole"] = relationship("AccessRole", back_populates="permissions")

    __table_args__ = (
        UniqueConstraint("role_id", "permission", name="uq_access_role_permission"),
        {"schema": "platform"},
    )
