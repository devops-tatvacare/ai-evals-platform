"""rename 6 library + dataset + upload + tag platform tables to their final names

Roadmap 01 §5 revision 0014. Library, dataset, upload, and tag rename
**within ``platform``** (no schema move). Six tables get their final
names.

Renames (6):
  prompts                 -> library_prompt_definitions
  schemas                 -> library_output_schema_definitions
  adversarial_test_cases  -> library_adversarial_test_cases
  listings                -> evaluation_datasets
  files                   -> application_uploaded_files
  tags                    -> application_tags

Indexes and unique-constraint names that explicitly embed the old
physical table name (or its singular root) are renamed in lockstep so
the live catalog stays consistent with the ORM ``__table_args__``
declarations.

One SQLAlchemy ``index=True`` auto-named index is also renamed into the
schema-qualified ``ix_<schema>_<table>_<column>`` shape that SQLAlchemy
expects under ``include_schemas=True`` (Roadmap 01 §9.5):

  ix_listings_app_id  ->  ix_platform_evaluation_datasets_app_id

This index was created by the prod baseline from
``Listing.app_id = mapped_column(..., index=True)``. Without renaming it
here, the live catalog drifts from ``Base.metadata`` after 0014
applies.

Postgres-auto-generated names (``*_pkey``, ``*_fkey``,
``*_<col>_<col>_key``) are left as-is — same precedent as revisions
0009 / 0011 / 0012 / 0013.

Reversibility: downgrade reverses every rename (table + indexes +
constraints) in symmetric order.

Revision ID: 0014_rename_library_dataset_upload_tag_platform_tables
Revises: 0013_rename_report_and_history_platform_tables
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0014_rename_library_dataset_upload_tag_platform_tables"
down_revision: Union[str, None] = "0013_rename_report_and_history_platform_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (old_table, new_table, [(old_index_or_constraint, new_index_or_constraint), ...])
# Auto-generated ``*_pkey`` / ``*_fkey`` / ``*_<col>_<col>_key`` names are
# left untouched to keep the diff surface minimal — same precedent as
# revisions 0009 / 0011 / 0012 / 0013.
_TABLE_RENAMES: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    (
        "prompts",
        "library_prompt_definitions",
        (
            (
                "uq_prompt_branch_version",
                "uq_library_prompt_definition_branch_version",
            ),
            ("idx_prompts_tenant", "idx_library_prompt_definitions_tenant"),
            (
                "idx_prompts_tenant_user",
                "idx_library_prompt_definitions_tenant_user",
            ),
            (
                "idx_prompts_tenant_app",
                "idx_library_prompt_definitions_tenant_app",
            ),
            (
                "idx_prompts_tenant_user_app_updated",
                "idx_library_prompt_definitions_tenant_user_app_updated",
            ),
            (
                "idx_prompts_tenant_app_visibility_updated",
                "idx_library_prompt_definitions_tenant_app_visibility_updated",
            ),
            (
                "idx_prompts_branch_latest",
                "idx_library_prompt_definitions_branch_latest",
            ),
        ),
    ),
    (
        "schemas",
        "library_output_schema_definitions",
        (
            (
                "uq_schema_branch_version",
                "uq_library_output_schema_definition_branch_version",
            ),
            (
                "idx_schemas_tenant",
                "idx_library_output_schema_definitions_tenant",
            ),
            (
                "idx_schemas_tenant_user",
                "idx_library_output_schema_definitions_tenant_user",
            ),
            (
                "idx_schemas_tenant_app",
                "idx_library_output_schema_definitions_tenant_app",
            ),
            (
                "idx_schemas_tenant_user_app_updated",
                "idx_library_output_schema_definitions_tenant_user_app_updated",
            ),
            (
                "idx_schemas_tenant_app_visibility_updated",
                "idx_library_output_schema_definitions_tenant_app_visibility_updated",
            ),
            (
                "idx_schemas_branch_latest",
                "idx_library_output_schema_definitions_branch_latest",
            ),
        ),
    ),
    (
        "adversarial_test_cases",
        "library_adversarial_test_cases",
        (
            (
                "idx_adversarial_test_cases_tenant_user",
                "idx_library_adversarial_test_cases_tenant_user",
            ),
            (
                "idx_adversarial_test_cases_tenant_app",
                "idx_library_adversarial_test_cases_tenant_app",
            ),
        ),
    ),
    (
        "listings",
        "evaluation_datasets",
        (
            ("idx_listings_updated_at", "idx_evaluation_datasets_updated_at"),
            ("idx_listings_tenant", "idx_evaluation_datasets_tenant"),
            (
                "idx_listings_tenant_user",
                "idx_evaluation_datasets_tenant_user",
            ),
            (
                "idx_listings_tenant_app",
                "idx_evaluation_datasets_tenant_app",
            ),
            (
                "idx_listings_tenant_user_app_updated",
                "idx_evaluation_datasets_tenant_user_app_updated",
            ),
            (
                "ix_listings_app_id",
                "ix_platform_evaluation_datasets_app_id",
            ),
        ),
    ),
    (
        "files",
        "application_uploaded_files",
        (
            ("idx_files_tenant", "idx_application_uploaded_files_tenant"),
            (
                "idx_files_tenant_user",
                "idx_application_uploaded_files_tenant_user",
            ),
        ),
    ),
    (
        "tags",
        "application_tags",
        (
            ("uq_tag", "uq_application_tag"),
            ("idx_tags_tenant", "idx_application_tags_tenant"),
            ("idx_tags_tenant_user", "idx_application_tags_tenant_user"),
            ("idx_tags_tenant_app", "idx_application_tags_tenant_app"),
            (
                "idx_tags_tenant_user_app_name",
                "idx_application_tags_tenant_user_app_name",
            ),
        ),
    ),
)


def upgrade() -> None:
    assert len(_TABLE_RENAMES) == 6, (
        f"expected 6 table renames per plan §5, got {len(_TABLE_RENAMES)}"
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
