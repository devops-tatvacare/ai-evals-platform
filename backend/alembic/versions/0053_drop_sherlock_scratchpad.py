"""drop platform.sherlock_agent_sessions.scratchpad

Revision ID: 0053
Revises: 0052
Create Date: 2026-05-18

Completes Gap 7 (sherlock_v3-status). The scratchpad JSONB carried the
legacy 17-key blob the v2 chat_engine used for cross-turn memory. v3 never
read its keys (all reads were opaque dict plumbing through
``SherlockAgentSessionState``); structured cross-turn memory now lives in
``platform.sherlock_state`` (added in migration 0035) with one row per
chat_session and only two mutable fields — ``resolved_entities`` and
``active_filters`` — populated by ``state_delta`` from SpecialistResult.

Code paths updated in the same commit:
  * ``app/models/sherlock_runtime.py`` — column dropped from the ORM.
  * ``app/services/report_builder/runtime_store.py`` — field dropped from
    ``SherlockAgentSessionState`` + ``save_runtime_state`` signature.
  * ``app/routes/report_builder.py`` — caller dropped the kwarg.
  * ``app/services/sherlock_v3/{runtime,turn_orchestrator,supervisor,
    data_specialist,data_specialist_prompt,state_store}.py`` — wire
    state_delta end-to-end.

Downgrade re-adds the column with the legacy fat default for replay
parity. ``sherlock_state`` rows survive downgrade (the column drop doesn't
affect that table).
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0053'
down_revision: Union[str, None] = '0052'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_LEGACY_SCRATCHPAD_DEFAULT = (
    '{"findings": [], "errors": [], "discovery": null, "lookups": {}, '
    '"resolved_entities": {}, "active_filters": {}, '
    '"discovered_schema": {"tables_inspected": [], "columns_by_table": {}, '
    '"relations_found": [], "json_structures": {}}, '
    '"last_analysis": null, "analysis_history": [], '
    '"last_evidence": null, "last_data_check": null}'
)


def upgrade() -> None:
    op.drop_column(
        'sherlock_agent_sessions',
        'scratchpad',
        schema='platform',
    )


def downgrade() -> None:
    op.add_column(
        'sherlock_agent_sessions',
        sa.Column(
            'scratchpad',
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text(f"'{_LEGACY_SCRATCHPAD_DEFAULT}'::jsonb"),
            nullable=False,
        ),
        schema='platform',
    )
