"""create orchestration schema and 10 workflow tables

Creates the orchestration.* schema and all 10 tables backing the workflow
builder per docs/plans/orchestration/design-spec.md §3. Cross-schema FKs to
platform.* (tenants, users, applications, background_jobs,
scheduled_job_definitions) — all required to exist before this revision runs.

All raw SQL is schema-qualified per the post-roadmap-01 invariant — the
db default search_path is "$user", public, so bare names would resolve
against public.<name> and fail with UndefinedTableError.

Revision ID: 0019_create_orchestration_schema
Revises: 0018_create_inside_sales_analytics_facts
Create Date: 2026-04-30
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0019_create_orchestration_schema"
down_revision: Union[str, None] = "0018_create_inside_sales_analytics_facts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create the schema.
    op.execute("CREATE SCHEMA IF NOT EXISTS orchestration")

    # 2. Catalog tier — workflows (lineage anchor).
    # current_published_version_id FK is added later in this same revision once
    # workflow_versions exists (DEFERRABLE FK avoids dependency-order issues).
    op.execute(
        """
        CREATE TABLE orchestration.workflows (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            workflow_type VARCHAR(32) NOT NULL,
            slug VARCHAR(128) NOT NULL,
            name VARCHAR(200) NOT NULL,
            description TEXT,
            current_published_version_id UUID,  -- FK added after workflow_versions
            created_by UUID NOT NULL REFERENCES platform.users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_workflows_tenant_app_slug UNIQUE (tenant_id, app_id, slug)
        )
        """
    )
    op.execute("CREATE INDEX idx_workflows_tenant_app ON orchestration.workflows (tenant_id, app_id)")
    op.execute(
        "CREATE INDEX idx_workflows_tenant_app_type "
        "ON orchestration.workflows (tenant_id, app_id, workflow_type)"
    )

    # 3. Catalog tier — workflow_versions (immutable canvas snapshots).
    op.execute(
        """
        CREATE TABLE orchestration.workflow_versions (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            workflow_id UUID NOT NULL REFERENCES orchestration.workflows(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            definition JSONB NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'draft',
            published_by UUID REFERENCES platform.users(id),
            published_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_workflow_versions_workflow_version UNIQUE (workflow_id, version),
            CONSTRAINT ck_workflow_versions_status CHECK (status IN ('draft', 'published', 'archived'))
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_workflow_versions_tenant_app_status "
        "ON orchestration.workflow_versions (tenant_id, app_id, status)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_versions_workflow_version_desc "
        "ON orchestration.workflow_versions (workflow_id, version DESC)"
    )

    # Now wire the deferred FK from workflows.current_published_version_id.
    op.execute(
        "ALTER TABLE orchestration.workflows "
        "ADD CONSTRAINT fk_workflows_current_published_version "
        "FOREIGN KEY (current_published_version_id) "
        "REFERENCES orchestration.workflow_versions(id) "
        "DEFERRABLE INITIALLY DEFERRED"
    )

    # 4. Catalog tier — workflow_triggers.
    op.execute(
        """
        CREATE TABLE orchestration.workflow_triggers (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            workflow_id UUID NOT NULL REFERENCES orchestration.workflows(id) ON DELETE CASCADE,
            kind VARCHAR(16) NOT NULL,
            cron_expression VARCHAR(64),
            scheduled_job_id UUID REFERENCES platform.scheduled_job_definitions(id) ON DELETE SET NULL,
            event_name VARCHAR(64),
            params JSONB NOT NULL DEFAULT '{}'::jsonb,
            active BOOLEAN NOT NULL DEFAULT true,
            created_by UUID NOT NULL REFERENCES platform.users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_workflow_triggers_kind CHECK (kind IN ('cron', 'event', 'manual')),
            CONSTRAINT ck_workflow_triggers_kind_payload CHECK (
                (kind = 'cron' AND cron_expression IS NOT NULL)
                OR (kind = 'event' AND event_name IS NOT NULL)
                OR (kind = 'manual')
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_workflow_triggers_tenant_app_kind_active "
        "ON orchestration.workflow_triggers (tenant_id, app_id, kind, active)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_triggers_workflow_active "
        "ON orchestration.workflow_triggers (workflow_id, active)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_triggers_event_active "
        "ON orchestration.workflow_triggers (event_name, active) WHERE kind = 'event'"
    )

    # 5. Catalog tier — workflow_action_templates.
    op.execute(
        """
        CREATE TABLE orchestration.workflow_action_templates (
            id UUID PRIMARY KEY,
            tenant_id UUID REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64),
            channel VARCHAR(16) NOT NULL,
            slug VARCHAR(128) NOT NULL,
            name VARCHAR(200) NOT NULL,
            payload_schema JSONB NOT NULL,
            active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_workflow_action_templates_scope_channel_slug "
        "ON orchestration.workflow_action_templates ("
        "  COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), "
        "  COALESCE(app_id, ''), channel, slug"
        ")"
    )

    # 6. Catalog tier — workflow_consent_records.
    op.execute(
        """
        CREATE TABLE orchestration.workflow_consent_records (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            recipient_id VARCHAR(128) NOT NULL,
            channel VARCHAR(16) NOT NULL,
            status VARCHAR(16) NOT NULL,
            source VARCHAR(32) NOT NULL,
            evidence JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_workflow_consent_records_status CHECK (status IN ('opted_in', 'opted_out', 'unknown'))
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_workflow_consent_records_lookup "
        "ON orchestration.workflow_consent_records "
        "(tenant_id, app_id, recipient_id, channel, created_at DESC)"
    )

    # 7. Run tier — workflow_runs.
    op.execute(
        """
        CREATE TABLE orchestration.workflow_runs (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            workflow_id UUID NOT NULL REFERENCES orchestration.workflows(id),
            workflow_version_id UUID NOT NULL REFERENCES orchestration.workflow_versions(id),
            trigger_id UUID REFERENCES orchestration.workflow_triggers(id) ON DELETE SET NULL,
            triggered_by VARCHAR(16) NOT NULL,
            triggered_by_user_id UUID REFERENCES platform.users(id),
            job_id UUID REFERENCES platform.background_jobs(id) ON DELETE SET NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            cohort_size_at_entry INTEGER NOT NULL DEFAULT 0,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            error TEXT,
            params JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_workflow_runs_triggered_by CHECK (triggered_by IN ('cron', 'event', 'manual')),
            CONSTRAINT ck_workflow_runs_status CHECK (
                status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled')
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_workflow_runs_tenant_app_workflow_started "
        "ON orchestration.workflow_runs (tenant_id, app_id, workflow_id, started_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_runs_tenant_app_status_started "
        "ON orchestration.workflow_runs (tenant_id, app_id, status, started_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_runs_version_status "
        "ON orchestration.workflow_runs (workflow_version_id, status)"
    )

    # 8. Run tier — workflow_run_node_steps (cohort/node grain).
    op.execute(
        """
        CREATE TABLE orchestration.workflow_run_node_steps (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL,
            app_id VARCHAR(64) NOT NULL,
            workflow_id UUID NOT NULL REFERENCES orchestration.workflows(id),
            workflow_version_id UUID NOT NULL REFERENCES orchestration.workflow_versions(id),
            run_id UUID NOT NULL REFERENCES orchestration.workflow_runs(id) ON DELETE CASCADE,
            node_id VARCHAR(64) NOT NULL,
            node_type VARCHAR(64) NOT NULL,
            parent_node_step_id UUID REFERENCES orchestration.workflow_run_node_steps(id),
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            inputs_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
            outputs_summary JSONB,
            error TEXT,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            CONSTRAINT ck_workflow_run_node_steps_status CHECK (
                status IN ('pending', 'running', 'completed', 'failed', 'skipped')
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_node_steps_tenant_app_run_started "
        "ON orchestration.workflow_run_node_steps (tenant_id, app_id, run_id, started_at)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_node_steps_run_node "
        "ON orchestration.workflow_run_node_steps (run_id, node_id)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_node_steps_workflow_node_type_started "
        "ON orchestration.workflow_run_node_steps (workflow_id, node_type, started_at DESC)"
    )

    # 9. Run tier — workflow_run_recipient_states (recipient grain — current pointer).
    op.execute(
        """
        CREATE TABLE orchestration.workflow_run_recipient_states (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL,
            app_id VARCHAR(64) NOT NULL,
            workflow_id UUID NOT NULL REFERENCES orchestration.workflows(id),
            workflow_version_id UUID NOT NULL REFERENCES orchestration.workflow_versions(id),
            run_id UUID NOT NULL REFERENCES orchestration.workflow_runs(id) ON DELETE CASCADE,
            recipient_id VARCHAR(128) NOT NULL,
            current_node_id VARCHAR(64),
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            wakeup_at TIMESTAMPTZ,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            completed_at TIMESTAMPTZ,
            error TEXT,
            CONSTRAINT uq_workflow_run_recipient_states_run_recipient UNIQUE (run_id, recipient_id),
            CONSTRAINT ck_workflow_run_recipient_states_status CHECK (
                status IN ('pending', 'running', 'waiting', 'ready', 'completed', 'skipped', 'failed', 'overridden')
            ),
            CONSTRAINT ck_workflow_run_recipient_states_waiting_has_wakeup CHECK (
                status <> 'waiting' OR wakeup_at IS NOT NULL
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_orch_states_resume "
        "ON orchestration.workflow_run_recipient_states (tenant_id, wakeup_at) "
        "WHERE status IN ('waiting', 'ready')"
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_recipient_states_recipient "
        "ON orchestration.workflow_run_recipient_states (tenant_id, app_id, recipient_id, enrolled_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_recipient_states_run_status "
        "ON orchestration.workflow_run_recipient_states (run_id, status)"
    )

    # 10. Run tier — workflow_run_recipient_actions (recipient grain — outbound side-effects).
    op.execute(
        """
        CREATE TABLE orchestration.workflow_run_recipient_actions (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL,
            app_id VARCHAR(64) NOT NULL,
            workflow_id UUID NOT NULL REFERENCES orchestration.workflows(id),
            workflow_version_id UUID NOT NULL REFERENCES orchestration.workflow_versions(id),
            run_id UUID NOT NULL REFERENCES orchestration.workflow_runs(id) ON DELETE CASCADE,
            node_step_id UUID NOT NULL REFERENCES orchestration.workflow_run_node_steps(id),
            recipient_id VARCHAR(128) NOT NULL,
            channel VARCHAR(16) NOT NULL,
            action_type VARCHAR(64) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            idempotency_key VARCHAR(128) NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            response JSONB,
            error TEXT,
            parent_action_id UUID REFERENCES orchestration.workflow_run_recipient_actions(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            completed_at TIMESTAMPTZ,
            CONSTRAINT uq_workflow_run_recipient_actions_idempotency
                UNIQUE (tenant_id, recipient_id, idempotency_key),
            CONSTRAINT ck_workflow_run_recipient_actions_status CHECK (
                status IN ('pending', 'success', 'failed')
            )
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX idx_orch_actions_no_double_dispatch "
        "ON orchestration.workflow_run_recipient_actions (tenant_id, recipient_id) "
        "WHERE status = 'pending' AND action_type IN ('wa_dispatched', 'bolna_queued')"
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_recipient_actions_run_created "
        "ON orchestration.workflow_run_recipient_actions (tenant_id, app_id, run_id, created_at)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_recipient_actions_recipient_created "
        "ON orchestration.workflow_run_recipient_actions (tenant_id, app_id, recipient_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_recipient_actions_workflow_type_created "
        "ON orchestration.workflow_run_recipient_actions (workflow_id, action_type, created_at DESC)"
    )

    # 11. Run tier — workflow_run_recipient_overrides.
    op.execute(
        """
        CREATE TABLE orchestration.workflow_run_recipient_overrides (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL,
            app_id VARCHAR(64) NOT NULL,
            workflow_id UUID NOT NULL REFERENCES orchestration.workflows(id),
            workflow_version_id UUID NOT NULL REFERENCES orchestration.workflow_versions(id),
            run_id UUID NOT NULL REFERENCES orchestration.workflow_runs(id) ON DELETE CASCADE,
            recipient_id VARCHAR(128) NOT NULL,
            action VARCHAR(16) NOT NULL,
            target_node_id VARCHAR(64),
            reason TEXT,
            applied_by UUID NOT NULL REFERENCES platform.users(id),
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            consumed_at TIMESTAMPTZ,
            CONSTRAINT ck_workflow_run_recipient_overrides_action CHECK (
                action IN ('pause', 'resume', 'jump_to_node', 'remove', 'complete')
            ),
            CONSTRAINT ck_workflow_run_recipient_overrides_jump_target CHECK (
                action <> 'jump_to_node' OR target_node_id IS NOT NULL
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_recipient_overrides_lookup "
        "ON orchestration.workflow_run_recipient_overrides "
        "(tenant_id, app_id, run_id, recipient_id, applied_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_workflow_run_recipient_overrides_unconsumed "
        "ON orchestration.workflow_run_recipient_overrides (run_id, recipient_id) "
        "WHERE consumed_at IS NULL"
    )


def downgrade() -> None:
    # Drop tables in reverse dependency order.
    op.execute("DROP TABLE IF EXISTS orchestration.workflow_run_recipient_overrides")
    op.execute("DROP TABLE IF EXISTS orchestration.workflow_run_recipient_actions")
    op.execute("DROP TABLE IF EXISTS orchestration.workflow_run_recipient_states")
    op.execute("DROP TABLE IF EXISTS orchestration.workflow_run_node_steps")
    op.execute("DROP TABLE IF EXISTS orchestration.workflow_runs")
    op.execute("DROP TABLE IF EXISTS orchestration.workflow_consent_records")
    op.execute("DROP TABLE IF EXISTS orchestration.workflow_action_templates")
    op.execute("DROP TABLE IF EXISTS orchestration.workflow_triggers")
    op.execute(
        "ALTER TABLE orchestration.workflows "
        "DROP CONSTRAINT IF EXISTS fk_workflows_current_published_version"
    )
    op.execute("DROP TABLE IF EXISTS orchestration.workflow_versions")
    op.execute("DROP TABLE IF EXISTS orchestration.workflows")
    op.execute("DROP SCHEMA IF EXISTS orchestration")
