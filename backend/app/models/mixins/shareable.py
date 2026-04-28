"""Shared ownership primitives for assets that can be private or shared."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class Visibility(str, enum.Enum):
    """Canonical visibility values for shareable assets."""

    PRIVATE = "private"
    SHARED = "shared"

    @classmethod
    def normalize(cls, value: "Visibility | str | None") -> "Visibility | None":
        """Validate and return a canonical visibility value."""

        if value is None:
            return None
        if isinstance(value, cls):
            return value

        normalized = str(value).strip().lower()
        if normalized == cls.PRIVATE.value:
            return cls.PRIVATE
        if normalized == cls.SHARED.value:
            return cls.SHARED
        raise ValueError(f"Unsupported visibility value: {value}")

    def is_shared(self) -> bool:
        return self == Visibility.SHARED


class ShareableMixin:
    """Common sharing metadata for shareable asset families.

    Models still declare their own ``forked_from`` column because the FK type
    differs by table.
    """

    visibility: Mapped[Visibility] = mapped_column(
        SAEnum(Visibility, name="asset_visibility", native_enum=False),
        nullable=False,
        default=Visibility.PRIVATE,
        server_default=Visibility.PRIVATE.value,
    )
    shared_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    shared_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )


def shareable_uuid_forked_from(table_name: str) -> Mapped[uuid.UUID | None]:
    """Build a nullable same-table UUID FK for shareable assets.

    Roadmap 01 §9.5: every shareable model now lives in ``platform``, so
    the same-table FK must be schema-qualified for SQLAlchemy to resolve
    against ``Base.metadata.tables['platform.<name>']``.
    """

    return mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f"platform.{table_name}.id", ondelete="SET NULL"),
        nullable=True,
    )


def shareable_int_forked_from(table_name: str) -> Mapped[int | None]:
    """Build a nullable same-table integer FK for shareable assets.

    Roadmap 01 §9.5 — see ``shareable_uuid_forked_from``.
    """

    return mapped_column(
        ForeignKey(f"platform.{table_name}.id", ondelete="SET NULL"),
        nullable=True,
    )
