"""sherlock v3 — platform.sherlock_verified_queries (Phase 2A)

Revision ID: 0036_sherlock_verified_queries
Revises: 0035_sherlock_v3_state_evidence
Create Date: 2026-05-10

DB-backed verified question→SQL pairs that the data_specialist retrieves at
turn time and renders into its prompt as few-shot exemplars. Replaces the
hand-edited Python list in ``sherlock_v3/exemplars.py`` (Phase 2A §2.3).

Scope: rows are visible to the data_specialist when ``app_id`` matches and
either ``tenant_id = SYSTEM_TENANT_ID`` (global seed/admin rows) OR
``tenant_id`` matches the active tenant. ``enabled`` gates retrieval.

Lexical retrieval (token-Jaccard against ``normalized_question``) lives in
``app/services/sherlock_v3/verified_queries.py``; the column exists so the
generator stays deterministic and so a future pgvector phase can add an
``embedding`` column alongside without re-shaping rows.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0036_sherlock_verified_queries"
down_revision: Union[str, None] = "0035_sherlock_v3_state_evidence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sherlock_verified_queries",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("app_id", sa.Text(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("normalized_question", sa.Text(), nullable=False),
        sa.Column("sql", sa.Text(), nullable=False),
        sa.Column(
            "source",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'seed'"),
        ),
        sa.Column(
            "verified_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "verified_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "use_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "source IN ('seed','admin','user_thumbs_up')",
            name="sherlock_verified_queries_source_check",
        ),
        schema="platform",
    )
    op.create_index(
        "idx_sherlock_verified_queries_app_enabled",
        "sherlock_verified_queries",
        ["app_id", "enabled"],
        schema="platform",
    )
    op.create_index(
        "idx_sherlock_verified_queries_tenant_app_enabled",
        "sherlock_verified_queries",
        ["tenant_id", "app_id", "enabled"],
        schema="platform",
    )
    op.create_unique_constraint(
        "uq_sherlock_verified_queries_tenant_app_question",
        "sherlock_verified_queries",
        ["tenant_id", "app_id", "normalized_question"],
        schema="platform",
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_sherlock_verified_queries_tenant_app_question",
        "sherlock_verified_queries",
        schema="platform",
        type_="unique",
    )
    op.drop_index(
        "idx_sherlock_verified_queries_tenant_app_enabled",
        table_name="sherlock_verified_queries",
        schema="platform",
    )
    op.drop_index(
        "idx_sherlock_verified_queries_app_enabled",
        table_name="sherlock_verified_queries",
        schema="platform",
    )
    op.drop_table("sherlock_verified_queries", schema="platform")
