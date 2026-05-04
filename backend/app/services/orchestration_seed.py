"""Seed loader for orchestration.* — system action templates + seed workflows + scheduled poller.

Phase 0 shipped empty scaffolding. Phase 4 added the singleton resume-waiting-cohorts
scheduled job. Phase 8 added system action templates + the "Default MQL Concierge"
crm workflow. Phase 9 added the "DM2 Adherence Watch" clinical pathway. Phase 10
adds bootstrap of default provider connections from env + injection of those
connection_ids and explicit variable_mappings into the seeded workflow JSON
so the builder shows editable rows instead of hidden inherited behaviour.

Loader runs idempotently from app startup (lifespan hook). Each insert uses
the model's natural-key uniqueness so reseed is a no-op. When a seeded
workflow's definition changes upstream, the loader publishes a new
WorkflowVersion and points current_published_version_id at it (existing
versions are immutable).
"""
from __future__ import annotations

import json
import logging
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.orchestration import (
    Workflow,
    WorkflowActionTemplate,
    WorkflowVersion,
)
from app.models.provider_connection import ProviderConnection
from app.models.scheduled_job import ScheduledJobDefinition
from app.models.tenant import Tenant
from app.models.user import User
from app.services.orchestration.connections import crypto as connection_crypto


_SEEDS_ROOT = Path(__file__).parent / "orchestration_seeds"
_TEMPLATES_DIR = _SEEDS_ROOT / "action_templates"
_WORKFLOWS_DIR = _SEEDS_ROOT / "workflows"


_log = logging.getLogger(__name__)


RESUME_POLLER_APP_ID = ""
RESUME_POLLER_JOB_TYPE = "resume-waiting-cohorts"
RESUME_POLLER_SCHEDULE_KEY = "platform:orchestration:resume-waiting-cohorts"
# 1/min. Cheap query backed by a partial index on (status, wakeup_at);
# matches the temporal/airflow default poll cadence.
RESUME_POLLER_CRON = "* * * * *"


async def seed_orchestration_defaults(db: AsyncSession) -> None:
    """Insert orchestration system defaults. Idempotent.

    Order matters: scheduled poller first (no dependencies), then action
    templates (referenced by node configs in workflow definitions), then
    bootstrap of default provider connections from env vars (so the
    workflow-fixture loader can resolve connection_ids for the system
    workflow JSON), then seeded workflows.
    """
    await _ensure_resume_poller_scheduled(db)
    await _seed_system_action_templates(db)
    await _bootstrap_default_connections_from_env(db)
    await _seed_workflow_fixtures(db)
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


async def _system_connection_id_by_provider(
    db: AsyncSession, *, app_id: str,
) -> dict[str, uuid.UUID]:
    """Lookup table keyed by provider for the system-bootstrapped rows."""
    out: dict[str, uuid.UUID] = {}
    for provider, _ in _ENV_BOOTSTRAPPABLE_PROVIDERS:
        row = await db.scalar(
            select(ProviderConnection).where(
                ProviderConnection.tenant_id == SYSTEM_TENANT_ID,
                ProviderConnection.app_id == app_id,
                ProviderConnection.provider == provider,
                ProviderConnection.name == _bootstrapped_connection_name(provider),
            )
        )
        if row is not None:
            out[provider] = row.id
    return out


# Maps a node type to (provider name, channel for action-template lookup).
# Channel is None when the node is not template-backed (e.g. lsq updates).
_CRM_NODE_PROVIDER_CHANNEL: dict[str, tuple[str, Optional[str]]] = {
    "crm.send_wati": ("wati", "wati"),
    "crm.place_bolna_call": ("bolna", "bolna"),
    "crm.lsq_update_stage": ("lsq", None),
    "crm.lsq_log_activity": ("lsq", None),
    "crm.send_sms": ("msg91", "sms"),
}


async def _inject_seeded_connection_ids_and_mappings(
    db: AsyncSession, *, definition: dict[str, Any], app_id: str,
) -> dict[str, Any]:
    """Return a deep copy of ``definition`` with each credential-backed
    ``crm.*`` node augmented with a ``connection_id`` resolved from
    env-bootstrapped system connections.

    Variable mappings are NOT injected here — workflows declare them
    directly on each node (single source of truth). No-op for nodes whose
    provider has no env-bootstrapped connection.
    """
    by_provider = await _system_connection_id_by_provider(db, app_id=app_id)
    if not by_provider:
        return definition

    enriched = deepcopy(definition)
    for node in enriched.get("nodes", []):
        node_type = node.get("type")
        if node_type not in _CRM_NODE_PROVIDER_CHANNEL:
            continue
        provider = _CRM_NODE_PROVIDER_CHANNEL[node_type][0]
        cid = by_provider.get(provider)
        if cid is None:
            continue
        config = node.setdefault("config", {})
        config["connection_id"] = str(cid)
    return enriched


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


