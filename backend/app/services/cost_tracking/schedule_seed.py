"""Seed the platform-wide daily cost-rollup schedule.

``populate-cost-rollup`` rebuilds ``analytics.agg_llm_usage_daily`` from the
raw ``analytics.fact_llm_generation`` event stream. The rollup is platform-wide — one pass
scans every tenant — so the schedule is owned by ``SYSTEM_TENANT_ID``
with ``app_id=""`` (not scoped to any concrete app).

Idempotent: the model's ``(tenant_id, app_id, job_type, schedule_key)``
unique constraint guarantees that re-running leaves operator edits
(cron, enabled, override, params) alone. A tenant/operator can disable
or re-tune the seed row and it will not be recreated.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.scheduled_job import ScheduledJob
from app.models.tenant import Tenant
from app.models.user import User

_log = logging.getLogger(__name__)

COST_ROLLUP_APP_ID = ""
COST_ROLLUP_JOB_TYPE = "populate-cost-rollup"
COST_ROLLUP_SCHEDULE_KEY = "platform:cost:daily-rollup"

# 01:05 UTC daily. ``populate-cost-rollup`` defaults ``start_date`` /
# ``end_date`` to ``(now - 1 day).date()`` so firing shortly after
# midnight UTC rebuilds exactly D-1. The 5-minute offset is a buffer
# for late-arriving ``analytics.fact_llm_generation`` rows from slow async callers whose
# ``flush_llm_usage`` landed after the day rolled over.
COST_ROLLUP_CRON = "5 1 * * *"


async def seed_cost_rollup_schedule(
    session: AsyncSession,
    *,
    now: datetime | None = None,
) -> bool:
    """Insert the default daily rollup schedule if absent. No-op otherwise.

    Returns True if a row was inserted, False if one already existed
    (or the system tenant/user is missing, in which case the caller
    has bigger problems — we log and skip rather than crash seed boot).
    """
    current = now or datetime.now(timezone.utc)

    existing = await session.scalar(
        select(ScheduledJob).where(
            ScheduledJob.tenant_id == SYSTEM_TENANT_ID,
            ScheduledJob.app_id == COST_ROLLUP_APP_ID,
            ScheduledJob.job_type == COST_ROLLUP_JOB_TYPE,
            ScheduledJob.schedule_key == COST_ROLLUP_SCHEDULE_KEY,
        )
    )
    if existing is not None:
        return False

    tenant = await session.get(Tenant, SYSTEM_TENANT_ID)
    if tenant is None:
        _log.warning(
            "cost_rollup.schedule_seed.missing_system_tenant "
            "tenant_id=%s — skipping seed (seed_all_defaults order?)",
            SYSTEM_TENANT_ID,
        )
        return False

    # _enqueue_job_from_schedule falls back to any active user in the
    # schedule's tenant when created_by is NULL; pinning to SYSTEM_USER_ID
    # up-front keeps the audit trail consistent (every fired job is
    # attributable to the platform user).
    system_user = await session.get(User, SYSTEM_USER_ID)
    created_by = SYSTEM_USER_ID if system_user is not None else None

    from app.services.scheduler.engine import next_cron_tick

    schedule = ScheduledJob(
        id=uuid.uuid4(),
        tenant_id=SYSTEM_TENANT_ID,
        app_id=COST_ROLLUP_APP_ID,
        job_type=COST_ROLLUP_JOB_TYPE,
        schedule_key=COST_ROLLUP_SCHEDULE_KEY,
        name="Platform · LLM cost daily rollup",
        description=(
            "Rebuilds analytics.agg_llm_usage_daily for D-1 across all tenants. "
            "Runs at 01:05 UTC to allow a short buffer for late analytics.fact_llm_generation "
            "writes crossing the day boundary."
        ),
        cron=COST_ROLLUP_CRON,
        # Empty params → handler's ``_parse`` defaults fire: start=yesterday,
        # end=start. Keep defaults in the handler, not here, so changing the
        # default window doesn't require reseeding.
        params={},
        override={},
        enabled=True,
        next_check_at=next_cron_tick(COST_ROLLUP_CRON, current),
        current_cycle_attempts=0,
        created_by=created_by,
        created_at=current,
        updated_at=current,
    )
    session.add(schedule)
    await session.flush()
    _log.info(
        "cost_rollup.schedule_seed.inserted schedule_id=%s cron=%r",
        schedule.id,
        COST_ROLLUP_CRON,
    )
    return True
