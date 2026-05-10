"""DB-backed verified question→SQL pairs for Sherlock data_specialist (Phase 2A)."""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SherlockVerifiedQuery(Base):
    __tablename__ = 'sherlock_verified_queries'

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text('gen_random_uuid()'),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.tenants.id', ondelete='CASCADE'),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_question: Mapped[str] = mapped_column(Text, nullable=False)
    sql: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'seed'"),
    )
    verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    verified_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.users.id', ondelete='SET NULL'),
        nullable=True,
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    use_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text('0'),
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text('true'),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        CheckConstraint(
            "source IN ('seed','admin','user_thumbs_up')",
            name='sherlock_verified_queries_source_check',
        ),
        Index(
            'idx_sherlock_verified_queries_app_enabled',
            'app_id', 'enabled',
        ),
        Index(
            'idx_sherlock_verified_queries_tenant_app_enabled',
            'tenant_id', 'app_id', 'enabled',
        ),
        UniqueConstraint(
            'tenant_id', 'app_id', 'normalized_question',
            name='uq_sherlock_verified_queries_tenant_app_question',
        ),
        {'schema': 'platform'},
    )
