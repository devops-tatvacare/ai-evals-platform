"""normalize visibility column defaults to enum names

Revision ID: 0032_normalize_visibility_defaults
Revises: 0031_normalize_orchestration_visibility_case
Create Date: 2026-05-07

The platform persists ``asset_visibility`` as enum names (``PRIVATE`` /
``SHARED``) when SQLAlchemy handles inserts. Several tables still carried
database defaults of lowercase ``'private'`` from older migrations/model
declarations. Those defaults are only hit on insert paths that omit the column,
but when they do fire they create rows the ORM cannot read.

This migration aligns every live visibility default with the enum-name storage
convention so fresh inserts and existing rows remain compatible.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0032_normalize_visibility_defaults"
down_revision: Union[str, None] = "0031_normalize_orchestration_visibility_case"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DEFAULT_FIXES: tuple[tuple[str, str, str], ...] = (
    ("orchestration", "workflows", "visibility"),
    ("orchestration", "provider_connections", "visibility"),
    ("orchestration", "cohort_datasets", "visibility"),
    ("platform", "analytics_charts", "visibility"),
    ("platform", "analytics_dashboards", "visibility"),
    ("platform", "application_settings", "visibility"),
    ("platform", "evaluation_runs", "visibility"),
    ("platform", "evaluation_templates", "visibility"),
    ("platform", "evaluators", "visibility"),
    ("platform", "library_output_schema_definitions", "visibility"),
    ("platform", "library_prompt_definitions", "visibility"),
    ("platform", "report_configurations", "visibility"),
    ("platform", "report_configurations", "default_report_run_visibility"),
    ("platform", "report_generation_runs", "visibility"),
)


def upgrade() -> None:
    for schema, table, column in _DEFAULT_FIXES:
        op.execute(
            f"ALTER TABLE {schema}.{table} ALTER COLUMN {column} SET DEFAULT 'PRIVATE'"
        )


def downgrade() -> None:
    for schema, table, column in _DEFAULT_FIXES:
        op.execute(
            f"ALTER TABLE {schema}.{table} ALTER COLUMN {column} SET DEFAULT 'private'"
        )
