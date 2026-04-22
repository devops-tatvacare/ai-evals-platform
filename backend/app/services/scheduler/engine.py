"""Generic tenant-scoped scheduler engine.

One tick loop (called from `worker.py`) reads `scheduled_jobs` rows whose
`next_check_at <= now` under row-level `FOR UPDATE SKIP LOCKED`, evaluates
`skip_criteria` against the predicate registry, and either enqueues a
normal `jobs` row (setting `jobs.scheduled_job_id`) or advances the
retry/backoff state. The engine never executes workload logic itself.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from croniter import croniter
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.job import Job
from app.models.scheduled_job import ScheduledJob
from app.services.scheduler import predicates as predicate_registry
from app.services.scheduler.config import (
    DEFAULT_RETRY_COUNT,
    DEFAULT_RETRY_INTERVAL_MINUTES,
    DEFAULT_TICK_INTERVAL_SECONDS,
)

_log = logging.getLogger(__name__)


def validate_cron_expression(expression: str) -> str:
    """Raise ValueError if `expression` is not a valid cron string."""
    cleaned = (expression or "").strip()
    if not cleaned:
        raise ValueError("cron expression is required")
    if not croniter.is_valid(cleaned):
        raise ValueError(f"invalid cron expression: {expression!r}")
    return cleaned


def next_cron_tick(cron_expression: str, from_time: datetime) -> datetime:
    """Next cron boundary strictly after `from_time` (tz-aware UTC)."""
    anchor = from_time if from_time.tzinfo is not None else from_time.replace(tzinfo=timezone.utc)
    iterator = croniter(cron_expression, anchor)
    nxt = iterator.get_next(datetime)
    if nxt.tzinfo is None:
        nxt = nxt.replace(tzinfo=timezone.utc)
    return nxt


def _retry_count(schedule: ScheduledJob) -> int:
    raw = (schedule.override or {}).get("retry_count", DEFAULT_RETRY_COUNT)
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_RETRY_COUNT


def _retry_interval_minutes(schedule: ScheduledJob) -> int:
    raw = (schedule.override or {}).get(
        "retry_interval_minutes", DEFAULT_RETRY_INTERVAL_MINUTES
    )
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_RETRY_INTERVAL_MINUTES


def _merged_params(schedule: ScheduledJob) -> dict[str, Any]:
    params = dict(schedule.params or {})
    # Ensure app_id is always in the payload so legacy runners that read
    # `params["app_id"]` continue to work.
    params.setdefault("app_id", schedule.app_id)
    # Schedule-driven fires are always scheduled runs; the prune step keys
    # off this flag (§PR4). Caller-supplied `is_scheduled_run` is ignored
    # intentionally — a user-authored param cannot flip this.
    params["is_scheduled_run"] = True
    return params


async def _enqueue_job_from_schedule(
    db: AsyncSession,
    schedule: ScheduledJob,
    *,
    now: datetime,
) -> Job:
    """Insert a `jobs` row owned by the schedule. Returns the persisted Job."""
    params = _merged_params(schedule)
    # Runners authenticated a user on launch. Scheduled fires have no user;
    # reuse the `created_by` if present, else fall back to a platform user
    # WITHIN THE SAME TENANT so cross-tenant rows never surface.
    user_id = schedule.created_by
    if user_id is None:
        user_id = await _resolve_platform_user_id(db, tenant_id=schedule.tenant_id)
    job = Job(
        id=uuid.uuid4(),
        tenant_id=schedule.tenant_id,
        user_id=user_id,
        app_id=schedule.app_id,
        job_type=schedule.job_type,
        status="queued",
        params=params,
        progress={"current": 0, "total": 1, "message": "Queued by scheduler"},
        scheduled_job_id=schedule.id,
    )
    db.add(job)
    await db.flush()
    _log.info(
        "scheduler.fire",
        extra={
            "scheduleId": str(schedule.id),
            "jobId": str(job.id),
            "jobType": job.job_type,
            "tenantId": str(schedule.tenant_id),
            "appId": schedule.app_id,
            "firedAt": now.isoformat(),
        },
    )
    return job


async def _resolve_platform_user_id(db: AsyncSession, *, tenant_id: uuid.UUID):
    """Pick a stable user_id for scheduler-owned jobs when `created_by` is NULL.

    STRICTLY tenant-scoped: never crosses tenants, even as a fallback. Prefers
    an Owner (is_owner=True) so the job shows up under an admin who can act
    on it; falls back to any user in the tenant. Raises if the tenant has no
    users at all, which would be a data inconsistency (a schedule cannot exist
    for a user-less tenant).
    """
    from app.models.user import User

    # `is_active` + oldest-first: tenants bootstrap the Owner as user #1, so
    # the first-created active user is the most stable stand-in when
    # `created_by` is NULL. Not joining Role to avoid a cross-table lookup
    # per fire.
    result = await db.execute(
        select(User.id)
        .where(User.tenant_id == tenant_id, User.is_active.is_(True))
        .order_by(User.created_at.asc())
        .limit(1)
    )
    user_id = result.scalar_one_or_none()
    if user_id is None:
        raise RuntimeError(
            f"scheduler cannot enqueue a job: tenant {tenant_id} has no users"
        )
    return user_id


async def tick_once(db: AsyncSession, *, now: datetime | None = None) -> list[uuid.UUID]:
    """One engine tick: find due schedules, fire or back-off.

    Returns the list of newly-enqueued job IDs (useful for tests).
    """
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)

    due_stmt = (
        select(ScheduledJob)
        .where(ScheduledJob.enabled.is_(True))
        .where(
            or_(
                ScheduledJob.next_check_at.is_(None),
                ScheduledJob.next_check_at <= current,
            )
        )
        .order_by(ScheduledJob.next_check_at.asc().nullsfirst(), ScheduledJob.id.asc())
        .with_for_update(skip_locked=True)
    )
    result = await db.execute(due_stmt)
    due = result.scalars().all()

    fired: list[uuid.UUID] = []
    for schedule in due:
        try:
            validate_cron_expression(schedule.cron)
        except ValueError:
            _log.warning(
                "scheduler.invalid_cron",
                extra={
                    "scheduleId": str(schedule.id),
                    "cron": schedule.cron,
                },
            )
            schedule.last_skip_reason = f"invalid_cron:{schedule.cron}"
            # Push far enough forward so we don't hot-loop on the broken row.
            schedule.next_check_at = current + timedelta(minutes=60)
            continue

        ctx = predicate_registry.PredicateContext(
            tenant_id=schedule.tenant_id,
            app_id=schedule.app_id,
            schedule=schedule,
            now=current,
            db=db,
        )
        override = schedule.override or {}
        result = await predicate_registry.evaluate_skip_criteria(
            ctx, override.get("skip_criteria") or []
        )

        if not result.blocked:
            job = await _enqueue_job_from_schedule(db, schedule, now=current)
            fired.append(job.id)
            schedule.last_fire_at = current
            schedule.last_fire_job_id = job.id
            schedule.last_skip_reason = None
            schedule.current_cycle_attempts = 0
            schedule.current_cycle_started_at = None
            schedule.next_check_at = next_cron_tick(schedule.cron, current)
            continue

        # Blocked path: back off, retry, or wait for next cron tick.
        schedule.current_cycle_started_at = schedule.current_cycle_started_at or current
        schedule.current_cycle_attempts = (schedule.current_cycle_attempts or 0) + 1

        retry_budget = _retry_count(schedule)
        if schedule.current_cycle_attempts > retry_budget:
            previous_attempts = schedule.current_cycle_attempts - 1
            schedule.last_skip_reason = (
                f"skipped after {previous_attempts} retries: {result.reason}"
            )
            schedule.current_cycle_attempts = 0
            schedule.current_cycle_started_at = None
            schedule.next_check_at = next_cron_tick(schedule.cron, current)
        else:
            schedule.next_check_at = current + timedelta(
                minutes=_retry_interval_minutes(schedule)
            )
            schedule.last_skip_reason = result.reason

    await db.commit()
    return fired


async def fire_now(
    db: AsyncSession,
    schedule: ScheduledJob,
    *,
    now: datetime | None = None,
    ignore_predicates: bool = False,
) -> tuple[Job | None, str]:
    """Evaluate predicates (unless `ignore_predicates`) and fire once.

    Returns (job, reason). When blocked by a predicate and not ignored,
    returns (None, reason).
    """
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)

    if not ignore_predicates:
        ctx = predicate_registry.PredicateContext(
            tenant_id=schedule.tenant_id,
            app_id=schedule.app_id,
            schedule=schedule,
            now=current,
            db=db,
        )
        result = await predicate_registry.evaluate_skip_criteria(
            ctx, (schedule.override or {}).get("skip_criteria") or []
        )
        if result.blocked:
            schedule.last_skip_reason = f"fire_now_blocked:{result.reason}"
            await db.commit()
            return None, result.reason

    job = await _enqueue_job_from_schedule(db, schedule, now=current)
    schedule.last_fire_at = current
    schedule.last_fire_job_id = job.id
    schedule.last_skip_reason = None
    schedule.current_cycle_attempts = 0
    schedule.current_cycle_started_at = None
    # Advance next_check_at based on cron, regardless of fire-now.
    schedule.next_check_at = next_cron_tick(schedule.cron, current)
    await db.commit()
    return job, "fired"


async def scheduler_tick_loop() -> None:
    """Background asyncio task: run `tick_once` on an interval forever."""
    from app.config import settings

    interval = int(
        getattr(settings, "SCHEDULER_TICK_INTERVAL_SECONDS", DEFAULT_TICK_INTERVAL_SECONDS)
        or DEFAULT_TICK_INTERVAL_SECONDS
    )
    if interval < 1:
        interval = DEFAULT_TICK_INTERVAL_SECONDS

    _log.info("scheduler.loop.start interval_seconds=%s", interval)
    while True:
        try:
            async with async_session() as db:
                await tick_once(db)
        except asyncio.CancelledError:
            _log.info("scheduler.loop.cancelled")
            raise
        except Exception as exc:  # pragma: no cover — logged and retried
            _log.exception("scheduler.loop.error: %s", exc)
        await asyncio.sleep(interval)
