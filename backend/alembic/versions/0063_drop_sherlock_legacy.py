"""Drop legacy Sherlock event/audit tables now that platform.sherlock_parts owns the stream.

Revision ID: 0063
Revises: 0062
Create Date: 2026-05-19
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = '0063'
down_revision: Union[str, None] = '0062'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('DROP TABLE IF EXISTS platform.sherlock_turn_events CASCADE')
    op.execute('DROP TABLE IF EXISTS analytics.log_sherlock_tool_call CASCADE')


def downgrade() -> None:
    raise NotImplementedError(
        'Phase 1B drop is one-way; restore by replaying alembic up to 0058 '
        'then re-applying 0061 and the legacy create-table revisions.'
    )
