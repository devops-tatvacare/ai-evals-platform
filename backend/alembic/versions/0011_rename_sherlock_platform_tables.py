"""rename 5 sherlock platform tables to their final names

Roadmap 01 §5.9 revision 0011. Sherlock domain rename **within
``platform``** (no schema move). Five tables get their final names;
``platform.sherlock_ontology_classes`` is intentionally left untouched
since its current name already matches §5.9's locked target.

Renames (5):
  sherlock_runtime_sessions -> sherlock_agent_sessions
  sherlock_runtime_turns    -> sherlock_conversation_turns
  sherlock_runtime_events   -> sherlock_turn_events
  sherlock_entity_types     -> sherlock_ontology_entity_types
  sherlock_resolvers        -> sherlock_entity_resolvers

Indexes and unique-constraint names that explicitly embed the old
physical table or entity name are renamed in lockstep so the live
catalog stays consistent with the ORM ``__table_args__`` declarations.
Postgres-auto-generated names (``*_pkey``, ``*_fkey``,
``*_chat_session_id_seq_key``) are left as-is — same precedent as
revision 0009. ``platform.log_sherlock_tool_call`` is **not** touched
here; that move + rename was already covered by revisions 0008 / 0009.

Reversibility: downgrade reverses every rename (table + indexes +
constraints) in symmetric order.

Revision ID: 0011_rename_sherlock_platform_tables
Revises: 0010_drop_evaluation_analytics
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0011_rename_sherlock_platform_tables"
down_revision: Union[str, None] = "0010_drop_evaluation_analytics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (old_table, new_table, [(old_index_or_constraint, new_index_or_constraint), ...])
# Constraint renames whose old names start with ``fk_`` use ``ALTER TABLE
# ... RENAME CONSTRAINT``; everything else is renamed via ``ALTER INDEX``
# (which works for both indexes and unique-constraint-backed indexes in
# Postgres). Auto-generated ``*_pkey`` / ``*_fkey`` /
# ``*_<col>_<col>_key`` names are left untouched to keep the diff
# surface minimal — same precedent as revision 0009.
_TABLE_RENAMES: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    (
        "sherlock_runtime_sessions",
        "sherlock_agent_sessions",
        (
            (
                "idx_sherlock_runtime_tenant_app",
                "idx_sherlock_agent_sessions_tenant_app",
            ),
        ),
    ),
    (
        "sherlock_runtime_turns",
        "sherlock_conversation_turns",
        (
            (
                "uq_sherlock_runtime_turn_client_id",
                "uq_sherlock_conversation_turn_client_id",
            ),
            (
                "idx_sherlock_runtime_turn_status",
                "idx_sherlock_conversation_turn_status",
            ),
            (
                "idx_sherlock_runtime_turn_correlation_id",
                "idx_sherlock_conversation_turn_correlation_id",
            ),
        ),
    ),
    (
        "sherlock_runtime_events",
        "sherlock_turn_events",
        (
            (
                "idx_sherlock_runtime_events_session_seq",
                "idx_sherlock_turn_events_session_seq",
            ),
            (
                "ix_sherlock_runtime_events_chat_session_id",
                "ix_sherlock_turn_events_chat_session_id",
            ),
        ),
    ),
    (
        "sherlock_entity_types",
        "sherlock_ontology_entity_types",
        (
            (
                "uq_sherlock_entity_type_scope",
                "uq_sherlock_ontology_entity_type_scope",
            ),
            (
                "idx_sherlock_entity_type_app_safety",
                "idx_sherlock_ontology_entity_type_app_safety",
            ),
            (
                "idx_sherlock_entity_type_tenant_app",
                "idx_sherlock_ontology_entity_type_tenant_app",
            ),
        ),
    ),
    (
        "sherlock_resolvers",
        "sherlock_entity_resolvers",
        (
            (
                "uq_sherlock_resolver_scope",
                "uq_sherlock_entity_resolver_scope",
            ),
            (
                "idx_sherlock_resolver_app_entity",
                "idx_sherlock_entity_resolver_app_entity",
            ),
        ),
    ),
)


def upgrade() -> None:
    assert len(_TABLE_RENAMES) == 5, (
        f"expected 5 table renames per plan §5.9, got {len(_TABLE_RENAMES)}"
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
