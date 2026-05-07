"""normalize orchestration visibility enum casing

Revision ID: 0031_normalize_orchestration_visibility_case
Revises: 0030_orchestration_visibility
Create Date: 2026-05-07

The platform already persists ``Visibility`` enum names in uppercase
(``PRIVATE`` / ``SHARED``). Revision 0030 introduced orchestration visibility
columns using lowercase values, which made those rows inconsistent with the
rest of the codebase and broke ORM reads once the shared enum mapping followed
the long-standing platform convention again.

This migration normalizes the orchestration visibility rows created by 0030 to
uppercase so existing and new assets all use one storage convention.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0031_normalize_orchestration_visibility_case"
down_revision: Union[str, None] = "0030_orchestration_visibility"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _normalize_table(table_name: str) -> None:
    op.execute(
        f"""
        UPDATE orchestration.{table_name}
        SET visibility = CASE visibility::text
            WHEN 'private' THEN 'PRIVATE'
            WHEN 'shared' THEN 'SHARED'
            ELSE visibility::text
        END
        WHERE visibility::text IN ('private', 'shared')
        """
    )


def upgrade() -> None:
    _normalize_table("workflows")
    _normalize_table("provider_connections")
    _normalize_table("cohort_datasets")


def downgrade() -> None:
    op.execute(
        """
        UPDATE orchestration.workflows
        SET visibility = CASE visibility::text
            WHEN 'PRIVATE' THEN 'private'
            WHEN 'SHARED' THEN 'shared'
            ELSE visibility::text
        END
        WHERE visibility::text IN ('PRIVATE', 'SHARED')
        """
    )
    op.execute(
        """
        UPDATE orchestration.provider_connections
        SET visibility = CASE visibility::text
            WHEN 'PRIVATE' THEN 'private'
            WHEN 'SHARED' THEN 'shared'
            ELSE visibility::text
        END
        WHERE visibility::text IN ('PRIVATE', 'SHARED')
        """
    )
    op.execute(
        """
        UPDATE orchestration.cohort_datasets
        SET visibility = CASE visibility::text
            WHEN 'PRIVATE' THEN 'private'
            WHEN 'SHARED' THEN 'shared'
            ELSE visibility::text
        END
        WHERE visibility::text IN ('PRIVATE', 'SHARED')
        """
    )
