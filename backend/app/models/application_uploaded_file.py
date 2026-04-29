"""ApplicationUploadedFile model - file metadata (actual bytes on filesystem/blob storage)."""
import uuid
from sqlalchemy import String, BigInteger, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, TenantUserMixin


class ApplicationUploadedFile(Base, TimestampMixin, TenantUserMixin):
    __tablename__ = "application_uploaded_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    original_name: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    storage_path: Mapped[str] = mapped_column(String(1000), nullable=False)

    __table_args__ = (
        Index("idx_application_uploaded_files_tenant", "tenant_id"),
        Index("idx_application_uploaded_files_tenant_user", "tenant_id", "user_id"),
        {"schema": "platform"},
    )
