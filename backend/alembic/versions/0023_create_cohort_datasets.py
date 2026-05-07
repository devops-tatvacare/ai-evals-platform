"""create orchestration.cohort_datasets, cohort_dataset_versions, cohort_dataset_rows

Revision ID: 0023_create_cohort_datasets
Revises: 0022_create_provider_connections
Create Date: 2026-05-01
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0023_create_cohort_datasets"
down_revision: Union[str, None] = "0022_create_provider_connections"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE orchestration.cohort_datasets (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            name VARCHAR(200) NOT NULL,
            description TEXT,
            created_by UUID NOT NULL REFERENCES platform.users(id) ON DELETE RESTRICT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_cohort_datasets_scope_name UNIQUE (tenant_id, app_id, name)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_cohort_datasets_tenant_app "
        "ON orchestration.cohort_datasets (tenant_id, app_id)"
    )

    op.execute(
        """
        CREATE TABLE orchestration.cohort_dataset_versions (
            id UUID PRIMARY KEY,
            dataset_id UUID NOT NULL REFERENCES orchestration.cohort_datasets(id) ON DELETE CASCADE,
            tenant_id UUID NOT NULL,
            version_number INT NOT NULL,
            source_type VARCHAR(16) NOT NULL DEFAULT 'csv',
            source_filename VARCHAR(500),
            source_byte_size BIGINT,
            row_count INT NOT NULL,
            id_strategy VARCHAR(16) NOT NULL,
            id_column VARCHAR(200),
            schema_descriptor JSONB NOT NULL,
            imported_by UUID NOT NULL REFERENCES platform.users(id) ON DELETE RESTRICT,
            imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_dataset_version_number UNIQUE (dataset_id, version_number),
            CONSTRAINT ck_dataset_id_strategy CHECK (id_strategy IN ('column','uuid')),
            CONSTRAINT ck_dataset_source_type CHECK (source_type IN ('csv','gsheet','api')),
            CONSTRAINT ck_dataset_id_column_when_column
                CHECK (id_strategy <> 'column' OR id_column IS NOT NULL)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_dataset_versions_tenant_dataset "
        "ON orchestration.cohort_dataset_versions (dataset_id, version_number DESC)"
    )

    op.execute(
        """
        CREATE TABLE orchestration.cohort_dataset_rows (
            dataset_version_id UUID NOT NULL
                REFERENCES orchestration.cohort_dataset_versions(id) ON DELETE CASCADE,
            row_seq INT NOT NULL,
            tenant_id UUID NOT NULL,
            recipient_id TEXT NOT NULL,
            payload JSONB NOT NULL,
            PRIMARY KEY (dataset_version_id, row_seq)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_dataset_rows_version_recipient "
        "ON orchestration.cohort_dataset_rows (dataset_version_id, recipient_id)"
    )
    op.execute(
        "CREATE INDEX idx_dataset_rows_payload_gin "
        "ON orchestration.cohort_dataset_rows USING GIN (payload jsonb_path_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS orchestration.idx_dataset_rows_payload_gin")
    op.execute("DROP INDEX IF EXISTS orchestration.idx_dataset_rows_version_recipient")
    op.execute("DROP TABLE IF EXISTS orchestration.cohort_dataset_rows")
    op.execute("DROP INDEX IF EXISTS orchestration.idx_dataset_versions_tenant_dataset")
    op.execute("DROP TABLE IF EXISTS orchestration.cohort_dataset_versions")
    op.execute("DROP INDEX IF EXISTS orchestration.idx_cohort_datasets_tenant_app")
    op.execute("DROP TABLE IF EXISTS orchestration.cohort_datasets")
