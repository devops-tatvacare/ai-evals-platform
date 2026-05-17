"""rename tenant_llm_providers → tenant_llm_credentials, add deployments,
add supports_structured_output to ref_llm_models_catalog, seed curated
catalog rows for the call-site default seeds (Phase 2).

Revision ID: 0050
Revises: 0049_signal_definition_execution_mode
Create Date: 2026-05-18

Phase 1 of docs/plans/2026-05-18-llm-call-site-architecture/.

This single revision lands the credential reshape that the rest of Phase 1
depends on. Splitting credential rename from deployments would force a
back-compat shim, which violates the no-legacy-scaffolding invariant.

Schema-qualifies every raw SQL statement per the Roadmap-01 invariant
(``platform.tenant_llm_credentials``, ``platform.tenant_llm_deployments``,
``analytics.ref_llm_models_catalog``, ``analytics.ref_llm_model_alias``).

Upgrade flow:
 1. Snapshot the pre-rename rows + curated_models arrays.
 2. Rename ``platform.tenant_llm_providers`` → ``platform.tenant_llm_credentials``.
 3. Add ``name VARCHAR(64) NOT NULL DEFAULT 'default'``,
    ``secret_blob_encrypted BYTEA NULL`` (nullable during backfill).
 4. Re-encrypt each row's ``api_key_encrypted`` as
    ``Fernet(JSON({"api_key": "<plaintext>"}))`` into
    ``secret_blob_encrypted``. For Azure with a non-null ``base_url``,
    fold the value into ``extra_config.base_url`` before dropping the
    column.
 5. ``ALTER COLUMN secret_blob_encrypted SET NOT NULL`` once every row
    is filled.
 6. Drop ``api_key_encrypted``, ``base_url``, ``curated_models``.
 7. Drop old unique constraint, add ``(tenant_id, provider, name)``.
 8. Rename the tenant-index for consistency.
 9. Create ``platform.tenant_llm_deployments``.
 10. Backfill deployments for every Azure credential — three-tier
     resolution (alias row → exact catalog model → leave unmapped).
     Auto-write ``analytics.ref_llm_model_alias`` rows for resolved
     deployments.
 11. Add ``analytics.ref_llm_models_catalog.supports_structured_output``
     (Phase 2 capability helper depends on this column).
 12. Seed the curated catalog rows Phase 2's default-call-site seed will
     reference, so the catalog FK target exists before any tenant default
     is written.

Downgrade is intentionally narrow: the deployments table is dropped
(destructive — any post-upgrade deployment edits are lost), the catalog
column is dropped, and the credential table is renamed back. The
secret_blob_encrypted column cannot be losslessly reversed (the legacy
column held a string token, not a JSON blob), so downgrade re-creates
``api_key_encrypted`` populated from ``{secret["api_key"]}`` when present
and ``''`` otherwise — best effort.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0050"
down_revision: Union[str, None] = "0049_signal_definition_execution_mode"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_log = logging.getLogger("alembic.runtime.migration")


# ── Curated catalog rows seeded inline ───────────────────────────────
#
# Phase 2's ``0051`` migration writes ``tenant_call_site_defaults`` rows that
# FK into ``analytics.ref_llm_models_catalog``. Alembic runs before
# ``seed_all_defaults`` at lifespan startup, so a runtime seed file cannot
# satisfy that FK on a fresh DB. We seed inline here.
#
# Capability flags are mirrored from models.dev as of 2026-05-18. The list
# is intentionally narrow — only models actually referenced by Phase 2's
# default call-site seed need to exist here. ``models_dev_refresh`` will
# re-upsert these rows with fresh data on the next refresh; the structure
# of the migration ensures it's safe to re-run.
_SEED_CATALOG: list[dict[str, Any]] = [
    {
        "provider_key": "openai",
        "provider": "openai",
        "model_id": "gpt-4o",
        "model": "gpt-4o",
        "display_name": "GPT-4o",
        "family": "gpt",
        "context_limit": 128000,
        "output_limit": 16384,
        "supports_reasoning": False,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": True,
        "modalities_input": ["text", "image", "pdf"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "openai",
        "provider": "openai",
        "model_id": "gpt-4o-mini",
        "model": "gpt-4o-mini",
        "display_name": "GPT-4o mini",
        "family": "gpt",
        "context_limit": 128000,
        "output_limit": 16384,
        "supports_reasoning": False,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": True,
        "modalities_input": ["text", "image", "pdf"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "openai",
        "provider": "openai",
        "model_id": "gpt-4o-transcribe",
        "model": "gpt-4o-transcribe",
        "display_name": "GPT-4o transcribe",
        "family": "gpt",
        "context_limit": 16000,
        "output_limit": 2048,
        "supports_reasoning": False,
        "supports_tool_call": False,
        "supports_attachment": True,
        "supports_structured_output": False,
        "modalities_input": ["audio", "text"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "openai",
        "provider": "openai",
        "model_id": "gpt-4o-mini-tts",
        "model": "gpt-4o-mini-tts",
        "display_name": "GPT-4o mini TTS",
        "family": "gpt",
        "context_limit": 2000,
        "output_limit": 0,
        "supports_reasoning": False,
        "supports_tool_call": False,
        "supports_attachment": False,
        "supports_structured_output": False,
        "modalities_input": ["text"],
        "modalities_output": ["audio"],
    },
    {
        "provider_key": "openai",
        "provider": "openai",
        "model_id": "o3-mini",
        "model": "o3-mini",
        "display_name": "o3-mini",
        "family": "o-series",
        "context_limit": 200000,
        "output_limit": 100000,
        "supports_reasoning": True,
        "supports_tool_call": True,
        "supports_attachment": False,
        "supports_structured_output": True,
        "modalities_input": ["text"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "openai",
        "provider": "openai",
        "model_id": "gpt-5",
        "model": "gpt-5",
        "display_name": "GPT-5",
        "family": "gpt-5",
        "context_limit": 400000,
        "output_limit": 128000,
        "supports_reasoning": True,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": True,
        "modalities_input": ["text", "image", "pdf"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "openai",
        "provider": "openai",
        "model_id": "gpt-5-mini",
        "model": "gpt-5-mini",
        "display_name": "GPT-5 mini",
        "family": "gpt-5",
        "context_limit": 400000,
        "output_limit": 128000,
        "supports_reasoning": True,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": True,
        "modalities_input": ["text", "image", "pdf"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "google",
        "provider": "gemini",
        "model_id": "gemini-2.5-flash",
        "model": "gemini-2.5-flash",
        "display_name": "Gemini 2.5 Flash",
        "family": "gemini-flash",
        "context_limit": 1048576,
        "output_limit": 65536,
        "supports_reasoning": True,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": True,
        "modalities_input": ["text", "image", "audio", "video", "pdf"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "google",
        "provider": "gemini",
        "model_id": "gemini-2.5-pro",
        "model": "gemini-2.5-pro",
        "display_name": "Gemini 2.5 Pro",
        "family": "gemini-pro",
        "context_limit": 1048576,
        "output_limit": 65536,
        "supports_reasoning": True,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": True,
        "modalities_input": ["text", "image", "audio", "video", "pdf"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "anthropic",
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-5",
        "model": "claude-sonnet-4-5",
        "display_name": "Claude Sonnet 4.5",
        "family": "claude-sonnet",
        "context_limit": 200000,
        "output_limit": 64000,
        "supports_reasoning": True,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": False,
        "modalities_input": ["text", "image", "pdf"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "anthropic",
        "provider": "anthropic",
        "model_id": "claude-haiku-4-5",
        "model": "claude-haiku-4-5",
        "display_name": "Claude Haiku 4.5",
        "family": "claude-haiku",
        "context_limit": 200000,
        "output_limit": 64000,
        "supports_reasoning": True,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": False,
        "modalities_input": ["text", "image", "pdf"],
        "modalities_output": ["text"],
    },
    # Bedrock + Vertex placeholder rows so Phase 2 call-site seeds that name a
    # Bedrock-hosted Claude or Vertex-hosted Gemini have a FK target. These
    # carry provider='bedrock'/'vertex' to differentiate from the upstream
    # entries above — pricing rows live under upstream provider keys.
    {
        "provider_key": "anthropic",
        "provider": "bedrock",
        "model_id": "anthropic.claude-sonnet-4-5-20250929-v1:0",
        "model": "anthropic.claude-sonnet-4-5-20250929-v1:0",
        "display_name": "Claude Sonnet 4.5 (Bedrock)",
        "family": "claude-sonnet",
        "context_limit": 200000,
        "output_limit": 64000,
        "supports_reasoning": True,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": False,
        "modalities_input": ["text", "image", "pdf"],
        "modalities_output": ["text"],
    },
    {
        "provider_key": "google",
        "provider": "vertex",
        "model_id": "gemini-2.5-pro",
        "model": "gemini-2.5-pro",
        "display_name": "Gemini 2.5 Pro (Vertex)",
        "family": "gemini-pro",
        "context_limit": 1048576,
        "output_limit": 65536,
        "supports_reasoning": True,
        "supports_tool_call": True,
        "supports_attachment": True,
        "supports_structured_output": True,
        "modalities_input": ["text", "image", "audio", "video", "pdf"],
        "modalities_output": ["text"],
    },
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def upgrade() -> None:  # noqa: C901 — one cohesive reshape, splitting hides it
    bind = op.get_bind()

    # ── 1. Snapshot pre-rename rows (for the secret + deployment backfill) ──
    pre_rows = bind.execute(
        sa.text(
            """
            SELECT id, tenant_id, provider, is_enabled, api_key_encrypted,
                   base_url, extra_config, curated_models, validation_status,
                   last_validated_at, updated_by, updated_at
              FROM platform.tenant_llm_providers
            """
        )
    ).mappings().all()

    # ── 2. Rename table + 3. add new columns ───────────────────────────────
    op.rename_table(
        "tenant_llm_providers", "tenant_llm_credentials", schema="platform"
    )
    op.add_column(
        "tenant_llm_credentials",
        sa.Column(
            "name", sa.String(length=64), nullable=False, server_default=sa.text("'default'")
        ),
        schema="platform",
    )
    op.add_column(
        "tenant_llm_credentials",
        sa.Column("secret_blob_encrypted", sa.LargeBinary(), nullable=True),
        schema="platform",
    )

    # ── 4. Backfill secret_blob_encrypted from api_key_encrypted ───────────
    # Folding base_url into extra_config.base_url in the same pass.
    if pre_rows:
        from app.services.llm_credentials.crypto import decrypt_secret, encrypt_json

        for row in pre_rows:
            api_key_token = row["api_key_encrypted"]
            extra_config = dict(row["extra_config"] or {})
            if row["base_url"]:
                extra_config["base_url"] = row["base_url"]
            if api_key_token:
                try:
                    plaintext = decrypt_secret(api_key_token)
                except Exception as exc:
                    _log.warning(
                        "0050: could not decrypt api_key for credential %s "
                        "(provider=%s tenant=%s) — installing empty secret. "
                        "Admin must re-enter the key. Reason: %s",
                        row["id"], row["provider"], row["tenant_id"], exc,
                    )
                    plaintext = ""
            else:
                plaintext = ""
            blob = encrypt_json({"api_key": plaintext})
            bind.execute(
                sa.text(
                    """
                    UPDATE platform.tenant_llm_credentials
                       SET secret_blob_encrypted = :blob,
                           extra_config = CAST(:extra_config AS JSONB)
                     WHERE id = :id
                    """
                ),
                {
                    "blob": blob,
                    "extra_config": json.dumps(extra_config),
                    "id": row["id"],
                },
            )

    # ── 5. Lock secret_blob_encrypted NOT NULL ─────────────────────────────
    op.alter_column(
        "tenant_llm_credentials",
        "secret_blob_encrypted",
        nullable=False,
        schema="platform",
    )

    # ── 6. Drop old columns ────────────────────────────────────────────────
    # Plain drop_column on Postgres — no need for batch_alter_table's table-copy
    # semantics, and avoiding it keeps the just-filled secret_blob_encrypted
    # column visible without an intermediate reflection pass.
    op.drop_column("tenant_llm_credentials", "api_key_encrypted", schema="platform")
    op.drop_column("tenant_llm_credentials", "base_url", schema="platform")
    op.drop_column("tenant_llm_credentials", "curated_models", schema="platform")

    # ── 7. Reshape uniqueness ─────────────────────────────────────────────
    op.drop_constraint(
        "uq_tenant_llm_provider",
        "tenant_llm_credentials",
        type_="unique",
        schema="platform",
    )
    op.create_unique_constraint(
        "uq_tenant_llm_credential",
        "tenant_llm_credentials",
        ["tenant_id", "provider", "name"],
        schema="platform",
    )

    # ── 8. Rename tenant index for naming consistency ──────────────────────
    op.execute(
        sa.text(
            "ALTER INDEX platform.idx_tenant_llm_providers_tenant "
            "RENAME TO idx_tenant_llm_credentials_tenant"
        )
    )

    # ── 9. Create platform.tenant_llm_deployments ──────────────────────────
    op.create_table(
        "tenant_llm_deployments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("credential_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("deployment_name", sa.Text(), nullable=False),
        sa.Column(
            "canonical_model_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column("api_version_override", sa.String(length=64), nullable=True),
        sa.Column(
            "enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "needs_mapping", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"],
            ["platform.tenant_llm_credentials.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["canonical_model_id"],
            ["analytics.ref_llm_models_catalog.id"],
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "credential_id", "deployment_name", name="uq_tenant_llm_deployment_name"
        ),
        schema="platform",
    )
    op.create_index(
        "idx_tenant_llm_deployments_credential",
        "tenant_llm_deployments",
        ["credential_id"],
        schema="platform",
    )
    op.create_index(
        "idx_tenant_llm_deployments_needs_mapping",
        "tenant_llm_deployments",
        ["needs_mapping"],
        unique=False,
        schema="platform",
        postgresql_where=sa.text("needs_mapping = true"),
    )

    # ── 11. Add supports_structured_output BEFORE catalog seed runs so the
    # seed's INSERT column list resolves. (Order swapped vs. docstring 11/12 —
    # the seed writes the column, so it must exist first.) ────────────────
    op.add_column(
        "ref_llm_models_catalog",
        sa.Column(
            "supports_structured_output",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema="analytics",
    )

    # ── 12. Seed curated catalog rows ──────────────────────────────────────
    _seed_catalog_rows(bind)

    # ── 10. Backfill deployments (after catalog seed so resolution can hit) ──
    azure_rows = [r for r in pre_rows if r["provider"] == "azure_openai"]
    for row in azure_rows:
        curated = row["curated_models"] or []
        if isinstance(curated, str):
            curated = json.loads(curated)
        if not curated:
            continue
        credential_id = row["id"]
        tenant_id = row["tenant_id"]
        for deployment_name in curated:
            if not deployment_name:
                continue
            name = str(deployment_name).strip()
            if not name:
                continue
            canonical_model_id, canonical_model = _resolve_deployment(
                bind, tenant_id=tenant_id, deployment_name=name
            )
            needs_mapping = canonical_model_id is None
            bind.execute(
                sa.text(
                    """
                    INSERT INTO platform.tenant_llm_deployments
                        (id, credential_id, deployment_name, canonical_model_id,
                         needs_mapping, enabled, created_at, updated_at)
                    VALUES
                        (:id, :credential_id, :deployment_name, :canonical_model_id,
                         :needs_mapping, true, :now, :now)
                    ON CONFLICT (credential_id, deployment_name) DO NOTHING
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "credential_id": credential_id,
                    "deployment_name": name,
                    "canonical_model_id": canonical_model_id,
                    "needs_mapping": needs_mapping,
                    "now": _now(),
                },
            )
            if canonical_model:
                # Forward declaration → write the cost-tracking alias row.
                bind.execute(
                    sa.text(
                        """
                        INSERT INTO analytics.ref_llm_model_alias
                            (id, tenant_id, provider, observed, canonical, created_at, updated_at)
                        VALUES
                            (:id, :tenant_id, 'azure_openai', :observed, :canonical, :now, :now)
                        ON CONFLICT (tenant_id, provider, observed) DO NOTHING
                        """
                    ),
                    {
                        "id": uuid.uuid4(),
                        "tenant_id": tenant_id,
                        "observed": name,
                        "canonical": canonical_model,
                        "now": _now(),
                    },
                )
            else:
                _log.warning(
                    "0050: deployment '%s' for tenant %s (credential %s) "
                    "needs admin mapping at "
                    "/admin/ai-settings/credentials/%s/deployments",
                    name, tenant_id, credential_id, credential_id,
                )


