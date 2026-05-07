"""create analytics.log_clinical_action_outbox

Stub queue for clinical orchestration handlers (Phase 9). Each
``clinical.*`` handler enqueues a row keyed on
(tenant_id, recipient_id, idempotency_key); downstream EMR / care-team
consumers poll status='pending' rows, do their work, and update
status='consumed'/'failed'. v1 has no consumers — the outbox row IS
the integration. Real EMR sync is a future phase.

Schema-qualified ``analytics.`` per the project invariant: DB default
search_path is "$user", public, so unqualified names crash boot.

Revision ID: 0020_create_log_clinical_action_outbox
Revises: 0019_create_orchestration_schema
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0020_create_log_clinical_action_outbox"
down_revision: Union[str, None] = "0019_create_orchestration_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE analytics.log_clinical_action_outbox (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
            app_id VARCHAR(64) NOT NULL,
            recipient_id VARCHAR(128) NOT NULL,
            action_type VARCHAR(64) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            idempotency_key VARCHAR(128) NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            consumed_at TIMESTAMPTZ,
            consumed_by VARCHAR(64),
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_log_clinical_action_outbox_idem
                UNIQUE (tenant_id, recipient_id, idempotency_key),
            CONSTRAINT ck_log_clinical_action_outbox_status
                CHECK (status IN ('pending', 'consumed', 'failed'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_log_clinical_action_outbox_pending
            ON analytics.log_clinical_action_outbox
            (tenant_id, app_id, action_type, created_at)
            WHERE status = 'pending'
        """
    )
    op.execute(
        """
        CREATE INDEX idx_log_clinical_action_outbox_recipient
            ON analytics.log_clinical_action_outbox
            (tenant_id, recipient_id, created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS analytics.log_clinical_action_outbox")
