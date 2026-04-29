"""IdentityInviteLink model — shareable signup links created by admins."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, Boolean, Integer, ForeignKey, DateTime, Index, and_, func, or_
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.elements import ColumnElement

from app.models.base import Base


class IdentityInviteLink(Base):
    __tablename__ = "identity_invite_links"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.access_roles.id"), nullable=False
    )
    max_uses: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    uses_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("idx_identity_invite_links_token_hash", "token_hash"),
        Index("idx_identity_invite_links_tenant", "tenant_id"),
        {"schema": "platform"},
    )

    @property
    def is_usable(self) -> bool:
        """True iff the link can still be redeemed: not revoked, not expired, not exhausted."""
        if not self.is_active:
            return False
        if self.expires_at < datetime.now(timezone.utc):
            return False
        if self.max_uses is not None and self.uses_count >= self.max_uses:
            return False
        return True

    @classmethod
    def usable_filter(cls) -> ColumnElement[bool]:
        """SQL predicate matching links that are still redeemable. Mirrors `is_usable`."""
        return and_(
            cls.is_active.is_(True),
            cls.expires_at > func.now(),
            or_(cls.max_uses.is_(None), cls.uses_count < cls.max_uses),
        )
