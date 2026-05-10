"""sherlock v3 — sherlock_state + sherlock_evidence

Revision ID: 0035_sherlock_v3_state_evidence
Revises: 0034_invite_link_drop_is_active
Create Date: 2026-05-09

Adds the two new persistence surfaces required by Sherlock v3:

  * ``platform.sherlock_state`` — a small one-row-per-chat table holding cross
    -turn structured state (resolved entities, active filters, pointers to the
    last artifact and last specialist call). Replaces the 17-key,
    ~21KB-per-chat scratchpad that lives on
    ``platform.sherlock_agent_sessions.scratchpad`` today.

  * ``platform.sherlock_evidence`` — append-only ledger of evidence rows
    (sql_row / vector_chunk / kg_triple / action_receipt / doc_excerpt) emitted
    by specialists. Supervisor passes ``ref_id`` references between specialists
    instead of inlining payloads.

The 2026-05-09 P0 spike (docs/spikes/2026-05-09-…) closed NO-GO on the
Conversations API — Azure does not expose it. Continuation in v3 uses
``previous_response_id`` chains; the chain head is already persisted on
``platform.sherlock_agent_sessions.last_response_id`` (column added in an
earlier migration). No new column is needed for that, so this revision only
touches the two new tables.

Cross-schema FKs to ``platform.tenants/users/chat_sessions`` are intentional —
``platform`` is the canonical owner schema for these dimensions per
roadmap-01.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0035_sherlock_v3_state_evidence"
down_revision: Union[str, None] = "0034_invite_link_drop_is_active"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sherlock_state",
        sa.Column(
            "chat_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.chat_sessions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("app_id", sa.Text(), nullable=False),
        sa.Column(
            "resolved_entities",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "active_filters",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("last_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "last_specialist_call_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="platform",
    )
    op.create_index(
        "idx_sherlock_state_tenant_user_app",
        "sherlock_state",
        ["tenant_id", "user_id", "app_id"],
        schema="platform",
    )

    op.create_table(
        "sherlock_evidence",
        sa.Column(
            "ref_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "chat_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.chat_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("app_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("locator", postgresql.JSONB(), nullable=False),
        sa.Column("snippet", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="platform",
    )
    op.create_index(
        "idx_sherlock_evidence_session",
        "sherlock_evidence",
        ["chat_session_id", "created_at"],
        schema="platform",
    )
    op.create_index(
        "idx_sherlock_evidence_tenant_user_app",
        "sherlock_evidence",
        ["tenant_id", "user_id", "app_id", "created_at"],
        schema="platform",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_sherlock_evidence_tenant_user_app",
        table_name="sherlock_evidence",
        schema="platform",
    )
    op.drop_index(
        "idx_sherlock_evidence_session",
        table_name="sherlock_evidence",
        schema="platform",
    )
    op.drop_table("sherlock_evidence", schema="platform")

    op.drop_index(
        "idx_sherlock_state_tenant_user_app",
        table_name="sherlock_state",
        schema="platform",
    )
    op.drop_table("sherlock_state", schema="platform")
