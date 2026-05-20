"""create platform.tenant_call_site_defaults + seed platform defaults
+ tenant-specific Sherlock rows for Azure tenants.

Revision ID: 0051
Revises: 0050
Create Date: 2026-05-18

Phase 2 of docs/plans/2026-05-18-llm-call-site-architecture/.

Schema-qualifies every raw SQL statement per the Roadmap-01 invariant.

**Postgres version note:** ``UNIQUE NULLS NOT DISTINCT`` requires Postgres
15+. The fallback (two partial unique indexes) is documented in the plan's
Task 2 if a prod is ever on 14 or earlier. The migration emits a typed error
on older versions instead of silently producing the wrong constraint shape.

Upgrade flow:
  1. Create the table.
  2. Seed 11 platform-default rows (``tenant_id IS NULL``) — one per
     registered call site. Each row is gated on the catalog FK target
     existing; absent catalog rows produce WARNINGs only (operator must
     map via /platform/llm/defaults after upgrade).
  3. For every tenant with an enabled ``azure_openai`` credential, seed
     tenant-specific ``analytics_supervisor`` / ``analytics_specialist``
     rows pointing at the current Sherlock env-var deployment names
     (``SHERLOCK_SUPERVISOR_MODEL`` / ``SHERLOCK_SPECIALIST_MODEL``,
     falling back to ``ai-evals-gpt-5.4`` / ``ai-evals-gpt-5.4-mini`` if
     unset). Preserves today's Azure-first Sherlock behavior after the
     env vars are deleted in this same phase.

Downgrade: DROP TABLE — discards every admin-edited default. Operator must
re-seed manually if they downgrade past this point.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0051"
down_revision: Union[str, None] = "0050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_log = logging.getLogger("alembic.runtime.migration")


# (call_site, provider, credential_name, model_or_deployment). Mirrors the
# README's platform-defaults table. Phase-1 migration 0050 seeded the catalog
# rows these reference, so the FK target check below should always succeed in
# a fresh DB; the WARNING branch protects against partial / drifted catalogs.
_PLATFORM_DEFAULTS: list[tuple[str, str, str, str]] = [
    ("chat_text", "openai", "default", "gpt-4o"),
    ("chat_vision", "openai", "default", "gpt-4o"),
    ("chat_reasoning", "openai", "default", "o3-mini"),
    ("audio_transcription", "openai", "default", "gpt-4o-transcribe"),
    ("audio_synthesis", "openai", "default", "gpt-4o-mini-tts"),
    ("evaluator_draft", "gemini", "default", "gemini-2.5-flash"),
    ("lead_signal_extraction", "gemini", "default", "gemini-2.5-flash"),
    ("report_generation", "gemini", "default", "gemini-2.5-pro"),
    ("analytics_supervisor", "openai", "default", "gpt-5"),
    ("analytics_specialist", "openai", "default", "gpt-5-mini"),
    ("assist_prompt_or_schema", "openai", "default", "gpt-4o"),
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _check_postgres_15_plus(bind) -> None:
    row = bind.execute(sa.text("SHOW server_version_num")).first()
    if row is None:
        return
    try:
        version_num = int(row[0])
    except (TypeError, ValueError):
        return
    if version_num < 150000:
        raise RuntimeError(
            "Migration 0051 requires Postgres 15+ for UNIQUE NULLS NOT DISTINCT. "
            f"Detected server_version_num={version_num}. Either upgrade Postgres or "
            "switch this migration to the partial-unique-index fallback documented in "
            "docs/plans/2026-05-18-llm-call-site-architecture/phase-2-call-sites-and-defaults.md."
        )


def upgrade() -> None:
    bind = op.get_bind()
    _check_postgres_15_plus(bind)

    op.create_table(
        "tenant_call_site_defaults",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("call_site", sa.String(length=64), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column(
            "credential_name",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'default'"),
        ),
        sa.Column("model_or_deployment", sa.Text(), nullable=False),
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
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["platform.tenants.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["platform.users.id"], ondelete="SET NULL"
        ),
        schema="platform",
    )
    # UNIQUE NULLS NOT DISTINCT is Postgres 15+ only; SQLAlchemy's
    # UniqueConstraint(postgresql_nulls_not_distinct=...) emits the correct
    # ALTER TABLE form on Postgres 15+. Issue it as raw SQL so the migration
    # produces the same SQL regardless of SQLAlchemy version on the runtime.
    op.execute(
        sa.text(
            "ALTER TABLE platform.tenant_call_site_defaults "
            "ADD CONSTRAINT uq_tenant_call_site_defaults "
            "UNIQUE NULLS NOT DISTINCT (tenant_id, call_site)"
        )
    )
    op.create_index(
        "idx_tenant_call_site_defaults_tenant",
        "tenant_call_site_defaults",
        ["tenant_id"],
        schema="platform",
    )
    op.create_index(
        "idx_tenant_call_site_defaults_call_site",
        "tenant_call_site_defaults",
        ["call_site"],
        schema="platform",
    )

    _seed_platform_defaults(bind)
    _seed_tenant_sherlock_defaults(bind)


def _seed_platform_defaults(bind) -> None:
    """Insert one ``tenant_id IS NULL`` row per registered call site, gated on
    the catalog row existing."""
    now = _now()
    for call_site, provider, credential_name, model in _PLATFORM_DEFAULTS:
        catalog = bind.execute(
            sa.text(
                """
                SELECT 1 FROM analytics.ref_llm_models_catalog
                 WHERE provider = :provider AND model = :model
                 LIMIT 1
                """
            ),
            {"provider": provider, "model": model},
        ).first()
        if not catalog:
            _log.warning(
                "0051: skipping platform default for call_site=%s — "
                "catalog row %s/%s missing; operator must configure via "
                "/platform/llm/defaults after upgrade",
                call_site, provider, model,
            )
            continue
        bind.execute(
            sa.text(
                """
                INSERT INTO platform.tenant_call_site_defaults
                    (id, tenant_id, call_site, provider, credential_name,
                     model_or_deployment, created_at, updated_at)
                VALUES
                    (:id, NULL, :call_site, :provider, :credential_name,
                     :model, :now, :now)
                ON CONFLICT ON CONSTRAINT uq_tenant_call_site_defaults DO NOTHING
                """
            ),
            {
                "id": uuid.uuid4(),
                "call_site": call_site,
                "provider": provider,
                "credential_name": credential_name,
                "model": model,
                "now": now,
            },
        )


def _seed_tenant_sherlock_defaults(bind) -> None:
    """For every tenant with an enabled Azure credential, insert
    ``analytics_supervisor`` and ``analytics_specialist`` rows pointing at the
    current env-var deployment names. Preserves today's Sherlock behavior
    after the env vars are deleted in the same phase.

    Falls back to the legacy literal deployment names (``ai-evals-gpt-5.4`` /
    ``ai-evals-gpt-5.4-mini``) if the env vars are unset on this Alembic-runner
    host. Operators on prod should run this migration on a worker that has the
    same env block as the Sherlock runtime had pre-Phase-2.
    """
    supervisor_model = os.getenv("SHERLOCK_SUPERVISOR_MODEL", "ai-evals-gpt-5.4")
    specialist_model = os.getenv("SHERLOCK_SPECIALIST_MODEL", "ai-evals-gpt-5.4-mini")
    now = _now()

    rows = bind.execute(
        sa.text(
            """
            SELECT DISTINCT tenant_id
              FROM platform.tenant_llm_credentials
             WHERE provider = 'azure_openai' AND is_enabled = true
            """
        )
    ).all()

    if not rows:
        _log.info("0051: no tenants with enabled azure_openai credentials; skipping Sherlock tenant seed")
        return

    for (tenant_id,) in rows:
        for call_site, model in (
            ("analytics_supervisor", supervisor_model),
            ("analytics_specialist", specialist_model),
        ):
            bind.execute(
                sa.text(
                    """
                    INSERT INTO platform.tenant_call_site_defaults
                        (id, tenant_id, call_site, provider, credential_name,
                         model_or_deployment, created_at, updated_at)
                    VALUES
                        (:id, :tenant_id, :call_site, 'azure_openai', 'default',
                         :model, :now, :now)
                    ON CONFLICT ON CONSTRAINT uq_tenant_call_site_defaults DO NOTHING
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "tenant_id": tenant_id,
                    "call_site": call_site,
                    "model": model,
                    "now": now,
                },
            )
        _log.info(
            "0051: seeded Sherlock tenant defaults for tenant=%s (supervisor=%s, specialist=%s)",
            tenant_id, supervisor_model, specialist_model,
        )


def downgrade() -> None:
    op.drop_index(
        "idx_tenant_call_site_defaults_call_site",
        table_name="tenant_call_site_defaults",
        schema="platform",
    )
    op.drop_index(
        "idx_tenant_call_site_defaults_tenant",
        table_name="tenant_call_site_defaults",
        schema="platform",
    )
    op.drop_table("tenant_call_site_defaults", schema="platform")
