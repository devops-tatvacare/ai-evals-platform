"""create platform schema (no table moves yet)

Roadmap 01 §9.3 revision 0005: create the empty ``platform`` schema so
revision 0006 can move the 43 OLTP/application tables out of ``public``
in a single ``ALTER TABLE ... SET SCHEMA`` chain.

This revision is intentionally minimal — no role grants, no
``search_path`` change, no analytics schema. Those land in revision
0007 once both schemas are populated. ``platform`` is empty after this
revision applies; the manifest validator continues to resolve every
catalog table in ``public`` because manifest YAMLs do not yet declare
``pg_schema:``.

Reversibility: the downgrade drops ``platform`` with ``RESTRICT``. If
anything ever lands in the schema (it shouldn't until 0006), the drop
fails loudly rather than silently destroying objects.

Revision ID: 0005_create_platform_schema
Revises: 0004_drop_inside_sales_cols
Create Date: 2026-04-28
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0005_create_platform_schema"
down_revision: Union[str, None] = "0004_drop_inside_sales_cols"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS platform")


def downgrade() -> None:
    # RESTRICT (the default) refuses if any object lives in the schema.
    # Roadmap 01 keeps platform empty until revision 0006, so this
    # always succeeds when 0005 is the only platform-touching revision
    # applied. If 0006+ have applied, the operator must downgrade those
    # first.
    op.execute("DROP SCHEMA IF EXISTS platform RESTRICT")
