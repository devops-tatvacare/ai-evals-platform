"""rename 5 tenant + audit + jobs platform tables to their final names

Roadmap 01 §5 revision 0016. Tenant configuration, audit log, and the
job/scheduler tables get their final names **within ``platform``** (no
schema move). Five tables in scope.

Renames (5):
  tenant_configs        -> tenant_configurations
  audit_log             -> audit_event_logs
  jobs                  -> background_jobs
  scheduled_jobs        -> scheduled_job_definitions
  scheduler_heartbeats  -> scheduler_worker_heartbeats

Indexes and unique-constraint names that explicitly embed the old
physical table name (or its singular root) are renamed in lockstep so
the live catalog stays consistent with the ORM ``__table_args__``
declarations.

SQLAlchemy ``index=True`` auto-named indexes are renamed into the
schema-qualified ``ix_<schema>_<table>_<column>`` shape that SQLAlchemy
expects under ``include_schemas=True`` (Roadmap 01 §9.5):

  ix_jobs_status  ->  ix_platform_background_jobs_status

Two ``fk_*`` foreign-key constraints embedded the old ``jobs`` name and
are renamed via ``ALTER TABLE ... RENAME CONSTRAINT``:

  fk_jobs_depends_on_job_id          -> fk_background_jobs_depends_on_job_id
  fk_jobs_scheduled_job_id           -> fk_background_jobs_scheduled_job_id

A third ``fk_log_crm_source_sync_job_id`` lives on the
``analytics.log_crm_source_sync`` row that points at ``platform.jobs``.
The constraint name does not embed the renamed table name directly, so
it is left as-is — the FK target is migrated by Postgres along with the
table rename, and the constraint name is preserved in
``app/models/source_records.py``'s ``ForeignKey(..., name=...)``
declaration.

Postgres-auto-generated names (``*_pkey``, ``*_fkey``,
``*_<col>_<col>_key``) are left as-is — same precedent as revisions
0009 / 0011 / 0012 / 0013 / 0014 / 0015.

Reversibility: downgrade reverses every rename (table + indexes +
constraints) in symmetric order.

Revision ID: 0016_rename_tenant_audit_jobs_platform_tables
Revises: 0015_rename_application_registry_platform_tables
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0016_rename_tenant_audit_jobs_platform_tables"
down_revision: Union[str, None] = "0015_rename_application_registry_platform_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (old_table, new_table, [(old_index_or_constraint, new_index_or_constraint), ...])
# Constraint renames whose old names start with ``fk_`` use ``ALTER TABLE
# ... RENAME CONSTRAINT``; everything else is renamed via ``ALTER INDEX``
# (which works for both indexes and unique-constraint-backed indexes in
# Postgres). Auto-generated ``*_pkey`` / ``*_fkey`` /
# ``*_<col>_<col>_key`` names are left untouched to keep the diff
# surface minimal.
_TABLE_RENAMES: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    (
        "tenant_configs",
        "tenant_configurations",
        (),
    ),
    (
        "audit_log",
        "audit_event_logs",
        (
            ("idx_audit_log_tenant_created", "idx_audit_event_logs_tenant_created"),
            ("idx_audit_log_entity", "idx_audit_event_logs_entity"),
        ),
    ),
    (
        "jobs",
        "background_jobs",
        (
            ("fk_jobs_depends_on_job_id", "fk_background_jobs_depends_on_job_id"),
            ("fk_jobs_scheduled_job_id", "fk_background_jobs_scheduled_job_id"),
            ("idx_jobs_depends_on", "idx_background_jobs_depends_on"),
            (
                "idx_jobs_scheduled_job_created",
                "idx_background_jobs_scheduled_job_created",
            ),
            (
                "idx_jobs_status_lease_expires",
                "idx_background_jobs_status_lease_expires",
            ),
            (
                "idx_jobs_status_next_retry",
                "idx_background_jobs_status_next_retry",
            ),
            (
                "idx_jobs_status_priority_created",
                "idx_background_jobs_status_priority_created",
            ),
            (
                "idx_jobs_submission_context_gin",
                "idx_background_jobs_submission_context_gin",
            ),
            ("idx_jobs_tenant", "idx_background_jobs_tenant"),
            (
                "idx_jobs_tenant_app_status_created",
                "idx_background_jobs_tenant_app_status_created",
            ),
            (
                "idx_jobs_tenant_status_created",
                "idx_background_jobs_tenant_status_created",
            ),
            ("idx_jobs_tenant_user", "idx_background_jobs_tenant_user"),
            ("ix_jobs_status", "ix_platform_background_jobs_status"),
            (
                "uq_jobs_user_idempotency_key",
                "uq_background_jobs_user_idempotency_key",
            ),
        ),
    ),
    (
        "scheduled_jobs",
        "scheduled_job_definitions",
        (
            (
                "idx_scheduled_jobs_enabled_next_check",
                "idx_scheduled_job_definitions_enabled_next_check",
            ),
            (
                "idx_scheduled_jobs_tenant_app",
                "idx_scheduled_job_definitions_tenant_app",
            ),
            (
                "uq_scheduled_jobs_tenant_app_type_key",
                "uq_scheduled_job_definitions_tenant_app_type_key",
            ),
        ),
    ),
    (
        "scheduler_heartbeats",
        "scheduler_worker_heartbeats",
        (),
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
