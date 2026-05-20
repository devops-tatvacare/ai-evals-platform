"""Seed loader for orchestration system defaults (templates, provider connections, scheduled poller)."""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.orchestration import WorkflowActionTemplate
from app.models.provider_connection import ProviderConnection
from app.models.scheduled_job import ScheduledJobDefinition
from app.models.tenant import Tenant
from app.services.orchestration.connections import crypto as connection_crypto


_SEEDS_ROOT = Path(__file__).parent / "orchestration_seeds"
_TEMPLATES_DIR = _SEEDS_ROOT / "action_templates"


_log = logging.getLogger(__name__)


# Schedule keys retired by the vendor-abstraction Phase 1 wipe — the seeder defensively
# deletes any rows still present from a pre-cutover DB.
_RETIRED_SCHEDULE_KEYS = (
    "platform:orchestration:resume-waiting-cohorts",
    "platform:orchestration:poll-bolna-executions",
    "platform:orchestration:anomaly-sweep",
)


async def seed_orchestration_defaults(db: AsyncSession) -> None:
    """Insert orchestration system defaults. Idempotent."""
    await _delete_retired_poller_schedules(db)
    await _seed_system_action_templates(db)
    await _bootstrap_default_connections_from_env(db)
    _log.info("orchestration.seed.complete")


# ─── Provider-connection bootstrap (phase 10 commit 1) ──────────────────────


# Provider-specific extractors that turn env vars into the plaintext config
# accepted by ``provider_specs.validate_config``. None means "env not
# configured for this provider — skip bootstrap." Order is fixed so test
# coverage and future providers stay deterministic.
def _env_bolna_config() -> Optional[dict[str, Any]]:
    # api_key + base_url are the credential pair; from_phone is now UI-supplied
    # only (Phase 13 / Phase A). Partial env → "not configured", consistent with
    # the wati/lsq paths.
    if not (settings.BOLNA_API_KEY and settings.BOLNA_BASE_URL):
        return None
    return {
        "api_key": settings.BOLNA_API_KEY,
        "base_url": settings.BOLNA_BASE_URL,
    }


def _env_wati_config() -> Optional[dict[str, Any]]:
    if not (settings.WATI_BASE_URL and settings.WATI_TENANT_ID and settings.WATI_API_TOKEN):
        return None
    return {
        "base_url": settings.WATI_BASE_URL,
        "wati_tenant_id": settings.WATI_TENANT_ID,
        "api_token": settings.WATI_API_TOKEN,
    }


def _env_lsq_config() -> Optional[dict[str, Any]]:
    if not (settings.LSQ_BASE_URL and settings.LSQ_ACCESS_KEY and settings.LSQ_SECRET_KEY):
        return None
    return {
        "access_key": settings.LSQ_ACCESS_KEY,
        "secret_key": settings.LSQ_SECRET_KEY,
        "region_host": settings.LSQ_BASE_URL,
    }


_ENV_BOOTSTRAPPABLE_PROVIDERS: list[tuple[str, Any]] = [
    ("bolna", _env_bolna_config),
    ("wati", _env_wati_config),
    ("lsq", _env_lsq_config),
]


def _bootstrapped_connection_name(provider: str) -> str:
    """Stable, recognizable name so reseed finds the existing row."""
    return f"Default {provider} (env-bootstrapped)"


