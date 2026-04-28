"""Phase 1 / M1 — Platform-owned ontology persistence.

Three platform tables that hold the cross-pack interpretation metadata
named in `docs/plans/2026-04-23-sherlock-scoped-bundle-rewrite.md` §4.1:

- ``sherlock_ontology_classes`` — the 7-class backbone
  (scope / subject / interaction / evaluation / artifact / operation / extension).
- ``sherlock_entity_types`` — typed entities attached to an ontology class
  (e.g. ``run_id`` on ``evaluation.run``), carrying the ``safety`` flag
  (``safe_first_pass`` / ``explicit_only`` / ``unsafe``).
- ``sherlock_resolvers`` — declarative resolver rows referenced by the
  assembly layer; semantics match the pack-owned manifest resolvers today.

Rows are platform-authoritative: ``tenant_id`` is nullable and used only
for future per-tenant overlays. Phase 1 seeds only platform baseline rows
(``tenant_id IS NULL``) and the assembly layer reads both buckets.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column


# Portable JSON type: JSONB on Postgres (production), generic JSON elsewhere
# (in-memory SQLite tests). Production DDL is unchanged.
_JsonType = JSON().with_variant(JSONB(), 'postgresql')

from app.models.base import Base


class SherlockOntologyClass(Base):
    """One row per platform ontology class.

    The 7-class backbone is fixed at the platform layer: Scope, Subject,
    Interaction, Evaluation, Artifact, Operation, Extension. ``parent_id``
    supports the ``Evaluation.Run`` / ``Artifact.Chart`` sub-class shape
    used by pack projections.
    """

    __tablename__ = 'sherlock_ontology_classes'
    __table_args__ = {"schema": "platform"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Stable dotted name, e.g. ``evaluation`` or ``evaluation.run``. Used as
    # the public identifier everywhere in the assembly layer so the DB uuid
    # stays internal.
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.sherlock_ontology_classes.id', ondelete='SET NULL'),
        nullable=True,
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Bumped whenever platform baseline seeding changes so BundleBuilder
    # can invalidate its per-request cache.
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1'))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class SherlockEntityType(Base):
    """One row per typed entity recognized by the platform.

    ``ontology_class_id`` binds the entity type to one platform class.
    ``safety`` is the enum that gates first-pass classifier visibility:

    - ``safe_first_pass`` — model may pick this up from the message without
      calling a resolver (e.g. ``status``, ``eval_type``).
    - ``explicit_only`` — the model MUST NOT filter on this until a
      resolver tool confirms the exact value (e.g. ``run_name``).
    - ``unsafe`` — do not expose to the classifier at all (e.g. an app
      alias that should stay in scope metadata).

    ``tenant_id`` is nullable: NULL = platform baseline, UUID = tenant
    overlay (future).
    """

    __tablename__ = 'sherlock_entity_types'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # Scope gate: NULL app_id = applies to every app; specific slug = only
    # for that app. Phase 1 seeds only NULL-app rows (platform baseline).
    app_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    ontology_class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('platform.sherlock_ontology_classes.id', ondelete='CASCADE'),
        nullable=False,
    )
    # role = how this entity participates in interpretation. Mirrors the
    # manifest ``role`` vocabulary but stored here so the platform can
    # reason about it without re-reading YAML.
    role: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Enum-ish; enforced by seeding + app-level code, not a DB CHECK so
    # future values don't require a migration.
    safety: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'safe_first_pass'"))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    examples: Mapped[list] = mapped_column(
        _JsonType, nullable=False, default=list,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('true'))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            'tenant_id', 'app_id', 'name',
            name='uq_sherlock_entity_type_scope',
        ),
        Index('idx_sherlock_entity_type_app_safety', 'app_id', 'safety'),
        Index('idx_sherlock_entity_type_tenant_app', 'tenant_id', 'app_id'),
        {"schema": "platform"},
    )


class SherlockResolver(Base):
    """Declarative resolver row referenced by pack projections.

    The platform owns the **identity** of a resolver (``key``, target
    ``entity_type``, declared ``safety`` expectation). Pack-local tools
    (analytics ``resolve_entity``, future vector ``vector_search``, etc.)
    own the execution. The assembly layer hands this row to a pack via
    scope metadata so the pack doesn't need to re-discover it.
    """

    __tablename__ = 'sherlock_resolvers'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    app_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    key: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    # Free-form bag: ``field``, ``dimension``, ``match``, ``limit``, etc.
    # Packs interpret their own keys; the platform doesn't touch it.
    config: Mapped[dict] = mapped_column(
        _JsonType, nullable=False, default=dict,
    )
    # Expected classifier visibility for values this resolver yields.
    safety: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'safe_first_pass'"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('true'))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            'tenant_id', 'app_id', 'key',
            name='uq_sherlock_resolver_scope',
        ),
        Index('idx_sherlock_resolver_app_entity', 'app_id', 'entity_type'),
        {"schema": "platform"},
    )
