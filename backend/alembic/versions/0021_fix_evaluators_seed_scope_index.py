"""fix evaluators seed-scope unique index visibility case

The original ``uq_evaluators_seed_scope`` partial index was authored
with predicate ``visibility::text = 'shared'`` (lowercase). However,
SQLAlchemy stores ``Visibility`` (a non-native ``SAEnum`` without
``values_callable``) as the enum NAME — uppercase ``'SHARED'`` /
``'PRIVATE'``. Result: the predicate matched zero rows on prod, silently
leaving canonical-seed uniqueness unenforced at the DB layer. Every
other visibility-predicated index in the platform already uses
uppercase, so this realigns the lone outlier.

Revision ID: 0021_fix_evaluators_seed_scope_index
Revises: 0020_create_log_clinical_action_outbox
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0021_fix_evaluators_seed_scope_index"
down_revision: Union[str, None] = "0020_create_log_clinical_action_outbox"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS platform.uq_evaluators_seed_scope")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_evaluators_seed_scope
        ON platform.evaluators
            (tenant_id, app_id, COALESCE(seed_variant, ''::varchar), seed_key)
        WHERE listing_id IS NULL
          AND forked_from IS NULL
          AND seed_key IS NOT NULL
          AND visibility::text = 'SHARED'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS platform.uq_evaluators_seed_scope")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_evaluators_seed_scope
        ON platform.evaluators
            (tenant_id, app_id, COALESCE(seed_variant, ''::varchar), seed_key)
        WHERE listing_id IS NULL
          AND forked_from IS NULL
          AND seed_key IS NOT NULL
          AND visibility::text = 'shared'
        """
    )
