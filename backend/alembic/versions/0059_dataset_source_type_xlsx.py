"""extend cohort_dataset_versions.source_type check constraint to include 'xlsx'

Revision ID: 0059
Revises: 0058
Create Date: 2026-05-19

The format_registry now declares 'xlsx' alongside 'csv' (and forward-declared
'gsheet'/'api'). The CHECK at the DB stays as a defensive value-domain
boundary; widening it here keeps the app registry and the DB in sync.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = '0059'
down_revision: Union[str, None] = '0058'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE orchestration.cohort_dataset_versions "
        "DROP CONSTRAINT IF EXISTS ck_dataset_source_type"
    )
    op.execute(
        "ALTER TABLE orchestration.cohort_dataset_versions "
        "ADD CONSTRAINT ck_dataset_source_type "
        "CHECK (source_type IN ('csv','xlsx','gsheet','api'))"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE orchestration.cohort_dataset_versions "
        "DROP CONSTRAINT IF EXISTS ck_dataset_source_type"
    )
    op.execute(
        "ALTER TABLE orchestration.cohort_dataset_versions "
        "ADD CONSTRAINT ck_dataset_source_type "
        "CHECK (source_type IN ('csv','gsheet','api'))"
    )
