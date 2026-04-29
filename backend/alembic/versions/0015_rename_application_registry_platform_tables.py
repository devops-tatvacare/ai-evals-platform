"""rename 3 application registry platform tables to their final names

Roadmap 01 §5 revision 0015. Application registry rename **within
``platform``** (no schema move). Three tables get their final names.

Renames (3):
  apps             -> applications
  external_agents  -> application_external_agent_connectors
  settings         -> application_settings

Indexes and unique-constraint names that explicitly embed the old
physical table name (or its singular root) are renamed in lockstep so
the live catalog stays consistent with the ORM ``__table_args__``
declarations.

Postgres-auto-generated names (``*_pkey``, ``*_fkey``,
``*_<col>_<col>_key``) are left as-is — same precedent as revisions
0009 / 0011 / 0012 / 0013 / 0014. ``apps_slug_key`` (auto-generated
``UNIQUE`` constraint backing index) follows the table on rename and
keeps its physical name; this is intentional.

Reversibility: downgrade reverses every rename (table + indexes +
constraints) in symmetric order.

Revision ID: 0015_rename_application_registry_platform_tables
Revises: 0014_rename_library_dataset_upload_tag_platform_tables
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0015_rename_application_registry_platform_tables"
down_revision: Union[str, None] = "0014_rename_library_dataset_upload_tag_platform_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (old_table, new_table, [(old_index_or_constraint, new_index_or_constraint), ...])
# Auto-generated ``*_pkey`` / ``*_fkey`` / ``*_<col>_<col>_key`` names are
# left untouched to keep the diff surface minimal — same precedent as
# revisions 0009 / 0011 / 0012 / 0013 / 0014.
_TABLE_RENAMES: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    (
        "apps",
        "applications",
        (),
    ),
    (
        "external_agents",
        "application_external_agent_connectors",
        (
            (
                "uq_external_agent_identity",
                "uq_application_external_agent_connector_identity",
            ),
            (
                "idx_external_agent_tenant_source",
                "idx_application_external_agent_connectors_tenant_source",
            ),
        ),
    ),
    (
        "settings",
        "application_settings",
        (
            ("uq_setting", "uq_application_setting"),
            ("idx_settings_tenant", "idx_application_settings_tenant"),
            (
                "idx_settings_tenant_user",
                "idx_application_settings_tenant_user",
            ),
            (
                "uq_settings_private_scope",
                "uq_application_settings_private_scope",
            ),
            (
                "uq_settings_shared_scope",
                "uq_application_settings_shared_scope",
            ),
        ),
    ),
)


def upgrade() -> None:
    assert len(_TABLE_RENAMES) == 3, (
        f"expected 3 table renames per plan §5, got {len(_TABLE_RENAMES)}"
    )
    for old_table, new_table, refactors in _TABLE_RENAMES:
        for old_name, new_name in refactors:
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
            op.execute(
                f"ALTER INDEX platform.{new_name} RENAME TO {old_name}"
            )
