"""rename 7 evaluation platform tables to their final names

Roadmap 01 §5.4 revision 0012. Evaluation domain rename **within
``platform``** (no schema move). Seven tables get their final names;
``platform.evaluators`` is intentionally left untouched since its
current name already matches §5.4's locked target.

Renames (7):
  eval_runs               -> evaluation_runs
  thread_evaluations      -> evaluation_run_thread_results
  adversarial_evaluations -> evaluation_run_adversarial_results
  api_logs                -> evaluation_run_api_call_logs
  eval_templates          -> evaluation_templates
  eval_reviews            -> evaluation_reviews
  eval_review_items       -> evaluation_review_items

Indexes and unique-constraint names that explicitly embed the old
physical table name are renamed in lockstep so the live catalog stays
consistent with the ORM ``__table_args__`` declarations.
Postgres-auto-generated names (``*_pkey``, ``*_fkey``, ``*_<col>_<col>_key``)
are left as-is — same precedent as revisions 0009 / 0011. The single
explicit ``fk_eval_runs_latest_review_id`` constraint is renamed via
``ALTER TABLE ... RENAME CONSTRAINT``.

The four ``idx_eval_runs_search_*_trgm`` indexes (Bucket-C drift,
filtered out of autogen via ``_AUTOGEN_IGNORED_INDEXES`` in
``alembic/env.py``) are renamed here too, and ``env.py`` is updated to
the new names in the same commit so the autogen filter stays effective.

Reversibility: downgrade reverses every rename (table + indexes +
constraints) in symmetric order.

Revision ID: 0012_rename_evaluation_platform_tables
Revises: 0011_rename_sherlock_platform_tables
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0012_rename_evaluation_platform_tables"
down_revision: Union[str, None] = "0011_rename_sherlock_platform_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (old_table, new_table, [(old_index_or_constraint, new_index_or_constraint), ...])
# Constraint renames whose old names start with ``fk_`` use ``ALTER TABLE
# ... RENAME CONSTRAINT``; everything else is renamed via ``ALTER INDEX``
# (which works for both indexes and unique-constraint-backed indexes in
# Postgres). Auto-generated ``*_pkey`` / ``*_fkey`` /
# ``*_<col>_<col>_key`` names are left untouched to keep the diff
# surface minimal — same precedent as revisions 0009 / 0011.
_TABLE_RENAMES: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    (
        "eval_runs",
        "evaluation_runs",
        (
            ("idx_eval_runs_listing", "idx_evaluation_runs_listing"),
            ("idx_eval_runs_session", "idx_evaluation_runs_session"),
            ("idx_eval_runs_app_type", "idx_evaluation_runs_app_type"),
            ("idx_eval_runs_evaluator", "idx_evaluation_runs_evaluator"),
            ("idx_eval_runs_tenant", "idx_evaluation_runs_tenant"),
            ("idx_eval_runs_tenant_app", "idx_evaluation_runs_tenant_app"),
            ("idx_eval_runs_tenant_user", "idx_evaluation_runs_tenant_user"),
            (
                "idx_eval_runs_tenant_user_app_created",
                "idx_evaluation_runs_tenant_user_app_created",
            ),
            (
                "idx_eval_runs_tenant_app_visibility_created",
                "idx_evaluation_runs_tenant_app_visibility_created",
            ),
            (
                "idx_eval_runs_tenant_user_app_status_created",
                "idx_evaluation_runs_tenant_user_app_status_created",
            ),
            (
                "idx_eval_runs_tenant_visibility_created",
                "idx_evaluation_runs_tenant_visibility_created",
            ),
            ("idx_eval_runs_latest_review", "idx_evaluation_runs_latest_review"),
            (
                "idx_eval_runs_search_id_trgm",
                "idx_evaluation_runs_search_id_trgm",
            ),
            (
                "idx_eval_runs_search_summary_evaluator_trgm",
                "idx_evaluation_runs_search_summary_evaluator_trgm",
            ),
            (
                "idx_eval_runs_search_config_evaluator_trgm",
                "idx_evaluation_runs_search_config_evaluator_trgm",
            ),
            (
                "idx_eval_runs_search_batch_name_trgm",
                "idx_evaluation_runs_search_batch_name_trgm",
            ),
            (
                "fk_eval_runs_latest_review_id",
                "fk_evaluation_runs_latest_review_id",
            ),
        ),
    ),
    (
        "thread_evaluations",
        "evaluation_run_thread_results",
        (
            (
                "idx_thread_evaluations_thread_id_id",
                "idx_evaluation_run_thread_results_thread_id_id",
            ),
            (
                "ix_thread_evaluations_run_id",
                "ix_evaluation_run_thread_results_run_id",
            ),
            (
                "ix_thread_evaluations_thread_id",
                "ix_evaluation_run_thread_results_thread_id",
            ),
            (
                "ix_thread_evaluations_data_file_hash",
                "ix_evaluation_run_thread_results_data_file_hash",
            ),
        ),
    ),
    (
        "adversarial_evaluations",
        "evaluation_run_adversarial_results",
        (
            (
                "ix_adversarial_evaluations_run_id",
                "ix_evaluation_run_adversarial_results_run_id",
            ),
        ),
    ),
    (
        "api_logs",
        "evaluation_run_api_call_logs",
        (
            (
                "idx_api_logs_run_id_id",
                "idx_evaluation_run_api_call_logs_run_id_id",
            ),
            (
                "ix_api_logs_run_id",
                "ix_evaluation_run_api_call_logs_run_id",
            ),
            (
                "ix_api_logs_thread_id",
                "ix_evaluation_run_api_call_logs_thread_id",
            ),
            (
                "ix_api_logs_test_case_label",
                "ix_evaluation_run_api_call_logs_test_case_label",
            ),
        ),
    ),
    (
        "eval_templates",
        "evaluation_templates",
        (
            (
                "uq_eval_template_branch_version",
                "uq_evaluation_template_branch_version",
            ),
            ("idx_eval_templates_tenant", "idx_evaluation_templates_tenant"),
            (
                "idx_eval_templates_tenant_user",
                "idx_evaluation_templates_tenant_user",
            ),
            (
                "idx_eval_templates_tenant_app",
                "idx_evaluation_templates_tenant_app",
            ),
            (
                "idx_eval_templates_tenant_user_app_updated",
                "idx_evaluation_templates_tenant_user_app_updated",
            ),
            (
                "idx_eval_templates_tenant_app_visibility_updated",
                "idx_evaluation_templates_tenant_app_visibility_updated",
            ),
            (
                "idx_eval_templates_tenant_branch",
                "idx_evaluation_templates_tenant_branch",
            ),
        ),
    ),
    (
        "eval_reviews",
        "evaluation_reviews",
        (
            (
                "idx_eval_reviews_run_status_created",
                "idx_evaluation_reviews_run_status_created",
            ),
            (
                "idx_eval_reviews_reviewer_created",
                "idx_evaluation_reviews_reviewer_created",
            ),
            (
                "uq_eval_reviews_run_reviewer_draft",
                "uq_evaluation_reviews_run_reviewer_draft",
            ),
        ),
    ),
    (
        "eval_review_items",
        "evaluation_review_items",
        (
            (
                "uq_eval_review_items_review_item_attribute",
                "uq_evaluation_review_items_review_item_attribute",
            ),
            (
                "idx_eval_review_items_review_created",
                "idx_evaluation_review_items_review_created",
            ),
        ),
    ),
)


def upgrade() -> None:
    assert len(_TABLE_RENAMES) == 7, (
        f"expected 7 table renames per plan §5.4, got {len(_TABLE_RENAMES)}"
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
