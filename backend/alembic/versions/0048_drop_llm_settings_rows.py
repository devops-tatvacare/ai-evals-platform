"""drop the orphaned platform.application_settings llm-settings rows

Revision ID: 0048
Revises: 0047
Create Date: 2026-05-16

Phase 3 of docs/plans/2026-05-14-llm-credentials-byok/.

0047 backfilled platform.tenant_llm_providers from these rows. All readers
are gone:
  - Backend (Phase 1) — settings_helper deleted, every call site rewired
    to resolve_llm_credentials.
  - Frontend (Phase 3) — src/stores/llmSettingsStore deleted along with
    every consumer.

Downgrade is a no-op: the encrypted credentials still live in
tenant_llm_providers, so re-introducing the legacy rows would be a
duplicate source of truth. If you ever need to recover them, rebuild from
tenant_llm_providers manually.

Schema-qualifies the DELETE per the Roadmap 01 invariant.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text("DELETE FROM platform.application_settings WHERE key = 'llm-settings'")
    )


def downgrade() -> None:
    # See module docstring: tenant_llm_providers is the canonical source. Re-
    # inserting llm-settings rows would create drift between two stores of the
    # same credentials.
    pass
