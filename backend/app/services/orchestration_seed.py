"""Seed loader for orchestration.* — system action templates + seed workflows + scheduled poller.

Phase 0 shipped empty scaffolding. Phase 4 added the singleton resume-waiting-cohorts
scheduled job. Phase 8 added system action templates + the "Default MQL Concierge"
crm workflow. Phase 9 added the "DM2 Adherence Watch" clinical pathway.

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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.orchestration import (
    Workflow,
    WorkflowActionTemplate,
    WorkflowVersion,
)
from app.models.scheduled_job import ScheduledJobDefinition
from app.models.tenant import Tenant
from app.models.user import User


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
    seeded workflows.
    """
    await _ensure_resume_poller_scheduled(db)
    await _seed_system_action_templates(db)
    await _seed_workflow_fixtures(db)
    _log.info("orchestration.seed.complete")


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
