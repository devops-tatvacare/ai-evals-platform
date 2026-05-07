"""add orchestration visibility metadata

Revision ID: 0030_orchestration_visibility
Revises: 0029_soft_archive_workflows
Create Date: 2026-05-06

Normalize orchestration ownership onto the shareable-asset model by adding
visibility/shared metadata to workflows, provider connections, and cohort
datasets. Existing tenant-local rows were historically readable to the full
tenant app audience, so they backfill to shared. System provider connections
remain private; system workflows backfill to shared so they stay cloneable.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0030_orchestration_visibility"
down_revision: Union[str, None] = "0029_soft_archive_workflows"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_VISIBILITY_ENUM = sa.Enum(
    "PRIVATE",
    "SHARED",
    name="asset_visibility",
    native_enum=False,
)
_SYSTEM_TENANT_ID = "00000000-0000-0000-0000-000000000001"


def _add_shareable_columns(table_name: str) -> None:
    op.add_column(
        table_name,
        sa.Column(
            "visibility",
            _VISIBILITY_ENUM,
            nullable=False,
            server_default=sa.text("'PRIVATE'"),
        ),
        schema="orchestration",
    )
    op.add_column(
        table_name,
        sa.Column(
            "shared_by",
            sa.UUID(),
            sa.ForeignKey("platform.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema="orchestration",
    )
    op.add_column(
        table_name,
        sa.Column("shared_at", sa.DateTime(timezone=True), nullable=True),
        schema="orchestration",
    )


def _drop_shareable_columns(table_name: str) -> None:
    op.drop_column(table_name, "shared_at", schema="orchestration")
    op.drop_column(table_name, "shared_by", schema="orchestration")
    op.drop_column(table_name, "visibility", schema="orchestration")


def upgrade() -> None:
    _add_shareable_columns("workflows")
    _add_shareable_columns("provider_connections")
    _add_shareable_columns("cohort_datasets")

    op.execute(
        """
        UPDATE orchestration.workflows
        SET visibility = 'SHARED',
            shared_by = created_by,
            shared_at = COALESCE(updated_at, created_at, NOW())
        """
    )
    op.execute(
        f"""
        UPDATE orchestration.provider_connections
        SET visibility = 'SHARED',
            shared_by = created_by,
            shared_at = COALESCE(updated_at, created_at, NOW())
        WHERE tenant_id <> '{_SYSTEM_TENANT_ID}'::uuid
        """
    )
    op.execute(
        """
        UPDATE orchestration.cohort_datasets
        SET visibility = 'SHARED',
            shared_by = created_by,
            shared_at = COALESCE(updated_at, created_at, NOW())
        """
    )

    op.create_index(
        "idx_workflows_tenant_app_visibility_active",
        "workflows",
        ["tenant_id", "app_id", "visibility", "active"],
        unique=False,
        schema="orchestration",
    )
    op.create_index(
        "idx_workflows_tenant_app_created_by_active",
        "workflows",
        ["tenant_id", "app_id", "created_by", "active"],
        unique=False,
        schema="orchestration",
    )
    op.create_index(
        "idx_provider_connections_tenant_app_visibility_active",
        "provider_connections",
        ["tenant_id", "app_id", "visibility", "active"],
        unique=False,
        schema="orchestration",
    )
    op.create_index(
        "idx_provider_connections_tenant_app_created_by_active",
        "provider_connections",
        ["tenant_id", "app_id", "created_by", "active"],
        unique=False,
        schema="orchestration",
    )
    op.create_index(
        "idx_cohort_datasets_tenant_app_visibility",
        "cohort_datasets",
        ["tenant_id", "app_id", "visibility"],
        unique=False,
        schema="orchestration",
    )
    op.create_index(
        "idx_cohort_datasets_tenant_app_created_by",
        "cohort_datasets",
        ["tenant_id", "app_id", "created_by"],
        unique=False,
        schema="orchestration",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_cohort_datasets_tenant_app_created_by",
        table_name="cohort_datasets",
        schema="orchestration",
    )
    op.drop_index(
        "idx_cohort_datasets_tenant_app_visibility",
        table_name="cohort_datasets",
        schema="orchestration",
    )
    op.drop_index(
        "idx_provider_connections_tenant_app_created_by_active",
        table_name="provider_connections",
        schema="orchestration",
    )
    op.drop_index(
        "idx_provider_connections_tenant_app_visibility_active",
        table_name="provider_connections",
        schema="orchestration",
    )
    op.drop_index(
        "idx_workflows_tenant_app_created_by_active",
        table_name="workflows",
        schema="orchestration",
    )
    op.drop_index(
        "idx_workflows_tenant_app_visibility_active",
        table_name="workflows",
        schema="orchestration",
    )

    _drop_shareable_columns("cohort_datasets")
    _drop_shareable_columns("provider_connections")
    _drop_shareable_columns("workflows")
