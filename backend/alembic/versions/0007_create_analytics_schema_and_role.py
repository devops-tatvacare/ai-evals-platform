"""create analytics schema; defer analytics_reader/search_path to infra

Roadmap 01 §9.3 revision 0007.

This revision:
  1. Creates the empty ``analytics`` schema.
  2. Defers ``analytics_reader`` role creation, grants, and any DB-level
     ``search_path`` changes to a privileged infra step run outside the
     app-owned Alembic chain. The application already schema-qualifies its
     SQL, so those hardening changes are optional for correctness.

Plan §9.3 lists this as Low risk. No table moves, no behavior change
inside the application. Roadmap 03 (FHIR) later adds a third schema
(``clinical``) — no extension/role provisioning is anticipated for this
revision beyond what's here.

Reversibility: downgrade drops the empty schema. Privileged role/grant
setup is intentionally out of band and therefore not owned by this
migration.

Dependencies: §0.1 hard gate (revisions 0001–0004 applied). Revision
0005 (``platform`` schema) applied. Revision 0006 (table moves) is NOT
required — this revision can ship before or after 0006 without
interaction. Revision 0008 (move analytics-adjacent tables) is gated
by 0006 per §9.9, so the typical chain order is 0005 → 0006 → 0007 →
0008. Shipping 0005 + 0007 together (Phase 2) keeps both empty-schema
setups in one reviewable commit so 0006's deploy choreography PR stays
focused on the breaking change.

Operational note: keeping this revision schema-only makes the app-run
Alembic chain compatible with managed Postgres environments where the
runtime DB principal cannot ``CREATE ROLE`` or alter role attributes.

Revision ID: 0007_create_analytics_schema_and_role
Revises: 0005_create_platform_schema
Create Date: 2026-04-28
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0007_create_analytics_schema_and_role"
down_revision: Union[str, None] = "0006_move_oltp_tables_to_platform"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS analytics")


def downgrade() -> None:
    # RESTRICT — fail if anything has landed in analytics. Roadmap 01
    # keeps the schema empty until revision 0008.
    op.execute("DROP SCHEMA IF EXISTS analytics RESTRICT")
