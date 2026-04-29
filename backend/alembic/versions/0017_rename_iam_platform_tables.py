"""rename 5 identity & access platform tables to their final names

Roadmap 01 §5 revision 0017. Identity & access management rename
**within ``platform``** (no schema move). Five tables in scope.

Renames (5):
  refresh_tokens     -> identity_refresh_tokens
  invite_links       -> identity_invite_links
  roles              -> access_roles
  role_app_access    -> access_role_application_grants
  role_permissions   -> access_role_permissions

``platform.users`` is intentionally left unchanged.

Indexes and unique-constraint names that explicitly embed the old
physical table name (or its singular root) are renamed in lockstep so
the live catalog stays consistent with the ORM ``__table_args__``
declarations.

Postgres-auto-generated names (``*_pkey``, ``*_fkey``,
``*_<col>_<col>_key``) are left as-is — same precedent as revisions
0009 / 0011 / 0012 / 0013 / 0014 / 0015 / 0016. The remaining
``users_role_id_fkey`` and ``invite_links_role_id_fkey`` keys move with
their owning tables on rename without intervention; their target column
``role_id`` continues to reference ``platform.access_roles(id)`` after
0017 applies.

Reversibility: downgrade reverses every rename (table + indexes +
constraints) in symmetric order.

Revision ID: 0017_rename_iam_platform_tables
Revises: 0016_rename_tenant_audit_jobs_platform_tables
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0017_rename_iam_platform_tables"
down_revision: Union[str, None] = "0016_rename_tenant_audit_jobs_platform_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (old_table, new_table, [(old_index_or_constraint, new_index_or_constraint), ...])
# Constraint renames whose old names start with ``fk_`` use ``ALTER TABLE
# ... RENAME CONSTRAINT``; everything else is renamed via ``ALTER INDEX``
# (which works for both indexes and unique-constraint-backed indexes in
# Postgres). Auto-generated ``*_pkey`` / ``*_fkey`` /
# ``*_<col>_<col>_key`` names are left untouched.
_TABLE_RENAMES: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    (
        "refresh_tokens",
        "identity_refresh_tokens",
        (
            ("idx_refresh_tokens_user", "idx_identity_refresh_tokens_user"),
            ("idx_refresh_tokens_expires", "idx_identity_refresh_tokens_expires"),
        ),
    ),
    (
        "invite_links",
        "identity_invite_links",
        (
            ("idx_invite_links_token_hash", "idx_identity_invite_links_token_hash"),
            ("idx_invite_links_tenant", "idx_identity_invite_links_tenant"),
        ),
    ),
    (
        "roles",
        "access_roles",
        (
            ("uq_role_name_per_tenant", "uq_access_role_name_per_tenant"),
        ),
    ),
    (
        "role_app_access",
        "access_role_application_grants",
        (
            ("uq_role_app_access", "uq_access_role_application_grant"),
        ),
    ),
    (
        "role_permissions",
        "access_role_permissions",
        (
            ("uq_role_permission", "uq_access_role_permission"),
        ),
    ),
)


def upgrade() -> None:
    assert len(_TABLE_RENAMES) == 5, (
        f"expected 5 table renames per plan §5, got {len(_TABLE_RENAMES)}"
    )
    for old_table, new_table, refactors in _TABLE_RENAMES:
        for old_name, new_name in refactors:
            if old_name.startswith("fk_"):
                op.execute(
                    f"ALTER TABLE platform.{old_table} "
                    f"RENAME CONSTRAINT {old_name} TO {new_name}"
                )
            else:
                op.execute(
                    f"ALTER INDEX platform.{old_name} RENAME TO {new_name}"
                )
        op.execute(
            f"ALTER TABLE platform.{old_table} RENAME TO {new_table}"
        )


def downgrade() -> None:
    # Reverse: rename the table back first, then the indexes / constraints.
    for old_table, new_table, refactors in reversed(_TABLE_RENAMES):
        op.execute(
            f"ALTER TABLE platform.{new_table} RENAME TO {old_table}"
        )
        for old_name, new_name in reversed(refactors):
            if old_name.startswith("fk_"):
                op.execute(
                    f"ALTER TABLE platform.{old_table} "
                    f"RENAME CONSTRAINT {new_name} TO {old_name}"
                )
            else:
                op.execute(
                    f"ALTER INDEX platform.{new_name} RENAME TO {old_name}"
                )
