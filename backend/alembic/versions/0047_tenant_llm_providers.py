"""create platform.tenant_llm_providers + backfill from application_settings

Revision ID: 0047
Revises: 0046_drop_fact_lead_signal_backfill_index
Create Date: 2026-05-14

Phase 1 of docs/plans/2026-05-14-llm-credentials-byok/.

Backfill: for each tenant, take the most-recent application_settings row with
key='llm-settings', explode its per-provider keys into one tenant_llm_providers
row per provider that has a key. Keys are Fernet-encrypted with
LLM_CREDENTIAL_KEY. The old llm-settings rows are NOT deleted here (see 0048
in Phase 3) — full rollback window.

Schema-qualifies every raw SQL statement per the Roadmap 01 invariant.
"""
from __future__ import annotations

import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0047"
down_revision: Union[str, None] = "0046_drop_fact_lead_signal_backfill_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_llm_providers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("base_url", sa.Text(), nullable=True),
        sa.Column("extra_config", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("curated_models", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("validation_status", sa.String(16), nullable=False, server_default="untested"),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["platform.tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["platform.users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("tenant_id", "provider", name="uq_tenant_llm_provider"),
        schema="platform",
    )
    op.create_index(
        "idx_tenant_llm_providers_tenant",
        "tenant_llm_providers",
        ["tenant_id"],
        schema="platform",
    )

    from app.services.llm_credentials.crypto import encrypt_secret

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            """
            SELECT DISTINCT ON (tenant_id) tenant_id, value
            FROM platform.application_settings
            WHERE key = 'llm-settings'
            ORDER BY tenant_id, updated_at DESC
            """
        )
    ).fetchall()

    provider_map = [
        ("geminiApiKey", "gemini"),
        ("openaiApiKey", "openai"),
        ("anthropicApiKey", "anthropic"),
        ("azureOpenaiApiKey", "azure_openai"),
    ]

    for tenant_id, value in rows:
        if not value:
            continue
        if isinstance(value, str):
            value = json.loads(value)
        selected_model = value.get("selectedModel", "")
        for json_key, provider in provider_map:
            api_key = (value.get(json_key) or "").strip()
            if not api_key:
                continue
            extra_config: dict = {}
            base_url: str | None = None
            if provider == "azure_openai":
                extra_config["api_version"] = (
                    value.get("azureOpenaiApiVersion") or "2025-04-01-preview"
                )
                deployments = value.get("azureOpenaiDeployments") or []
                if isinstance(deployments, str):
                    deployments = [d.strip() for d in deployments.split(",") if d.strip()]
                extra_config["deployments"] = deployments
                base_url = value.get("azureOpenaiEndpoint")
                curated = deployments or ([selected_model] if selected_model else [])
            else:
                curated = [selected_model] if selected_model else []
            conn.execute(
                sa.text(
                    """
                    INSERT INTO platform.tenant_llm_providers
                        (id, tenant_id, provider, is_enabled, api_key_encrypted,
                         base_url, extra_config, curated_models, validation_status)
                    VALUES
                        (:id, :tenant_id, :provider, true, :api_key_encrypted,
                         :base_url, CAST(:extra_config AS JSONB), CAST(:curated AS JSONB), 'untested')
                    ON CONFLICT (tenant_id, provider) DO NOTHING
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tenant_id": str(tenant_id),
                    "provider": provider,
                    "api_key_encrypted": encrypt_secret(api_key),
                    "base_url": base_url,
                    "extra_config": json.dumps(extra_config),
                    "curated": json.dumps(curated),
                },
            )


def downgrade() -> None:
    op.drop_index(
        "idx_tenant_llm_providers_tenant",
        table_name="tenant_llm_providers",
        schema="platform",
    )
    op.drop_table("tenant_llm_providers", schema="platform")
