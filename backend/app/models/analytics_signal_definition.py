"""Signal derivation framework — tenant-editable signal definitions.

Phase 11A of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

A ``SignalDefinition`` is a row of tenant business config: it says which
``strategy`` plugin derives a ``signal_set``, which normalized surface it
reads, and the strategy-specific body (rules / vocabulary / extraction
config). The scheduled ``derive-signals`` Transform pass loads enabled
``scheduled_scan`` rows and dispatches them to their strategy plugin,
which produces ``analytics.fact_lead_signal`` rows. Trigger-specific
definitions remain enabled for their own callers without being swept up
by the scheduled worker.

Definitions are DB rows — NOT repo YAML — because signal logic is tenant
business config that must change without a deploy (invariant 21). The
``mql`` definition ships as a seeded row, not Python code.

``fact_lead_signal.attribute_schemas`` in the Sherlock manifest are
projected from this table at manifest-load time; an admin edit invalidates
the affected app's manifest cache.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# Strategy plugin keys. Generic — never app-named. The registry in
# ``app.services.analytics.signal_derivation`` holds one plugin per key.
SIGNAL_STRATEGIES = ("rule", "llm_profile", "llm_transcript")
SIGNAL_EXECUTION_MODES = (
    "scheduled_scan",
    "eval_run_projection",
    "operator_backfill",
)


class SignalDefinition(Base):
    """One row per ``(tenant_id, app_id, signal_set)``.

    ``definition`` is the strategy-specific body. For ``strategy='rule'``
    it carries the per-``signal_type`` field bindings + predicates and the
    ``attribute_schemas`` block the manifest projects. The exact JSONB
    shape is owned by the strategy plugin, not this model.
    """

    __tablename__ = "signal_definition"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # The signal grouping/namespace, e.g. ``mql``. Free-form; one row per set.
    signal_set: Mapped[str] = mapped_column(String(64), nullable=False)
    # One of SIGNAL_STRATEGIES. Picks the plugin in the registry.
    strategy: Mapped[str] = mapped_column(String(32), nullable=False)
    # The normalized surface the strategy reads, e.g. ``dim_lead``. Never a
    # mirror, never ``raw_payload`` (invariant 21).
    source_surface: Mapped[str] = mapped_column(String(128), nullable=False)
    # When/how this definition may run. ``enabled`` means active; this field
    # prevents the scheduled scanner from dispatching trigger-specific plugins.
    execution_mode: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="scheduled_scan",
        server_default="scheduled_scan",
    )
    # Strategy-specific config body. Owned + validated by the strategy plugin.
    definition: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=lambda: datetime.now(),
    )

    __table_args__ = (
        CheckConstraint(
            "execution_mode IN ("
            "'scheduled_scan', "
            "'eval_run_projection', "
            "'operator_backfill'"
            ")",
            name="ck_signal_definition_execution_mode",
        ),
        UniqueConstraint(
            "tenant_id",
            "app_id",
            "signal_set",
            name="uq_signal_definition_tenant_app_set",
        ),
        {"schema": "analytics"},
    )
