"""Seed the platform-wide signal-derivation Transform schedule.

Phase 11A of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

``derive-signals`` runs every enabled ``scheduled_scan``
``analytics.signal_definition`` across every tenant in one pass — the
"T" of ELT. The schedule is owned by
``SYSTEM_TENANT_ID`` with ``app_id=""`` (platform-managed, not per-app),
exactly like the cost-rollup schedule.

Idempotent on the ``(tenant_id, app_id, job_type, schedule_key)`` unique
constraint — re-running leaves operator edits (cron, enabled, params) alone.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.scheduled_job import ScheduledJobDefinition
from app.models.tenant import Tenant
from app.models.user import User

_log = logging.getLogger(__name__)

SIGNAL_DERIVATION_APP_ID = ""
SIGNAL_DERIVATION_JOB_TYPE = "derive-signals"
SIGNAL_DERIVATION_SCHEDULE_KEY = "platform:signals:derivation"

# 00:30 UTC daily. Signal definitions read the normalized dim/fact
# surfaces, which the steady-state sync keeps current through the day; a
# nightly pass is enough for rule-derived signals and the cadence can be
# re-tuned by an operator without reseeding.
SIGNAL_DERIVATION_CRON = "30 0 * * *"


async def seed_signal_derivation_schedule(
    session: AsyncSession,
    *,
    now: datetime | None = None,
) -> bool:
    """Insert the default daily signal-derivation schedule if absent.

    Returns True if a row was inserted, False if one already existed (or
    the system tenant is missing — logged and skipped, not crashed).
    """
    current = now or datetime.now(timezone.utc)

    existing = await session.scalar(
        select(ScheduledJobDefinition).where(
            ScheduledJobDefinition.tenant_id == SYSTEM_TENANT_ID,
            ScheduledJobDefinition.app_id == SIGNAL_DERIVATION_APP_ID,
            ScheduledJobDefinition.job_type == SIGNAL_DERIVATION_JOB_TYPE,
            ScheduledJobDefinition.schedule_key
            == SIGNAL_DERIVATION_SCHEDULE_KEY,
        )
    )
    if existing is not None:
        return False

    tenant = await session.get(Tenant, SYSTEM_TENANT_ID)
    if tenant is None:
        _log.warning(
            "signal_derivation.schedule_seed.missing_system_tenant "
            "tenant_id=%s — skipping seed (seed_all_defaults order?)",
            SYSTEM_TENANT_ID,
        )
        return False

    system_user = await session.get(User, SYSTEM_USER_ID)
    created_by = SYSTEM_USER_ID if system_user is not None else None

    from app.services.scheduler.engine import next_cron_tick

    schedule = ScheduledJobDefinition(
        id=uuid.uuid4(),
        tenant_id=SYSTEM_TENANT_ID,
        app_id=SIGNAL_DERIVATION_APP_ID,
        job_type=SIGNAL_DERIVATION_JOB_TYPE,
        schedule_key=SIGNAL_DERIVATION_SCHEDULE_KEY,
        name="Signal derivation",
        description=(
            "Runs every enabled scheduled_scan analytics.signal_definition "
            "across all tenants, deriving analytics.fact_lead_signal rows "
            "from normalized dim/fact surfaces. The 'T' of ELT."
        ),
        cron=SIGNAL_DERIVATION_CRON,
        params={},
        override={},
        enabled=True,
        next_check_at=next_cron_tick(SIGNAL_DERIVATION_CRON, current),
        current_cycle_attempts=0,
        created_by=created_by,
        created_at=current,
        updated_at=current,
    )
    session.add(schedule)
    await session.flush()
    _log.info(
        "signal_derivation.schedule_seed.inserted schedule_id=%s cron=%r",
        schedule.id,
        SIGNAL_DERIVATION_CRON,
    )
    return True
