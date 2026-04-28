"""create analytics schema, analytics_reader role, grants, and default search_path

Roadmap 01 §9.3 revision 0007 + §9.2 grants/search_path block.

This revision:
  1. Creates the empty ``analytics`` schema.
  2. Creates the ``analytics_reader`` NOLOGIN role with conservative
     statement_timeout / work_mem / idle_in_transaction_session_timeout
     defaults — the role Sherlock's read-only analytics path will adopt
     (deferred to a follow-up PR per §9.8; the role exists now so grant
     management is a one-line change later).
  3. Grants USAGE + future-default SELECT on the analytics schema to
     ``analytics_reader``. Because the schema is empty at this point,
     ``GRANT SELECT ON ALL TABLES`` is a no-op; ``ALTER DEFAULT PRIVILEGES``
     covers every table the rename chain will land here in revisions
     0008+.
  4. Sets the database default ``search_path = platform, analytics`` per
     §9.2. Application code MUST schema-qualify (Phase 1 made every
     helper schema-aware); the search_path is purely for interactive
     ``psql`` / GUI use.

Plan §9.3 lists this as Low risk. No table moves, no behavior change
inside the application. Roadmap 03 (FHIR) later adds a third schema
(``clinical``) — no extension/role provisioning is anticipated for this
revision beyond what's here.

Reversibility: downgrade reverses every step in symmetric order. The
``ALTER DATABASE … SET search_path`` is reset using ``RESET`` so the
cluster default returns. The role drop is conditional so re-running a
downgrade is safe.

Dependencies: §0.1 hard gate (revisions 0001–0004 applied). Revision
0005 (``platform`` schema) applied. Revision 0006 (table moves) is NOT
required — this revision can ship before or after 0006 without
interaction. Revision 0008 (move analytics-adjacent tables) is gated
by 0006 per §9.9, so the typical chain order is 0005 → 0006 → 0007 →
0008. Shipping 0005 + 0007 together (Phase 2) keeps both empty-schema
setups in one reviewable commit so 0006's deploy choreography PR stays
focused on the breaking change.

Operational note: this revision issues ``CREATE ROLE`` and
``ALTER DATABASE``. The connecting role must have ``CREATEROLE``
privileges and ownership of (or superuser access to) the target
database. Standard practice on Azure Postgres Flexible Server: connect
as the admin role configured at provisioning time.

Revision ID: 0007_create_analytics_schema_and_role
Revises: 0005_create_platform_schema
Create Date: 2026-04-28
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import context, op
from sqlalchemy import text


revision: str = "0007_create_analytics_schema_and_role"
down_revision: Union[str, None] = "0006_move_oltp_tables_to_platform"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _current_db_name() -> str:
    """Return the database name for the dynamic ``ALTER DATABASE``.

    Online mode: read it from ``current_database()`` so the migration
    works against any per-env database name without hard-coding.

    Offline mode (``alembic upgrade --sql``): no live bind exists. Return
    a placeholder so the rendered SQL is reviewable; an operator running
    the SQL by hand replaces it with the real database name. The
    placeholder is intentionally non-quotable garbage that will fail
    loudly if pasted unchanged.
    """
    if context.is_offline_mode():
        return "__REPLACE_WITH_DATABASE_NAME__"
    bind = op.get_bind()
    return bind.execute(text("SELECT current_database()")).scalar_one()


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS analytics")

    # Idempotent role creation. ``CREATE ROLE`` errors if the role
    # already exists; the DO block makes re-runs safe.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_reader') THEN
                CREATE ROLE analytics_reader NOLOGIN;
            END IF;
        END$$;
        """
    )

    op.execute("GRANT USAGE ON SCHEMA analytics TO analytics_reader")
    op.execute(
        "GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO analytics_reader"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA analytics "
        "GRANT SELECT ON TABLES TO analytics_reader"
    )

    op.execute(
        "ALTER ROLE analytics_reader SET statement_timeout = '30s'"
    )
    op.execute(
        "ALTER ROLE analytics_reader SET work_mem = '256MB'"
    )
    op.execute(
        "ALTER ROLE analytics_reader "
        "SET idle_in_transaction_session_timeout = '60s'"
    )

    db_name = _current_db_name()
    op.execute(
        f'ALTER DATABASE "{db_name}" SET search_path = platform, analytics'
    )


def downgrade() -> None:
    db_name = _current_db_name()
    op.execute(f'ALTER DATABASE "{db_name}" RESET search_path')

    op.execute(
        "ALTER ROLE analytics_reader RESET idle_in_transaction_session_timeout"
    )
    op.execute("ALTER ROLE analytics_reader RESET work_mem")
    op.execute("ALTER ROLE analytics_reader RESET statement_timeout")

    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA analytics "
        "REVOKE SELECT ON TABLES FROM analytics_reader"
    )
    op.execute(
        "REVOKE SELECT ON ALL TABLES IN SCHEMA analytics FROM analytics_reader"
    )
    op.execute("REVOKE USAGE ON SCHEMA analytics FROM analytics_reader")

    # Drop the role only if it has no remaining grants. The reverse order
    # of GRANTs/ALTERs above leaves the role with no privileges, so this
    # is safe in the canonical downgrade path. If an operator has
    # granted analytics_reader other privileges out-of-band, DROP ROLE
    # will fail loudly — that's the correct behavior.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_reader') THEN
                DROP ROLE analytics_reader;
            END IF;
        END$$;
        """
    )

    # RESTRICT — fail if anything has landed in analytics. Roadmap 01
    # keeps the schema empty until revision 0008.
    op.execute("DROP SCHEMA IF EXISTS analytics RESTRICT")