def _resolve_deployment(
    bind, *, tenant_id: uuid.UUID, deployment_name: str
) -> tuple[uuid.UUID | None, str | None]:
    """Return ``(canonical_model_id, canonical_model)`` or ``(None, None)``.

    Resolution order:
      1. ``analytics.ref_llm_model_alias`` rows the cost-tracking janitor
         may have populated (tenant-scoped first, then NULL-tenant rows).
      2. Exact match against ``analytics.ref_llm_models_catalog`` under
         ``provider='openai'`` — common for "dumb" deployment naming.
    """
    # 1a. tenant-scoped alias
    alias_row = bind.execute(
        sa.text(
            """
            SELECT a.canonical
              FROM analytics.ref_llm_model_alias a
             WHERE a.tenant_id = :tenant_id
               AND a.provider = 'azure_openai'
               AND a.observed = :observed
             LIMIT 1
            """
        ),
        {"tenant_id": tenant_id, "observed": deployment_name},
    ).mappings().first()
    canonical = alias_row["canonical"] if alias_row else None

    # 1b. NULL-tenant alias
    if canonical is None:
        alias_row = bind.execute(
            sa.text(
                """
                SELECT a.canonical
                  FROM analytics.ref_llm_model_alias a
                 WHERE a.tenant_id IS NULL
                   AND a.provider = 'azure_openai'
                   AND a.observed = :observed
                 LIMIT 1
                """
            ),
            {"observed": deployment_name},
        ).mappings().first()
        canonical = alias_row["canonical"] if alias_row else None

    if canonical:
        cat_row = bind.execute(
            sa.text(
                """
                SELECT id, model FROM analytics.ref_llm_models_catalog
                 WHERE provider = 'openai' AND model = :model
                 LIMIT 1
                """
            ),
            {"model": canonical},
        ).mappings().first()
        if cat_row:
            return cat_row["id"], cat_row["model"]

    # 2. exact catalog match against the deployment name itself
    cat_row = bind.execute(
        sa.text(
            """
            SELECT id, model FROM analytics.ref_llm_models_catalog
             WHERE provider = 'openai' AND model = :model
             LIMIT 1
            """
        ),
        {"model": deployment_name},
    ).mappings().first()
    if cat_row:
        return cat_row["id"], cat_row["model"]

    return None, None


