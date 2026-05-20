"""ORM models for orchestration.* schema (workflow builder engine).

10 models in dependency order. All use schema='orchestration' and reference
platform.* via schema-qualified ForeignKey strings. Mirrors the design spec:
docs/plans/orchestration/design-spec.md §3.

Tall-fact discipline (Roadmap 01 §4.5): action_type on
workflow_run_recipient_actions is the discriminator; payload + response are
JSONB. Adding new action types adds rows, never columns.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, synonym

from app.models.base import Base
from app.models.mixins.shareable import ShareableMixin


# ─── Catalog tier ────────────────────────────────────────────────────────────


class Workflow(ShareableMixin, Base):
    asset_family = "workflow"
    __tablename__ = "workflows"
    __table_args__ = (
        UniqueConstraint("tenant_id", "app_id", "slug", name="uq_workflows_tenant_app_slug"),
        Index("idx_workflows_tenant_app", "tenant_id", "app_id"),
        Index("idx_workflows_tenant_app_type", "tenant_id", "app_id", "workflow_type"),
        Index(
            "idx_workflows_tenant_app_visibility_active",
            "tenant_id", "app_id", "visibility", "active",
        ),
        Index(
            "idx_workflows_tenant_app_created_by_active",
            "tenant_id", "app_id", "created_by", "active",
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_type: Mapped[str] = mapped_column(String(32), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    current_published_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflow_versions.id", deferrable=True, initially="DEFERRED"),
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    # Seconds a recipient may stay 'waiting' after run completion before the sweep aborts it; NULL → sweep default.
    max_wait_after_completion_seconds: Mapped[Optional[int]] = mapped_column(Integer)
    user_id = synonym("created_by")


class WorkflowVersion(Base):
    __tablename__ = "workflow_versions"
    __table_args__ = (
        UniqueConstraint("workflow_id", "version", name="uq_workflow_versions_workflow_version"),
        CheckConstraint(
            "status IN ('draft', 'published', 'archived')",
            name="ck_workflow_versions_status",
        ),
        Index(
            "idx_workflow_versions_tenant_app_status",
            "tenant_id",
            "app_id",
            "status",
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflows.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    published_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id")
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkflowTrigger(Base):
    __tablename__ = "workflow_triggers"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('cron', 'event', 'manual')", name="ck_workflow_triggers_kind"
        ),
        CheckConstraint(
            "(kind = 'cron' AND cron_expression IS NOT NULL) "
            "OR (kind = 'event' AND event_name IS NOT NULL) "
            "OR (kind = 'manual')",
            name="ck_workflow_triggers_kind_payload",
        ),
        Index(
            "idx_workflow_triggers_tenant_app_kind_active",
            "tenant_id",
            "app_id",
            "kind",
            "active",
        ),
        Index("idx_workflow_triggers_workflow_active", "workflow_id", "active"),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflows.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    cron_expression: Mapped[Optional[str]] = mapped_column(String(64))
    scheduled_job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.scheduled_job_definitions.id", ondelete="SET NULL"),
    )
    event_name: Mapped[Optional[str]] = mapped_column(String(64))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WorkflowActionTemplate(Base):
    __tablename__ = "workflow_action_templates"
    # SQL-side enforcement lives in migration 0019 as a UNIQUE INDEX over
    # COALESCE(tenant_id, ZERO_UUID) and COALESCE(app_id, '') — that's the
    # only way to deduplicate "system default" rows where tenant_id and
    # app_id are NULL. The Index() declaration here mirrors the DDL so
    # ``Base.metadata`` reflects the constraint, but the COALESCE-driven
    # uniqueness is owned by the migration, not by SQLAlchemy.
    __table_args__ = (
        Index(
            "uq_workflow_action_templates_scope_channel_slug_orm",
            "tenant_id", "app_id", "channel", "slug",
            unique=False,  # real uniqueness is the COALESCE-based DB index
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE")
    )
    app_id: Mapped[Optional[str]] = mapped_column(String(64))
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    payload_schema: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WorkflowConsentRecord(Base):
    __tablename__ = "workflow_consent_records"
    __table_args__ = (
        CheckConstraint(
            "status IN ('opted_in', 'opted_out', 'unknown')",
            name="ck_workflow_consent_records_status",
        ),
        Index(
            "idx_workflow_consent_records_lookup",
            "tenant_id",
            "app_id",
            "recipient_id",
            "channel",
            "created_at",
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    recipient_id: Mapped[str] = mapped_column(String(128), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    evidence: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── Run tier ────────────────────────────────────────────────────────────────


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    __table_args__ = (
        CheckConstraint(
            "triggered_by IN ('cron', 'event', 'manual')",
            name="ck_workflow_runs_triggered_by",
        ),
        CheckConstraint(
            "status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled')",
            name="ck_workflow_runs_status",
        ),
        Index(
            "idx_workflow_runs_tenant_app_workflow_started",
            "tenant_id",
            "app_id",
            "workflow_id",
            "started_at",
        ),
        Index(
            "idx_workflow_runs_tenant_app_status_started",
            "tenant_id",
            "app_id",
            "status",
            "started_at",
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflows.id"), nullable=False
    )
    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflow_versions.id"), nullable=False
    )
    trigger_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflow_triggers.id", ondelete="SET NULL"),
    )
    triggered_by: Mapped[str] = mapped_column(String(16), nullable=False)
    triggered_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id")
    )
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.background_jobs.id", ondelete="SET NULL"),
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    cohort_size_at_entry: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error: Mapped[Optional[str]] = mapped_column(Text)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    cancel_requested_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    cancel_requested_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    cancel_finalized_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class WorkflowRunCancelAudit(Base):
    """One row per CancelDispatchResult written by the finalize-run-cancel job."""

    __tablename__ = "workflow_run_cancel_audits"
    __table_args__ = (
        CheckConstraint(
            "outcome IN ('stopped','cancelled','noop_unsupported',"
            "'noop_already_delivered','noop_already_terminal','provider_error')",
            name="ck_cancel_audit_outcome",
        ),
        Index("ix_cancel_audit_run", "run_id"),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    provider_connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    action_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    batch_correlation_id: Mapped[Optional[str]] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    provider_status_code: Mapped[Optional[int]] = mapped_column(Integer)
    provider_message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WorkflowRunNodeStep(Base):
    __tablename__ = "workflow_run_node_steps"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', 'skipped')",
            name="ck_workflow_run_node_steps_status",
        ),
        Index(
            "idx_workflow_run_node_steps_tenant_app_run_started",
            "tenant_id",
            "app_id",
            "run_id",
            "started_at",
        ),
        Index("idx_workflow_run_node_steps_run_node", "run_id", "node_id"),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflows.id"), nullable=False
    )
    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflow_versions.id"), nullable=False
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    node_type: Mapped[str] = mapped_column(String(64), nullable=False)
    parent_node_step_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflow_run_node_steps.id")
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    inputs_summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    outputs_summary: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB)
    error: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class WorkflowRunRecipientState(Base):
    __tablename__ = "workflow_run_recipient_states"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "recipient_id", name="uq_workflow_run_recipient_states_run_recipient"
        ),
        CheckConstraint(
            "status IN ('pending', 'running', 'waiting', 'ready', 'completed', 'skipped', "
            "'failed', 'overridden', 'aborted', 'aborted_expired', 'skipped_capped', "
            "'skipped_invalid_phone')",
            name="ck_workflow_run_recipient_states_status",
        ),
        CheckConstraint(
            "status <> 'waiting' OR wakeup_at IS NOT NULL",
            name="ck_workflow_run_recipient_states_waiting_has_wakeup",
        ),
        Index(
            "idx_workflow_run_recipient_states_recipient",
            "tenant_id",
            "app_id",
            "recipient_id",
            "enrolled_at",
        ),
        Index("idx_workflow_run_recipient_states_run_status", "run_id", "status"),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflows.id"), nullable=False
    )
    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflow_versions.id"), nullable=False
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_id: Mapped[str] = mapped_column(String(128), nullable=False)
    current_node_id: Mapped[Optional[str]] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    wakeup_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error: Mapped[Optional[str]] = mapped_column(Text)
    ignore_webhooks_after: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class WorkflowRunRecipient(Base):
    """Frozen-at-T0 manifest of recipients enrolled in a workflow run.

    Immutable companion to ``WorkflowRunRecipientState``. The state row
    mutates through the run; this row records the canonical
    ``(run_id, recipient_id, phone_e164)`` set captured at T0, so dispatch
    nodes can hard-reject any recipient that mutated into the cohort source
    after the run started.
    """

    __tablename__ = "workflow_run_recipients"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "recipient_id", name="uq_workflow_run_recipients_run_recipient"
        ),
        Index(
            "idx_workflow_run_recipients_tenant_app_phone",
            "tenant_id",
            "app_id",
            "phone_e164",
        ),
        Index("idx_workflow_run_recipients_run", "run_id"),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    recipient_id: Mapped[str] = mapped_column(String(128), nullable=False)
    phone_e164: Mapped[str] = mapped_column(String(32), nullable=False)
    source_cohort_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    predicate_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    frozen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WorkflowRunRecipientAction(Base):
    __tablename__ = "workflow_run_recipient_actions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "recipient_id",
            "idempotency_key",
            name="uq_workflow_run_recipient_actions_idempotency",
        ),
        CheckConstraint(
            "status IN ('pending', 'success', 'failed')",
            name="ck_workflow_run_recipient_actions_status",
        ),
        Index(
            "idx_workflow_run_recipient_actions_run_created",
            "tenant_id",
            "app_id",
            "run_id",
            "created_at",
        ),
        Index(
            "idx_workflow_run_recipient_actions_recipient_created",
            "tenant_id",
            "app_id",
            "recipient_id",
            "created_at",
        ),
        # Partial index mirrors migration 0027. Restricts to non-null
        # values so logic / sink / source nodes (which never set a
        # provider correlation id) don't bloat the index.
        Index(
            "idx_orch_actions_provider_correlation_id",
            "provider_correlation_id",
            postgresql_where=text("provider_correlation_id IS NOT NULL"),
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflows.id"), nullable=False
    )
    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflow_versions.id"), nullable=False
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    node_step_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflow_run_node_steps.id"), nullable=False
    )
    recipient_id: Mapped[str] = mapped_column(String(128), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    action_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    response: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB)
    error: Mapped[Optional[str]] = mapped_column(Text)
    parent_action_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflow_run_recipient_actions.id")
    )
    # Phase 13 / E.2 — provider correlation ids and status hints. Populated
    # by the dispatch nodes when the row is created and by the reconciler
    # when a terminal event arrives. Indexed via a partial index restricted
    # to open rows so the 30s poller's scan stays cheap.
    bolna_execution_id: Mapped[Optional[str]] = mapped_column(String(128))
    bolna_batch_id: Mapped[Optional[str]] = mapped_column(String(128))
    # Channel-agnostic upstream id stamped at dispatch time (migration 0027).
    # Bolna single → execution_id, Bolna batch → batch_id, WATI → localMessageId,
    # SMS / generic → provider-returned id. Lets cross-channel reporting
    # queries read one column instead of COALESCE'ing over JSONB.
    provider_correlation_id: Mapped[Optional[str]] = mapped_column(String(128))
    provider_status: Mapped[Optional[str]] = mapped_column(String(64))
    provider_terminal: Mapped[bool] = mapped_column(default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Generated column (migration 0066): payload->>'contact'. Read-only on the
    # ORM side; the cap resolver indexes off it for O(log n) recent-action
    # counting per phone.
    contact_phone_e164: Mapped[Optional[str]] = mapped_column(
        Text, Computed("payload ->> 'contact'", persisted=True)
    )


class WorkflowRunRecipientOverride(Base):
    __tablename__ = "workflow_run_recipient_overrides"
    __table_args__ = (
        CheckConstraint(
            "action IN ('pause', 'resume', 'jump_to_node', 'remove', 'complete')",
            name="ck_workflow_run_recipient_overrides_action",
        ),
        CheckConstraint(
            "action <> 'jump_to_node' OR target_node_id IS NOT NULL",
            name="ck_workflow_run_recipient_overrides_jump_target",
        ),
        Index(
            "idx_workflow_run_recipient_overrides_lookup",
            "tenant_id",
            "app_id",
            "run_id",
            "recipient_id",
            "applied_at",
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflows.id"), nullable=False
    )
    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orchestration.workflow_versions.id"), nullable=False
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_id: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    target_node_id: Mapped[Optional[str]] = mapped_column(String(64))
    reason: Mapped[Optional[str]] = mapped_column(Text)
    applied_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id"), nullable=False
    )
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


# ─── Cohort dataset tier (Phase 12) ──────────────────────────────────────────


class CohortDataset(ShareableMixin, Base):
    asset_family = "dataset"
    __tablename__ = "cohort_datasets"
    __table_args__ = (
        UniqueConstraint("tenant_id", "app_id", "name", name="uq_cohort_datasets_scope_name"),
        Index("idx_cohort_datasets_tenant_app", "tenant_id", "app_id"),
        Index(
            "idx_cohort_datasets_tenant_app_visibility",
            "tenant_id", "app_id", "visibility",
        ),
        Index(
            "idx_cohort_datasets_tenant_app_created_by",
            "tenant_id", "app_id", "created_by",
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    user_id = synonym("created_by")


class CohortDatasetVersion(Base):
    __tablename__ = "cohort_dataset_versions"
    __table_args__ = (
        UniqueConstraint("dataset_id", "version_number", name="uq_dataset_version_number"),
        CheckConstraint(
            "id_strategy IN ('column','uuid')", name="ck_dataset_id_strategy"
        ),
        CheckConstraint(
            "source_type IN ('csv','xlsx','gsheet','api')",
            name="ck_dataset_source_type",
        ),
        CheckConstraint(
            "id_strategy <> 'column' OR id_column IS NOT NULL",
            name="ck_dataset_id_column_when_column",
        ),
        Index(
            "idx_dataset_versions_tenant_dataset",
            "dataset_id",
            text("version_number DESC"),
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.cohort_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="csv")
    source_filename: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    source_byte_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    id_strategy: Mapped[str] = mapped_column(String(16), nullable=False)
    id_column: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    schema_descriptor: Mapped[dict] = mapped_column(JSONB, nullable=False)
    imported_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class CohortDatasetRow(Base):
    __tablename__ = "cohort_dataset_rows"
    __table_args__ = (
        Index(
            "idx_dataset_rows_version_recipient",
            "dataset_version_id",
            "recipient_id",
        ),
        Index(
            "idx_dataset_rows_payload_gin",
            "payload",
            postgresql_using="gin",
            postgresql_ops={"payload": "jsonb_path_ops"},
        ),
        {"schema": "orchestration"},
    )

    dataset_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.cohort_dataset_versions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    row_seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    recipient_id: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


# ─── Cohort definition tier (saved cohorts) ──────────────────────────────────


class CohortDefinition(ShareableMixin, Base):
    asset_family = "cohort"
    __tablename__ = "cohort_definitions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "app_id", "slug", name="uq_cohort_definitions_scope_slug"
        ),
        Index(
            "idx_cohort_definitions_tenant_app_active",
            "tenant_id", "app_id", "active",
        ),
        Index(
            "idx_cohort_definitions_tenant_app_visibility",
            "tenant_id", "app_id", "visibility",
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    current_published_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "orchestration.cohort_definition_versions.id",
            deferrable=True,
            initially="DEFERRED",
        ),
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    user_id = synonym("created_by")


class CohortDefinitionVersion(Base):
    __tablename__ = "cohort_definition_versions"
    __table_args__ = (
        UniqueConstraint(
            "cohort_definition_id", "version",
            name="uq_cohort_definition_versions_def_version",
        ),
        CheckConstraint(
            "status IN ('draft', 'published', 'archived')",
            name="ck_cohort_definition_versions_status",
        ),
        CheckConstraint(
            "source_ref NOT LIKE 'dataset.%'",
            name="ck_cohort_definition_versions_source_ref_not_dataset",
        ),
        Index(
            "idx_cohort_definition_versions_def_version_desc",
            "cohort_definition_id",
            text("version DESC"),
        ),
        Index(
            "idx_cohort_definition_versions_tenant_app_status",
            "tenant_id", "app_id", "status",
        ),
        {"schema": "orchestration"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[str] = mapped_column(String(64), nullable=False)
    cohort_definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestration.cohort_definitions.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    source_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    filters: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    payload_fields: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    lookback_hours: Mapped[Optional[int]] = mapped_column(Integer)
    lookback_column: Mapped[Optional[str]] = mapped_column(String(128))
    consent_gate_channel: Mapped[Optional[str]] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    published_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id")
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


__all__ = [
    "Workflow",
    "WorkflowVersion",
    "WorkflowTrigger",
    "WorkflowActionTemplate",
    "WorkflowConsentRecord",
    "WorkflowRun",
    "WorkflowRunNodeStep",
    "WorkflowRunRecipientState",
    "WorkflowRunRecipient",
    "WorkflowRunRecipientAction",
    "WorkflowRunRecipientOverride",
    "CohortDataset",
    "CohortDatasetVersion",
    "CohortDatasetRow",
    "CohortDefinition",
    "CohortDefinitionVersion",
]
