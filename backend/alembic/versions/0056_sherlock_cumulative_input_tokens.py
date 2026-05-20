"""add platform.sherlock_agent_sessions.cumulative_input_tokens

Revision ID: 0056
Revises: 0055
Create Date: 2026-05-19

Tracks the running input-token total across all turns since the last
server-side compaction event. Drives the chat widget's "context
filling" progress pill (renders once ratio crosses
CONTEXT_PROGRESS_START_RATIO from
``app/services/sherlock_v3/compaction.py``) and resets to zero when a
``compaction_emitted`` event fires.

Non-null, default 0 — fresh sessions start empty; existing rows
populate to 0 on upgrade.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0056'
down_revision: Union[str, None] = '0055'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'sherlock_agent_sessions',
        sa.Column(
            'cumulative_input_tokens',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('0'),
        ),
        schema='platform',
    )


def downgrade() -> None:
    op.drop_column(
        'sherlock_agent_sessions',
        'cumulative_input_tokens',
        schema='platform',
    )