async def _seed_workflow_fixtures(db: AsyncSession) -> None:
    """Load every workflows/*.json as a system-owned workflow + v1 version.

    Lookup key is (SYSTEM_TENANT_ID, app_id, slug). On drift, publishes a new
    version (existing versions are immutable) and points
    current_published_version_id at it. The system tenant must exist —
    otherwise we silently skip (matches the resume-poller pattern: a fresh
    DB without seed_defaults run has no system tenant yet).
    """
    if not _WORKFLOWS_DIR.is_dir():
        return
    tenant = await db.get(Tenant, SYSTEM_TENANT_ID)
    if tenant is None:
        _log.warning(
            "orchestration.seed.workflows.missing_system_tenant tenant_id=%s — skipping",
            SYSTEM_TENANT_ID,
        )
        return
    system_user = await db.get(User, SYSTEM_USER_ID)
    if system_user is None:
        _log.warning(
            "orchestration.seed.workflows.missing_system_user user_id=%s — skipping",
            SYSTEM_USER_ID,
        )
        return

    for path in sorted(_WORKFLOWS_DIR.glob("*.json")):
        with path.open() as f:
            spec = json.load(f)
        # Inject env-bootstrapped connection ids + explicit variable_mappings
        # before the upsert so definition-drift detection picks up changes
        # the same way as upstream JSON edits.
        spec["definition"] = await _inject_seeded_connection_ids_and_mappings(
            db, definition=spec["definition"], app_id=spec["app_id"],
        )
        await _upsert_seeded_workflow(db, spec)


async def _upsert_seeded_workflow(db: AsyncSession, spec: dict[str, Any]) -> None:
    app_id = spec["app_id"]
    slug = spec["slug"]
    existing = await db.scalar(
        select(Workflow).where(
            Workflow.tenant_id == SYSTEM_TENANT_ID,
            Workflow.app_id == app_id,
            Workflow.slug == slug,
        )
    )

    if existing is None:
        wf = Workflow(
            id=uuid.uuid4(),
            tenant_id=SYSTEM_TENANT_ID,
            app_id=app_id,
            workflow_type=spec["workflow_type"],
            slug=slug,
            name=spec["name"],
            description=spec.get("description"),
            created_by=SYSTEM_USER_ID,
        )
        db.add(wf)
        await db.flush()
        v = WorkflowVersion(
            id=uuid.uuid4(),
            tenant_id=SYSTEM_TENANT_ID,
            app_id=app_id,
            workflow_id=wf.id,
            version=1,
            definition=spec["definition"],
            status="published",
            published_by=SYSTEM_USER_ID,
            published_at=datetime.now(timezone.utc),
        )
        db.add(v)
        await db.flush()
        wf.current_published_version_id = v.id
        await db.flush()
        _log.info("orchestration.seed.workflow.inserted slug=%s app_id=%s", slug, app_id)
        return

    # Update name/description in place; publish a new version on definition drift.
    existing.name = spec["name"]
    existing.description = spec.get("description")
    versions_stmt = (
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == existing.id)
        .order_by(WorkflowVersion.version.desc())
    )
    latest = (await db.execute(versions_stmt)).scalars().first()
    if latest is not None and json.dumps(latest.definition, sort_keys=True) == json.dumps(
        spec["definition"], sort_keys=True
    ):
        return
    next_version = (latest.version + 1) if latest is not None else 1
    new_v = WorkflowVersion(
        id=uuid.uuid4(),
        tenant_id=SYSTEM_TENANT_ID,
        app_id=app_id,
        workflow_id=existing.id,
        version=next_version,
        definition=spec["definition"],
        status="published",
        published_by=SYSTEM_USER_ID,
        published_at=datetime.now(timezone.utc),
    )
    db.add(new_v)
    await db.flush()
    existing.current_published_version_id = new_v.id
    await db.flush()
    _log.info(
        "orchestration.seed.workflow.updated slug=%s app_id=%s version=%d",
        slug, app_id, next_version,
    )


async def _ensure_resume_poller_scheduled(
    db: AsyncSession, *, now: datetime | None = None
) -> bool:
    """Insert the singleton resume-waiting-cohorts schedule row if absent."""
    current = now or datetime.now(timezone.utc)

    existing = await db.scalar(
        select(ScheduledJobDefinition).where(
            ScheduledJobDefinition.tenant_id == SYSTEM_TENANT_ID,
            ScheduledJobDefinition.app_id == RESUME_POLLER_APP_ID,
            ScheduledJobDefinition.job_type == RESUME_POLLER_JOB_TYPE,
            ScheduledJobDefinition.schedule_key == RESUME_POLLER_SCHEDULE_KEY,
        )
    )
    if existing is not None:
        return False

    tenant = await db.get(Tenant, SYSTEM_TENANT_ID)
    if tenant is None:
        _log.warning(
            "orchestration.resume_poller.seed.missing_system_tenant tenant_id=%s — skipping",
            SYSTEM_TENANT_ID,
        )
        return False

    system_user = await db.get(User, SYSTEM_USER_ID)
    created_by = SYSTEM_USER_ID if system_user is not None else None

    from app.services.scheduler.engine import next_cron_tick

    schedule = ScheduledJobDefinition(
        id=uuid.uuid4(),
        tenant_id=SYSTEM_TENANT_ID,
        app_id=RESUME_POLLER_APP_ID,
        job_type=RESUME_POLLER_JOB_TYPE,
        schedule_key=RESUME_POLLER_SCHEDULE_KEY,
        name="Platform · Orchestration resume poller",
        description=(
            "Polls orchestration.workflow_run_recipient_states for due/ready rows "
            "every minute, advances them along the appropriate edge, and dispatches "
            "run-workflow jobs grouped by run_id."
        ),
        cron=RESUME_POLLER_CRON,
        params={},
        override={},
        enabled=True,
        next_check_at=next_cron_tick(RESUME_POLLER_CRON, current),
        current_cycle_attempts=0,
        created_by=created_by,
        created_at=current,
        updated_at=current,
    )
    db.add(schedule)
    await db.flush()
    _log.info(
        "orchestration.resume_poller.seed.inserted schedule_id=%s cron=%r",
        schedule.id,
        RESUME_POLLER_CRON,
    )
    return True