def _seed_catalog_rows(bind) -> None:
    """Upsert curated catalog rows so Phase 2's call-site seed has FK targets."""
    now = _now()
    for row in _SEED_CATALOG:
        existing = bind.execute(
            sa.text(
                """
                SELECT id FROM analytics.ref_llm_models_catalog
                 WHERE provider = :provider AND model = :model
                """
            ),
            {"provider": row["provider"], "model": row["model"]},
        ).mappings().first()

        if existing:
            bind.execute(
                sa.text(
                    """
                    UPDATE analytics.ref_llm_models_catalog
                       SET provider_key = :provider_key,
                           model_id = :model_id,
                           display_name = :display_name,
                           family = :family,
                           context_limit = :context_limit,
                           output_limit = :output_limit,
                           supports_reasoning = :supports_reasoning,
                           supports_tool_call = :supports_tool_call,
                           supports_attachment = :supports_attachment,
                           supports_structured_output = :supports_structured_output,
                           modalities_input = CAST(:modalities_input AS TEXT[]),
                           modalities_output = CAST(:modalities_output AS TEXT[]),
                           status = 'active',
                           last_seen_at = :now
                     WHERE id = :id
                    """
                ),
                {
                    **row,
                    "id": existing["id"],
                    "now": now,
                },
            )
        else:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO analytics.ref_llm_models_catalog
                        (id, provider_key, provider, model_id, model,
                         display_name, family, context_limit, output_limit,
                         supports_reasoning, supports_tool_call, supports_attachment,
                         supports_structured_output,
                         modalities_input, modalities_output,
                         open_weights, status, first_seen_at, last_seen_at)
                    VALUES
                        (:id, :provider_key, :provider, :model_id, :model,
                         :display_name, :family, :context_limit, :output_limit,
                         :supports_reasoning, :supports_tool_call, :supports_attachment,
                         :supports_structured_output,
                         CAST(:modalities_input AS TEXT[]),
                         CAST(:modalities_output AS TEXT[]),
                         false, 'active', :now, :now)
                    """
                ),
                {
                    **row,
                    "id": uuid.uuid4(),
                    "now": now,
                },
            )

        # Seed a baseline pricing row at zero cost so the per-call recorder has
        # a pricing_version_id to attach to (otherwise pricing_fallback=true
        # would flag every default-model row until models_dev_refresh runs).
        pricing_exists = bind.execute(
            sa.text(
                """
                SELECT 1 FROM analytics.ref_llm_model_pricing
                 WHERE provider = :provider AND model = :model
                   AND effective_to IS NULL
                 LIMIT 1
                """
            ),
            {"provider": row["provider"], "model": row["model"]},
        ).first()
        if not pricing_exists:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO analytics.ref_llm_model_pricing
                        (id, provider, model, effective_from, effective_to,
                         input_per_1m_usd, cached_read_per_1m_usd,
                         cache_write_5m_per_1m_usd, cache_write_1h_per_1m_usd,
                         output_per_1m_usd, reasoning_per_1m_usd,
                         currency, source, notes, created_at)
                    VALUES
                        (:id, :provider, :model, :now, NULL,
                         0, 0, 0, 0, 0, 0,
                         'USD', 'seed_baseline',
                         'baseline row seeded by alembic 0050; refresh from models.dev',
                         :now)
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "provider": row["provider"],
                    "model": row["model"],
                    "now": now,
                },
            )


def downgrade() -> None:
    """Reverse 0050. Destructive — the deployments table is dropped, and the
    secret blob can only be partially restored to ``api_key_encrypted``
    (because the blob is JSON-shaped while the old column held a plain string).
    """
    bind = op.get_bind()

    # Drop deployments table (and its indexes).
    op.drop_index(
        "idx_tenant_llm_deployments_needs_mapping",
        table_name="tenant_llm_deployments",
        schema="platform",
    )
    op.drop_index(
        "idx_tenant_llm_deployments_credential",
        table_name="tenant_llm_deployments",
        schema="platform",
    )
    op.drop_table("tenant_llm_deployments", schema="platform")

    # Drop catalog column.
    op.drop_column(
        "ref_llm_models_catalog",
        "supports_structured_output",
        schema="analytics",
    )

    # Restore old uniqueness + old index name.
    op.execute(
        sa.text(
            "ALTER INDEX platform.idx_tenant_llm_credentials_tenant "
            "RENAME TO idx_tenant_llm_providers_tenant"
        )
    )
    op.drop_constraint(
        "uq_tenant_llm_credential",
        "tenant_llm_credentials",
        type_="unique",
        schema="platform",
    )

    # Re-add old columns.
    op.add_column(
        "tenant_llm_credentials",
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        schema="platform",
    )
    op.add_column(
        "tenant_llm_credentials",
        sa.Column("base_url", sa.Text(), nullable=True),
        schema="platform",
    )
    op.add_column(
        "tenant_llm_credentials",
        sa.Column(
            "curated_models",
            postgresql.JSONB(),
            nullable=False,
            server_default="[]",
        ),
        schema="platform",
    )

    # Best-effort restore: re-encrypt ``secret["api_key"]`` (if present) into
    # api_key_encrypted. Vertex/Bedrock credentials cannot be expressed in the
    # old shape; their api_key_encrypted will be empty.
    rows = bind.execute(
        sa.text(
            """
            SELECT id, secret_blob_encrypted, extra_config
              FROM platform.tenant_llm_credentials
            """
        )
    ).mappings().all()
    if rows:
        from app.services.llm_credentials.crypto import decrypt_json, encrypt_secret

        for row in rows:
            try:
                payload = decrypt_json(row["secret_blob_encrypted"])
            except Exception as exc:
                _log.warning(
                    "0050 downgrade: cannot decrypt credential %s — leaving api_key empty (%s)",
                    row["id"], exc,
                )
                payload = {}
            extra = dict(row["extra_config"] or {})
            base_url = extra.pop("base_url", None)
            api_key = payload.get("api_key") or ""
            api_key_token = encrypt_secret(api_key) if api_key else None
            bind.execute(
                sa.text(
                    """
                    UPDATE platform.tenant_llm_credentials
                       SET api_key_encrypted = :api_key_token,
                           base_url = :base_url,
                           extra_config = CAST(:extra_config AS JSONB)
                     WHERE id = :id
                    """
                ),
                {
                    "api_key_token": api_key_token,
                    "base_url": base_url,
                    "extra_config": json.dumps(extra),
                    "id": row["id"],
                },
            )

    # Drop the new columns.
    op.drop_column("tenant_llm_credentials", "secret_blob_encrypted", schema="platform")
    op.drop_column("tenant_llm_credentials", "name", schema="platform")

    op.create_unique_constraint(
        "uq_tenant_llm_provider",
        "tenant_llm_credentials",
        ["tenant_id", "provider"],
        schema="platform",
    )

    op.rename_table(
        "tenant_llm_credentials", "tenant_llm_providers", schema="platform"
    )
