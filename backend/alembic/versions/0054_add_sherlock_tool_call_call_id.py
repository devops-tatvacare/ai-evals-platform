"""add analytics.log_sherlock_tool_call.call_id

Revision ID: 0054
Revises: 0053
Create Date: 2026-05-19

Stamps the OpenAI Agents SDK's tool_call_id (e.g. ``call_BD3jd…``) on
every audit row so the chat widget's "View full trace" deep-link can
resolve back to the row using the identifier it already has on the SSE
wire. Pre-this-PR the link was sending ``call_XXX`` strings to a route
that expected the row's UUID PK — Pydantic raised "invalid character"
on every click.

The admin route accepts either the row UUID OR the call_id string; the
service tries UUID first and falls back to call_id lookup. Existing
rows have NULL call_id (audit predates the column); only deep-links
from rows written after this migration resolve.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0054'
down_revision: Union[str, None] = '0053'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'log_sherlock_tool_call',
        sa.Column('call_id', sa.Text(), nullable=True),
        schema='analytics',
    )
    op.create_index(
        'idx_atl_call_id',
        'log_sherlock_tool_call',
        ['call_id'],
        schema='analytics',
    )


def downgrade() -> None:
    op.drop_index(
        'idx_atl_call_id',
        table_name='log_sherlock_tool_call',
        schema='analytics',
    )
    op.drop_column(
        'log_sherlock_tool_call',
        'call_id',
        schema='analytics',
    )
