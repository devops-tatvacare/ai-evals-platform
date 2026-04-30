"""Dedicated job worker entrypoint."""

import asyncio
import logging

from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.services.job_worker import (
    recover_stale_jobs,
    recover_stale_eval_runs,
    recover_stale_source_sync_runs,
    recovery_loop,
    worker_loop,
)
# Force-import orchestration node package so @register_node fires before any
# run-workflow job dispatches. Without this the worker process has the
# run-workflow JOB handler registered (via job_worker import above) but zero
# NODE handlers — RunExecutor would raise NodeRegistryError on first dispatch.
import app.services.orchestration.nodes  # noqa: F401

logger = logging.getLogger(__name__)


def _validate_worker_config() -> None:
    if settings.JOB_HEARTBEAT_INTERVAL_SECONDS >= settings.JOB_LEASE_SECONDS:
        raise RuntimeError("JOB_HEARTBEAT_INTERVAL_SECONDS must be less than JOB_LEASE_SECONDS.")
    if settings.JOB_MAX_ATTEMPTS < 1:
        raise RuntimeError("JOB_MAX_ATTEMPTS must be at least 1.")
    if settings.JOB_RETRY_BASE_DELAY_SECONDS < 1:
        raise RuntimeError("JOB_RETRY_BASE_DELAY_SECONDS must be at least 1.")
    if settings.JOB_RETRY_MAX_DELAY_SECONDS < settings.JOB_RETRY_BASE_DELAY_SECONDS:
        raise RuntimeError("JOB_RETRY_MAX_DELAY_SECONDS must be greater than or equal to JOB_RETRY_BASE_DELAY_SECONDS.")
    if settings.JOB_MAX_CONCURRENT < 1:
        raise RuntimeError("JOB_MAX_CONCURRENT must be at least 1.")
    if settings.JOB_TENANT_MAX_CONCURRENT < 1:
        raise RuntimeError("JOB_TENANT_MAX_CONCURRENT must be at least 1.")
    if settings.JOB_APP_MAX_CONCURRENT < 1:
        raise RuntimeError("JOB_APP_MAX_CONCURRENT must be at least 1.")
    if settings.JOB_USER_MAX_CONCURRENT < 1:
        raise RuntimeError("JOB_USER_MAX_CONCURRENT must be at least 1.")
    if settings.JOB_ANALYTICS_MAX_CONCURRENT < 1:
        raise RuntimeError("JOB_ANALYTICS_MAX_CONCURRENT must be at least 1.")
    # Ordering invariants: tenant/user caps must fit inside the global and tenant caps.
    if settings.JOB_TENANT_MAX_CONCURRENT > settings.JOB_MAX_CONCURRENT:
        raise RuntimeError(
            "JOB_TENANT_MAX_CONCURRENT must be <= JOB_MAX_CONCURRENT."
        )
    if settings.JOB_USER_MAX_CONCURRENT > settings.JOB_TENANT_MAX_CONCURRENT:
        raise RuntimeError(
            "JOB_USER_MAX_CONCURRENT must be <= JOB_TENANT_MAX_CONCURRENT."
        )

async def run_worker() -> None:
    """Run recovery once, then start the worker and recovery loops."""
    from app.logging_config import configure_logging
    configure_logging()

    _validate_worker_config()
    logger.info("Starting dedicated job worker process")

    # Schema is owned by Alembic; entrypoint.sh ran `alembic upgrade head`
    # before this process started. Log the alembic head for diagnostics.
    async with engine.begin() as _boot_conn:
        _head_row = (
            await _boot_conn.execute(text("SELECT version_num FROM public.alembic_version"))
        ).first()
        logger.info(
            "alembic_head=%s",
            _head_row[0] if _head_row else "<unstamped>",
        )

    # Fail worker boot if any Sherlock manifest drifts from live Postgres.
    from app.database import async_session
    from app.services.chat_engine.manifest_validator import run_manifest_validator
    async with async_session() as _validator_db:
        await run_manifest_validator(_validator_db)

    await recover_stale_jobs()
    await recover_stale_eval_runs()
    await recover_stale_source_sync_runs()

    worker_task = asyncio.create_task(worker_loop())
    recovery_task = asyncio.create_task(recovery_loop())

    # Scheduler tick loop shares the worker process. Set
    # SCHEDULER_TICK_INTERVAL_SECONDS=0 to opt a process out of scheduling
    # (useful if multiple worker replicas run and you only want one to tick).
    tasks = [worker_task, recovery_task]
    if settings.SCHEDULER_TICK_INTERVAL_SECONDS > 0:
        from app.services.scheduler.engine import scheduler_tick_loop

        tasks.append(asyncio.create_task(scheduler_tick_loop()))
    else:
        # Loud warning, not silent skip: if every replica opts out, scheduled
        # jobs never fire and the only visible symptom is "this platform
        # feature stopped working." The heartbeat table (scheduler_heartbeats)
        # exposes the same signal in SQL for alerting.
        logger.warning(
            "scheduler.disabled SCHEDULER_TICK_INTERVAL_SECONDS=%s — "
            "this worker will NOT fire scheduled_jobs. If this is the only "
            "worker replica, cron-style schedules (cost rollup, CRM sync, "
            "...) will stop running.",
            settings.SCHEDULER_TICK_INTERVAL_SECONDS,
        )

    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_worker())