async def _bootstrap_default_connections_from_env(db: AsyncSession) -> None:
    """Insert one provider_connections row per (SYSTEM_TENANT, app, provider)
    with env-derived plaintext config encrypted at rest. Idempotent: once a
    row exists with the bootstrapped name, env vars are advisory and never
    consulted again.

    Tenants that don't set env vars (the common multi-tenant case) get
    nothing here — they create connections via the UI.

    Skipped when ``ORCHESTRATION_CONNECTION_KEY`` is unset — bootstrap can't
    encrypt without a key, and the boot validator (``_validate_startup_config``)
    already enforces presence in production. Test runs without the key get a
    no-op so existing seed-loader tests keep passing.
    """
    if not settings.ORCHESTRATION_DEFAULT_APP_ID:
        return
    if not settings.ORCHESTRATION_CONNECTION_KEY:
        _log.info(
            "orchestration.connections.bootstrap.skip "
            "reason=ORCHESTRATION_CONNECTION_KEY-not-set"
        )
        return
    app_id = settings.ORCHESTRATION_DEFAULT_APP_ID

    tenant = await db.get(Tenant, SYSTEM_TENANT_ID)
    if tenant is None:
        _log.warning(
            "orchestration.connections.bootstrap.missing_system_tenant tenant_id=%s — skipping",
            SYSTEM_TENANT_ID,
        )
        return

    for provider, config_fn in _ENV_BOOTSTRAPPABLE_PROVIDERS:
        config = config_fn()
        if config is None:
            continue
        name = _bootstrapped_connection_name(provider)
        existing = await db.scalar(
            select(ProviderConnection).where(
                ProviderConnection.tenant_id == SYSTEM_TENANT_ID,
                ProviderConnection.app_id == app_id,
                ProviderConnection.provider == provider,
                ProviderConnection.name == name,
            )
        )
        if existing is not None:
            continue
        # secrets module imported at use-site — bootstrap path should not
        # affect the cold-start of the seed module on tenants with no env.
        import secrets as _secrets

        # Inbound providers (bolna, wati) get a webhook token; lsq does not.
        from app.services.orchestration.connections.provider_specs import get_spec
        spec = get_spec(provider)
        token = _secrets.token_urlsafe(32) if spec.supports_webhook else None

        db.add(
            ProviderConnection(
                id=uuid.uuid4(),
                tenant_id=SYSTEM_TENANT_ID,
                app_id=app_id,
                provider=provider,
                name=name,
                config_encrypted=connection_crypto.encrypt(config),
                webhook_token=token,
                active=True,
                created_by=SYSTEM_USER_ID,
            )
        )
        _log.info(
            "orchestration.connections.bootstrap.inserted provider=%s app_id=%s",
            provider, app_id,
        )
    await db.flush()


async def _seed_system_action_templates(db: AsyncSession) -> None:
    """Load every action_templates/*.json as a system-default template.

    System defaults have tenant_id=NULL + app_id=NULL; the COALESCE-based
    unique index in migration 0019 (uq_workflow_action_templates_*) keys
    them by (channel, slug). On drift the loader updates name +
    payload_schema in place — existing rows hold the same UUID so any
    cloned tenant template referencing them stays valid.
    """
    if not _TEMPLATES_DIR.is_dir():
        return
    for path in sorted(_TEMPLATES_DIR.glob("*.json")):
        with path.open() as f:
            spec = json.load(f)
        existing = await db.scalar(
            select(WorkflowActionTemplate).where(
                WorkflowActionTemplate.tenant_id.is_(None),
                WorkflowActionTemplate.app_id.is_(None),
                WorkflowActionTemplate.channel == spec["channel"],
                WorkflowActionTemplate.slug == spec["slug"],
            )
        )
        if existing is not None:
            existing.name = spec["name"]
            existing.payload_schema = spec["payload_schema"]
            continue
        db.add(
            WorkflowActionTemplate(
                id=uuid.uuid4(),
                tenant_id=None,
                app_id=None,
                channel=spec["channel"],
                slug=spec["slug"],
                name=spec["name"],
                payload_schema=spec["payload_schema"],
                active=True,
            )
        )
    await db.flush()


async def _delete_retired_poller_schedules(db: AsyncSession) -> int:
    """Defensively remove the rows for poller schedules retired by the vendor-abstraction wipe."""
    from sqlalchemy import delete

    result = await db.execute(
        delete(ScheduledJobDefinition).where(
            ScheduledJobDefinition.schedule_key.in_(_RETIRED_SCHEDULE_KEYS)
        )
    )
    deleted = int(getattr(result, "rowcount", 0) or 0)
    if deleted:
        _log.info("orchestration.retired_poller_schedules.deleted count=%s", deleted)
    await db.flush()
    return deleted
