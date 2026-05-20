"""Seed the platform-wide daily waiting-tail TTL sweep schedule under the system tenant (app_id="")."""
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

WAITING_TAIL_SWEEP_APP_ID = ""
WAITING_TAIL_SWEEP_JOB_TYPE = "orchestration-waiting-tail-sweep"
WAITING_TAIL_SWEEP_SCHEDULE_KEY = "platform:orchestration:waiting-tail-sweep"

# 02:00 UTC daily. The default TTL is 7 days, so daily granularity is ample.
WAITING_TAIL_SWEEP_CRON = "0 2 * * *"


async def seed_waiting_tail_sweep_schedule(
    session: AsyncSession,
    *,
    now: datetime | None = None,
) -> bool:
    """Insert the default daily sweep schedule if absent. No-op otherwise."""
    current = now or datetime.now(timezone.utc)

    existing = await session.scalar(
        select(ScheduledJobDefinition).where(
            ScheduledJobDefinition.tenant_id == SYSTEM_TENANT_ID,
            ScheduledJobDefinition.app_id == WAITING_TAIL_SWEEP_APP_ID,
            ScheduledJobDefinition.job_type == WAITING_TAIL_SWEEP_JOB_TYPE,
            ScheduledJobDefinition.schedule_key == WAITING_TAIL_SWEEP_SCHEDULE_KEY,
        )
    )
    if existing is not None:
        return False

    tenant = await session.get(Tenant, SYSTEM_TENANT_ID)
    if tenant is None:
        _log.warning(
            "waiting_tail_sweep.schedule_seed.missing_system_tenant "
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
        app_id=WAITING_TAIL_SWEEP_APP_ID,
        job_type=WAITING_TAIL_SWEEP_JOB_TYPE,
        schedule_key=WAITING_TAIL_SWEEP_SCHEDULE_KEY,
        name="Waiting-tail TTL sweep",
        description=(
            "Aborts recipients still waiting after a workflow run completed beyond "
            "its TTL, across all tenants. Runs at 02:00 UTC daily."
        ),
        cron=WAITING_TAIL_SWEEP_CRON,
        params={},
        override={},
        enabled=True,
        next_check_at=next_cron_tick(WAITING_TAIL_SWEEP_CRON, current),
        current_cycle_attempts=0,
        created_by=created_by,
        created_at=current,
        updated_at=current,
    )
    session.add(schedule)
    await session.flush()
    _log.info(
        "waiting_tail_sweep.schedule_seed.inserted schedule_id=%s cron=%r",
        schedule.id,
        WAITING_TAIL_SWEEP_CRON,
    )
    return True
