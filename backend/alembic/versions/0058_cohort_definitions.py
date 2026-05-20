"""orchestration: cohort_definitions + cohort_definition_versions

Revision ID: 0058
Revises: 0057
Create Date: 2026-05-19

Saved cohort definitions as a first-class object alongside cohort_datasets.
Adds a GIN index on workflow_versions.definition so cohort used-by lookups
via JSONB ``@>`` are index-backed from day 1.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = '0058'
down_revision: Union[str, None] = '0057'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ShareableMixin columns are inlined here as raw SQL to match the
    # existing orchestration.workflows / orchestration.cohort_datasets
    # shape (VARCHAR(7) 'PRIVATE'/'SHARED') and the asset_visibility enum
    # convention established by 0030_orchestration_visibility.
    op.execute(
        """
        CREATE TABLE orchestration.cohort_definitions (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            slug VARCHAR(128) NOT NULL,
            name VARCHAR(200) NOT NULL,
            description TEXT,
            active BOOLEAN NOT NULL DEFAULT true,
            current_published_version_id UUID,
            created_by UUID NOT NULL REFERENCES platform.users(id) ON DELETE RESTRICT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            visibility VARCHAR(7) NOT NULL DEFAULT 'PRIVATE',
            shared_by UUID REFERENCES platform.users(id) ON DELETE SET NULL,
            shared_at TIMESTAMPTZ,
            CONSTRAINT uq_cohort_definitions_scope_slug UNIQUE (tenant_id, app_id, slug)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_cohort_definitions_tenant_app_active "
        "ON orchestration.cohort_definitions (tenant_id, app_id, active)"
    )
    op.execute(
        "CREATE INDEX idx_cohort_definitions_tenant_app_visibility "
        "ON orchestration.cohort_definitions (tenant_id, app_id, visibility)"
    )

    # D4: a saved cohort is a predicate over platform analytics tables — never
    # over an uploaded dataset. Enforced at the DB layer so a fabricated
    # source_ref can't slip past Pydantic/Zod and crash downstream nodes.
    op.execute(
        """
        CREATE TABLE orchestration.cohort_definition_versions (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            cohort_definition_id UUID NOT NULL
                REFERENCES orchestration.cohort_definitions(id) ON DELETE CASCADE,
            version INT NOT NULL,
            source_ref VARCHAR(128) NOT NULL,
            filters JSONB NOT NULL DEFAULT '[]'::jsonb,
            payload_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            lookback_hours INT,
            lookback_column VARCHAR(128),
            consent_gate_channel VARCHAR(64),
            status VARCHAR(16) NOT NULL DEFAULT 'draft',
            published_by UUID REFERENCES platform.users(id),
            published_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_cohort_definition_versions_def_version
                UNIQUE (cohort_definition_id, version),
            CONSTRAINT ck_cohort_definition_versions_status
                CHECK (status IN ('draft','published','archived')),
            CONSTRAINT ck_cohort_definition_versions_source_ref_not_dataset
                CHECK (source_ref NOT LIKE 'dataset.%')
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_cohort_definition_versions_def_version_desc "
        "ON orchestration.cohort_definition_versions (cohort_definition_id, version DESC)"
    )
    op.execute(
        "CREATE INDEX idx_cohort_definition_versions_tenant_app_status "
        "ON orchestration.cohort_definition_versions (tenant_id, app_id, status)"
    )

    # Deferred so the publish endpoint can flip status='published' on the
    # version row and current_published_version_id on the definition row
    # inside the same transaction without ordering the two UPDATEs.
    op.execute(
        """
        ALTER TABLE orchestration.cohort_definitions
        ADD CONSTRAINT fk_cohort_definitions_current_published_version
        FOREIGN KEY (current_published_version_id)
        REFERENCES orchestration.cohort_definition_versions(id)
        DEFERRABLE INITIALLY DEFERRED
        """
    )

    # Backs the cohort used-by lookup: ``WHERE wv.definition @> $jsonb``.
    op.execute(
        "CREATE INDEX idx_workflow_versions_definition_gin "
        "ON orchestration.workflow_versions USING GIN (definition)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS orchestration.idx_workflow_versions_definition_gin")
    op.execute(
        "ALTER TABLE orchestration.cohort_definitions "
        "DROP CONSTRAINT IF EXISTS fk_cohort_definitions_current_published_version"
    )
    op.execute("DROP TABLE IF EXISTS orchestration.cohort_definition_versions")
    op.execute("DROP TABLE IF EXISTS orchestration.cohort_definitions")
