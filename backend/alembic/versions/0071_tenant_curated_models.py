"""tenant_curated_models — per-tenant non-Azure model allowlist

Revision ID: 0071
Revises: 0070
Create Date: 2026-05-21
"""
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0071"
down_revision: Union[str, None] = "0070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_curated_models",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("credential_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("canonical_model_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"],
            ["platform.tenant_llm_credentials.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["canonical_model_id"],
            ["analytics.ref_llm_models_catalog.id"],
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "credential_id", "canonical_model_id", name="uq_tenant_curated_model"
        ),
        schema="platform",
    )
    op.create_index(
        "idx_tenant_curated_models_credential",
        "tenant_curated_models",
        ["credential_id"],
        schema="platform",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_tenant_curated_models_credential",
        table_name="tenant_curated_models",
        schema="platform",
    )
    op.drop_table("tenant_curated_models", schema="platform")
