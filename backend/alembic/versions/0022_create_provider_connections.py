"""create orchestration.provider_connections

Phase 10 commit 1 — first-class tenant+app-scoped credential rows for the
orchestration node engine. Replaces the env-var rollout (BOLNA_*, WATI_*,
LSQ_*, MSG91_*, AISENSY_*) with per-connection encrypted config blobs.

All raw SQL is schema-qualified per the post-roadmap-01 invariant.

Revision ID: 0022_create_provider_connections
Revises: 0021_fix_evaluators_seed_scope_index
Create Date: 2026-04-30
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0022_create_provider_connections"
down_revision: Union[str, None] = "0021_fix_evaluators_seed_scope_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE orchestration.provider_connections (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            provider VARCHAR(32) NOT NULL,
            name VARCHAR(200) NOT NULL,
            config_encrypted BYTEA NOT NULL,
            webhook_token VARCHAR(64),
            active BOOLEAN NOT NULL DEFAULT true,
            last_used_at TIMESTAMPTZ,
            created_by UUID NOT NULL REFERENCES platform.users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_provider_connections_scope_provider_name
                UNIQUE (tenant_id, app_id, provider, name)
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_provider_connections_webhook_token "
        "ON orchestration.provider_connections (webhook_token) "
        "WHERE webhook_token IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX idx_provider_connections_tenant_app_provider_active "
        "ON orchestration.provider_connections (tenant_id, app_id, provider) "
        "WHERE active"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS orchestration.idx_provider_connections_tenant_app_provider_active")
    op.execute("DROP INDEX IF EXISTS orchestration.uq_provider_connections_webhook_token")
    op.execute("DROP TABLE IF EXISTS orchestration.provider_connections")
