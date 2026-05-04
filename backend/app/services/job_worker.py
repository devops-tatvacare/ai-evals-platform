"""Background job worker.

Polls the jobs table for 'queued' jobs and processes them concurrently.
Runs as asyncio tasks within the FastAPI process.

For production scale: extract to a separate worker process or use Celery.
For current scale (company-internal): this is sufficient.
"""

import asyncio
from collections import Counter
import logging
import os
import socket
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import aliased

from app.config import settings
from app.database import async_session
from app.models.job import BackgroundJob
from app.models.eval_run import EvaluationRun

logger = logging.getLogger(__name__)

# ── Concurrency primitives ───────────────────────────────────────
MAX_CONCURRENT_JOBS = settings.JOB_MAX_CONCURRENT
_job_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
_active_tasks: dict[str, asyncio.Task] = {}
WORKER_INSTANCE_ID = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"

# ── In-memory cancel cache ───────────────────────────────────────
# Avoids per-item DB queries in parallel_engine / runner hot loops.
# mark_job_cancelled() is called by the cancel route AFTER commit.
# is_job_cancelled() checks this set first, DB fallback every 10s.
_cancelled_jobs: set[str] = set()
_cancel_check_times: dict[str, float] = {}
_CANCEL_CHECK_INTERVAL = 10.0  # seconds between DB fallback checks

QUEUE_CLASSES = frozenset({"interactive", "standard", "bulk", "analytics"})

# BackgroundJob-type policy is populated by ``@register_job_handler`` at import time.
# The decorator is the single source of truth for queue_class, priority,
# default app_id, retry safety, and schedulability — there are no parallel
# hand-maintained dicts to drift against. Module consumers treat these as
# read-only lookups (see ``get_job_submission_metadata``, ``_is_retry_safe_job``).
#
# Why: before consolidation the same job_type appeared in up to four
# independent maps (queue defaults, app defaults, retry-safe set, scheduler
# workload registry) and stayed in sync only by convention. A new job_type
# that forgot any one of them was silently mis-queued or un-schedulable.
JOB_QUEUE_DEFAULTS: dict[str, dict[str, int | str]] = {}
JOB_APP_DEFAULTS: dict[str, str] = {}
RETRY_SAFE_JOB_TYPES: set[str] = set()


def _clean_str(value) -> str:
    return str(value or "").strip()


def _quota_limit(configured: int) -> int:
    if configured <= 0:
        return MAX_CONCURRENT_JOBS
    return min(configured, MAX_CONCURRENT_JOBS)


def _tenant_key(job) -> str:
    return str(job.tenant_id)


def _app_key(job) -> tuple[str, str]:
    return (_tenant_key(job), _clean_str(job.app_id))


def _user_key(job) -> tuple[str, str]:
    return (_tenant_key(job), str(job.user_id))


def _lease_deadline(now: datetime) -> datetime:
    return now + timedelta(seconds=settings.JOB_LEASE_SECONDS)


def _format_job_context(job: BackgroundJob | None = None, **extra) -> str:
    parts: dict[str, object] = {}
    if job is not None:
        parts.update({
            "job_id": job.id,
            "tenant_id": getattr(job, "tenant_id", None),
            "user_id": getattr(job, "user_id", None),
            "app_id": getattr(job, "app_id", None),
            "job_type": getattr(job, "job_type", None),
            "queue_class": getattr(job, "queue_class", None),
            "attempt_count": getattr(job, "attempt_count", None),
            "max_attempts": getattr(job, "max_attempts", None),
        })
    parts.update(extra)
    return " ".join(f"{key}={value}" for key, value in parts.items() if value not in (None, ""))


def _log_job_event(level: int, event: str, job: BackgroundJob | None = None, **extra) -> None:
    logger.log(level, "job_event=%s %s", event, _format_job_context(job, **extra))


def get_job_submission_metadata(job_type: str, params: dict | None) -> dict[str, int | str]:
    """Normalize job metadata promoted from params into first-class queue fields."""
    clean_params = params or {}
    defaults = JOB_QUEUE_DEFAULTS.get(job_type, {"queue_class": "standard", "priority": 100})

    app_id = _clean_str(clean_params.get("app_id")) or JOB_APP_DEFAULTS.get(job_type, "")
    queue_class = _clean_str(clean_params.get("queue_class")) or str(defaults["queue_class"])
    if queue_class not in QUEUE_CLASSES:
        allowed = ", ".join(sorted(QUEUE_CLASSES))
        raise ValueError(f"queue_class must be one of: {allowed}")

    try:
        priority = int(clean_params.get("priority", defaults["priority"]))
    except (TypeError, ValueError):
        raise ValueError("priority must be an integer")
    if priority < 0 or priority > 1000:
        raise ValueError("priority must be between 0 and 1000")

    try:
        max_attempts = int(clean_params.get("max_attempts", settings.JOB_MAX_ATTEMPTS))
    except (TypeError, ValueError):
        raise ValueError("max_attempts must be an integer")
    if max_attempts < 1 or max_attempts > 10:
        raise ValueError("max_attempts must be between 1 and 10")

    return {
        "app_id": app_id,
        "queue_class": queue_class,
        "priority": priority,
        "max_attempts": max_attempts,
    }


def _apply_job_metadata(job: BackgroundJob) -> None:
    metadata = get_job_submission_metadata(job.job_type, job.params or {})
    explicit_params = job.params or {}
    if not job.app_id:
        job.app_id = str(metadata["app_id"])
    if not job.queue_class or (
        job.queue_class == "standard" and "queue_class" not in explicit_params
    ):
        job.queue_class = str(metadata["queue_class"])
    if job.priority is None or (
        job.priority == 100 and "priority" not in explicit_params
    ):
        job.priority = int(metadata["priority"])
    if not job.max_attempts or job.max_attempts < 1:
        job.max_attempts = int(metadata["max_attempts"])


def _running_quota_counts(jobs: list[BackgroundJob]) -> dict[str, Counter]:
    counts = {
        "tenant": Counter(),
        "app": Counter(),
        "user": Counter(),
        "queue_class": Counter(),
    }
    for job in jobs:
        _apply_job_metadata(job)
        counts["tenant"][_tenant_key(job)] += 1
        counts["app"][_app_key(job)] += 1
        counts["user"][_user_key(job)] += 1
        counts["queue_class"][_clean_str(job.queue_class)] += 1
    return counts


def _is_retry_safe_job(job_type: str) -> bool:
    return job_type in RETRY_SAFE_JOB_TYPES


def _iter_error_chain(error: BaseException):
    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        yield current
        seen.add(id(current))
        current = current.__cause__ or current.__context__


def _is_retryable_error(error: Exception) -> bool:
    name = type(error).__name__.lower()
    retryable_fragments = (
        "timed out",
        "timeout",
        "temporarily unavailable",
        "temporary failure",
        "temporary failure in name resolution",
        "name or service not known",
        "no address associated with hostname",
        "connection reset",
        "connection aborted",
        "connection error",
        "connect error",
        "service unavailable",
        "too many requests",
        "rate limit",
        " 429",
        " 500",
        " 502",
        " 503",
        " 504",
    )
    for current in _iter_error_chain(error):
        if getattr(current, "retryable", False):
            return True
        if isinstance(current, (asyncio.TimeoutError, TimeoutError, ConnectionError)):
            return True
        current_name = type(current).__name__.lower()
        current_message = str(current).lower()
        if (
            "timeout" in current_name
            or "connection" in current_name
            or "connect" in current_name
        ):
            return True
        if any(fragment in current_message for fragment in retryable_fragments):
            return True
    if "timeout" in name or "connection" in name or "connect" in name:
        return True
    return False


def _retry_delay_seconds(attempt_count: int) -> int:
    exponent = max(attempt_count - 1, 0)
    delay = settings.JOB_RETRY_BASE_DELAY_SECONDS * (2 ** exponent)
    return min(delay, settings.JOB_RETRY_MAX_DELAY_SECONDS)


def _failure_transition(job: BackgroundJob, error: Exception, now: datetime) -> dict[str, object]:
    retryable_error = _is_retryable_error(error)
    retry_allowed = _is_retry_safe_job(job.job_type) and retryable_error and job.attempt_count < job.max_attempts
    error_message = _job_error_message(error)[:2000]
    if retry_allowed:
        retry_delay = _retry_delay_seconds(job.attempt_count)
        next_retry_at = now + timedelta(seconds=retry_delay)
        return {
            "status": "retryable_failed",
            "error_message": error_message,
            "completed_at": None,
            "last_error_at": now,
            "lease_owner": None,
            "lease_expires_at": None,
            "heartbeat_at": now,
            "next_retry_at": next_retry_at,
            "dead_lettered_at": None,
            "dead_letter_reason": None,
            "progress": {
                "current": 0,
                "total": 1,
                "message": f"Retry scheduled in {retry_delay}s",
            },
            "event": "retry_scheduled",
            "retry_delay_seconds": retry_delay,
        }

    dead_letter_reason = None
    if retryable_error and _is_retry_safe_job(job.job_type) and job.attempt_count >= job.max_attempts:
        dead_letter_reason = "retry_budget_exhausted"

    return {
        "status": "failed",
        "error_message": error_message,
        "completed_at": now,
        "last_error_at": now,
        "lease_owner": None,
        "lease_expires_at": None,
        "heartbeat_at": now,
        "next_retry_at": None,
        "dead_lettered_at": now if dead_letter_reason else None,
        "dead_letter_reason": dead_letter_reason,
        "event": "dead_lettered" if dead_letter_reason else "failed",
        "retry_delay_seconds": None,
    }


def _can_claim_job(job: BackgroundJob, counts: dict[str, Counter]) -> bool:
    queue_class = _clean_str(job.queue_class)
    if counts["tenant"][_tenant_key(job)] >= _quota_limit(settings.JOB_TENANT_MAX_CONCURRENT):
        return False
    if counts["app"][_app_key(job)] >= _quota_limit(settings.JOB_APP_MAX_CONCURRENT):
        return False
    if counts["user"][_user_key(job)] >= _quota_limit(settings.JOB_USER_MAX_CONCURRENT):
        return False

    class_limit_map = {
        "interactive": _quota_limit(settings.JOB_INTERACTIVE_MAX_CONCURRENT),
        "standard": _quota_limit(settings.JOB_STANDARD_MAX_CONCURRENT),
        "bulk": _quota_limit(settings.JOB_BULK_MAX_CONCURRENT),
        "analytics": _quota_limit(settings.JOB_ANALYTICS_MAX_CONCURRENT),
    }
    return counts["queue_class"][queue_class] < class_limit_map.get(queue_class, MAX_CONCURRENT_JOBS)


def _reserve_claim(job: BackgroundJob, counts: dict[str, Counter]) -> None:
    counts["tenant"][_tenant_key(job)] += 1
    counts["app"][_app_key(job)] += 1
    counts["user"][_user_key(job)] += 1
    counts["queue_class"][_clean_str(job.queue_class)] += 1


def _select_jobs_for_claim(
    candidates: list[BackgroundJob],
    limit: int,
    counts: dict[str, Counter],
) -> list[BackgroundJob]:
    groups: dict[tuple[str, str], list[BackgroundJob]] = {}
    for job in candidates:
        _apply_job_metadata(job)
        groups.setdefault(_app_key(job), []).append(job)

    selected: list[BackgroundJob] = []
    while len(selected) < limit and groups:
        progress = False
        for group_key in list(groups.keys()):
            queue = groups[group_key]
            chosen_index = next(
                (index for index, candidate in enumerate(queue) if _can_claim_job(candidate, counts)),
                None,
            )
            if chosen_index is None:
                del groups[group_key]
                continue

            job = queue.pop(chosen_index)
            selected.append(job)
            _reserve_claim(job, counts)
            progress = True
            if not queue:
                del groups[group_key]
            if len(selected) >= limit:
                break
        if not progress:
            break

    return selected


async def recover_stale_jobs(
    stale_minutes: int | None = None,
    *,
    now: datetime | None = None,
):
    """Mark jobs stuck in 'running' for longer than `stale_minutes` as failed.

    Call on startup to recover from process crashes that left jobs stranded.
    """
    stale_minutes = stale_minutes or settings.JOB_STALE_TIMEOUT_MINUTES
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=stale_minutes)
    async with async_session() as db:
        result = await db.execute(
            select(BackgroundJob).where(
                BackgroundJob.status == "running",
                or_(
                    BackgroundJob.lease_expires_at < now,
                    and_(
                        BackgroundJob.lease_expires_at.is_(None),
                        BackgroundJob.started_at < cutoff,
                    ),
                )
            )
        )
        stale_jobs = result.scalars().all()
        for job in stale_jobs:
            job.error_message = (
                "Run was recovered after the worker lease expired."
                if job.lease_expires_at is not None
                else f"Run was recovered after being unresponsive for >{stale_minutes} minutes."
            )
            job.last_error_at = now
            job.lease_owner = None
            job.lease_expires_at = None
            job.heartbeat_at = now
            if _is_retry_safe_job(job.job_type) and job.attempt_count < job.max_attempts:
                retry_delay = _retry_delay_seconds(job.attempt_count or 1)
                job.status = "retryable_failed"
                job.completed_at = None
                job.next_retry_at = now + timedelta(seconds=retry_delay)
                job.dead_lettered_at = None
                job.dead_letter_reason = None
                job.progress = {
                    "current": 0,
                    "total": 1,
                    "message": f"Retry scheduled after worker recovery in {retry_delay}s",
                }
                _log_job_event(
                    logging.WARNING,
                    "lease_retry_scheduled",
                    job,
                    retry_delay_seconds=retry_delay,
                )
            else:
                job.status = "failed"
                job.completed_at = now
                job.next_retry_at = None
                if _is_retry_safe_job(job.job_type) and job.attempt_count >= job.max_attempts:
                    job.dead_lettered_at = now
                    job.dead_letter_reason = "retry_budget_exhausted"
                    _log_job_event(logging.ERROR, "lease_dead_lettered", job)
                else:
                    _log_job_event(logging.WARNING, "lease_recovered_failed", job)
        if stale_jobs:
            await db.commit()
            logger.info(f"Recovered {len(stale_jobs)} stale job(s)")


async def recover_stale_source_sync_runs(
    stale_minutes: int | None = None,
    *,
    now: datetime | None = None,
):
    """Reconcile ``analytics.log_crm_source_sync`` rows stuck in ``running``.

    Two cases this catches:
      1. Linked job is terminal (``failed`` / ``cancelled`` / ``completed``)
         but the sync_run was never transitioned — e.g. the worker crashed
         after the job marker but before the runner's ``except`` block
         reached ``_fail_sync_run``.
      2. No linked job (``job_id IS NULL``) and the row has been in
         ``running`` longer than ``stale_minutes`` — typically legacy rows
         written before the ``job_id`` column existed.

    Kept generic on purpose (``analytics.log_crm_source_sync`` is a platform table, not
    app-specific); any app that populates it gets reconciled for free.
    """
    from app.models.source_records import LogCrmSourceSync

    stale_minutes = stale_minutes or settings.JOB_STALE_TIMEOUT_MINUTES
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=stale_minutes)

    async with async_session() as db:
        # Case 1: linked job already terminal
        linked_terminal_stmt = (
            select(LogCrmSourceSync)
            .join(BackgroundJob, LogCrmSourceSync.job_id == BackgroundJob.id)
            .where(
                LogCrmSourceSync.status == "running",
                BackgroundJob.status.in_(("failed", "cancelled", "completed")),
            )
        )
        # Case 2: unlinked + old
        unlinked_stale_stmt = select(LogCrmSourceSync).where(
            LogCrmSourceSync.status == "running",
            LogCrmSourceSync.job_id.is_(None),
            LogCrmSourceSync.started_at < cutoff,
        )
        recovered: list[LogCrmSourceSync] = []

        rows = (await db.execute(linked_terminal_stmt)).scalars().all()
        for sync_run in rows:
            linked_job = await db.get(BackgroundJob, sync_run.job_id) if sync_run.job_id else None
            job_status = linked_job.status if linked_job is not None else None
            job_error = linked_job.error_message if linked_job is not None else None
            sync_run.status = "cancelled" if job_status == "cancelled" else "failed"
            sync_run.completed_at = now
            sync_run.error_message = (
                job_error
                if job_error
                else "Reconciled after job reached terminal state without sync_run update."
            )
            recovered.append(sync_run)

        rows = (await db.execute(unlinked_stale_stmt)).scalars().all()
        for sync_run in rows:
            sync_run.status = "failed"
            sync_run.completed_at = now
            sync_run.error_message = (
                sync_run.error_message
                or f"Reconciled after being stuck in 'running' for >{stale_minutes} minutes."
            )
            recovered.append(sync_run)

        if recovered:
            await db.commit()
            logger.info(
                "Recovered %d stale analytics.log_crm_source_sync row(s)", len(recovered)
            )


async def recover_stale_workflow_runs():
    """Reconcile orchestration.workflow_runs stuck in 'pending'/'running'/'waiting'
    whose owning BackgroundJob is already terminal.

    This handles:
      - the worker crashed between executing nodes and updating run-status,
      - the job's failure path crashed before the WorkflowRun repair landed,
      - a docker restart killed the worker mid-traversal.

    Call on startup AFTER recover_stale_jobs() so jobs are in their correct
    terminal state. Mirrors recover_stale_eval_runs.
    """
    from app.models.orchestration import (
        WorkflowRun as _WfRunRecover,
        WorkflowRunNodeStep as _WfStepRecover,
    )

    async with async_session() as db:
        result = await db.execute(
            select(_WfRunRecover)
            .join(BackgroundJob, _WfRunRecover.job_id == BackgroundJob.id)
            .where(
                _WfRunRecover.status.in_(("pending", "running", "waiting")),
                BackgroundJob.status.in_(["completed", "failed", "cancelled"]),
            )
        )
        stale_runs = result.scalars().all()
        for run in stale_runs:
            job = await db.get(BackgroundJob, run.job_id) if run.job_id else None
            terminal_status = (
                "cancelled" if (job is not None and job.status == "cancelled") else "failed"
            )
            run.status = terminal_status
            run.error = "Run was recovered after a server restart."
            run.completed_at = datetime.now(timezone.utc)
            await db.execute(
                update(_WfStepRecover)
                .where(
                    _WfStepRecover.run_id == run.id,
                    _WfStepRecover.status == "running",
                )
                .values(status="failed", completed_at=run.completed_at)
            )
            logger.warning(
                "Recovered stale workflow_run %s (job %s was %s)",
                run.id,
                run.job_id,
                getattr(job, "status", "missing"),
            )
        if stale_runs:
            await db.commit()
            logger.info("Recovered %d stale workflow_run(s)", len(stale_runs))


async def recover_stale_eval_runs():
    """Reconcile evaluation_runs stuck in 'running' whose job is already terminal.

    This handles the case where:
    - The worker crashed mid-LLM-call and never updated the eval_run
    - The cancel route's UPDATE missed the eval_run (race condition)
    - Docker restart killed the worker before the runner's except handler ran

    Call on startup AFTER recover_stale_jobs() so jobs are already in their
    correct terminal state.
    """
    async with async_session() as db:
        result = await db.execute(
            select(EvaluationRun)
            .join(BackgroundJob, EvaluationRun.job_id == BackgroundJob.id)
            .where(
                EvaluationRun.status == "running",
                BackgroundJob.status.in_(["completed", "failed", "cancelled"]),
            )
        )
        stale_runs = result.scalars().all()
        for run in stale_runs:
            job = await db.get(BackgroundJob, run.job_id)
            run.status = "cancelled" if job.status == "cancelled" else "failed"
            run.error_message = "Run was recovered after a server restart."
            run.completed_at = datetime.now(timezone.utc)
            logger.warning(
                f"Recovered stale eval_run {run.id} (job {run.job_id} was {job.status})"
            )
        if stale_runs:
            await db.commit()
            logger.info(f"Recovered {len(stale_runs)} stale eval_run(s)")


class JobCancelledError(Exception):
    """Raised when a job detects it has been cancelled (cooperative cancellation)."""

    pass


def safe_error_message(e: Exception, fallback: str = "Evaluation interrupted") -> str:
    """Extract a meaningful error message from an exception.

    Some exceptions (especially from third-party libraries or cancellation races)
    produce an empty str(e). This helper falls back to the exception class name.
    """
    msg = str(e).strip()
    if not msg:
        msg = f"{type(e).__name__}: {fallback}"
    return msg


def _job_error_message(error: Exception) -> str:
    if hasattr(error, "step") and hasattr(error, "message"):
        return f"[{error.step}] {error.message}"
    return safe_error_message(error)


from typing import Any, Awaitable, Callable, Optional

# BackgroundJob handler registry — populated by ``@register_job_handler`` at import time.
# Maps ``job_type -> handler coroutine``.
JobHandler = Callable[..., Awaitable[Any]]
JOB_HANDLERS: dict[str, JobHandler] = {}


def register_job_handler(
    job_type: str,
    *,
    queue_class: str = "standard",
    priority: int = 100,
    app_id_default: str = "",
    retry_safe: bool = False,
    schedulable: bool = False,
    schedule_app_id: str | None = None,
    schedule_label: str | None = None,
    schedule_description: str | None = None,
    schedule_launch_source: str = "explicit_params",
    schedule_source_list_endpoint: str | None = None,
    schedule_default_params: dict | None = None,
    schedule_platform_managed: bool = False,
):
    """Decorator: register a job handler + its queue / retry / schedule policy.

    One decorator per job type. Keeping the policy next to the handler body
    prevents drift: adding a job type that forgets to register its queue
    class, retry safety, or schedulability used to be silent; now those
    are decorator arguments.

    Args:
        job_type: stable string identifier used on the wire and in ``jobs.job_type``.
        queue_class: one of ``QUEUE_CLASSES``. Governs cross-queue fairness caps.
        priority: 0..1000, lower runs first within the same queue_class.
        app_id_default: ``params["app_id"]`` to substitute when the submitter
            omits it. Empty means "caller must supply or job is platform-wide".
        retry_safe: when True, transient failures (timeouts, 429, 5xx,
            connection errors) re-queue the job with exponential backoff
            instead of terminal-failing. Handlers promoted to retry-safe must
            be idempotent on their ``params`` (see evaluation runners'
            ``promote_eval_run_to_running`` contract).
        schedulable: when True, also registers a
            ``app.services.scheduler.workloads.ScheduledWorkload`` so the
            Create Schedule overlay offers this workload. Requires
            ``schedule_label``.
        schedule_app_id: overrides ``app_id_default`` for the workload key.
            Use when a handler (e.g. ``sync-external-source``) is generic
            but schedulability is gated to a specific app.
        schedule_label / schedule_description / schedule_launch_source /
        schedule_source_list_endpoint / schedule_default_params: forwarded
            verbatim to ``ScheduledWorkload``.
    """
    if queue_class not in QUEUE_CLASSES:
        allowed = ", ".join(sorted(QUEUE_CLASSES))
        raise ValueError(
            f"register_job_handler({job_type!r}): queue_class {queue_class!r} "
            f"not in {{{allowed}}}"
        )
    if not 0 <= priority <= 1000:
        raise ValueError(
            f"register_job_handler({job_type!r}): priority {priority!r} must be in [0, 1000]"
        )
    if schedulable and not schedule_label:
        raise ValueError(
            f"register_job_handler({job_type!r}): schedulable=True requires schedule_label"
        )

    def decorator(func):
        JOB_HANDLERS[job_type] = func
        JOB_QUEUE_DEFAULTS[job_type] = {"queue_class": queue_class, "priority": priority}
        if app_id_default:
            JOB_APP_DEFAULTS[job_type] = app_id_default
        if retry_safe:
            RETRY_SAFE_JOB_TYPES.add(job_type)
        if schedulable:
            # Import lazily to avoid a cycle: workloads is consumed by routes
            # that may import this module.
            from app.services.scheduler.workloads import (
                ScheduledWorkload,
                register_workload,
            )
            workload_app_id = schedule_app_id if schedule_app_id is not None else app_id_default
            register_workload(
                ScheduledWorkload(
                    app_id=workload_app_id or "",
                    job_type=job_type,
                    label=schedule_label or job_type,
                    description=schedule_description or "",
                    launch_source=schedule_launch_source,  # type: ignore[arg-type]
                    source_list_endpoint=schedule_source_list_endpoint,
                    default_params=dict(schedule_default_params or {}),
                    platform_managed=schedule_platform_managed,
                )
            )
        return func

    return decorator


async def process_job(job_id, job_type: str, params: dict) -> dict:
    """Dispatch job to the appropriate handler.

    Extracts tenant_id/user_id from params (injected by the job submission
    route) and passes them as keyword args to the handler. A fresh
    correlation id is set for the duration of the handler so every
    ``analytics.fact_llm_generation`` row recorded by this job shares one id.
    """
    from app.services.cost_tracking.correlation import (
        reset_correlation_id,
        set_correlation_id,
    )

    handler = JOB_HANDLERS.get(job_type)
    if not handler:
        raise ValueError(f"Unknown job type: {job_type}")

    tenant_id = uuid.UUID(params["tenant_id"])
    user_id = uuid.UUID(params["user_id"])
    token = set_correlation_id(uuid.uuid4())
    try:
        return await handler(job_id, params, tenant_id=tenant_id, user_id=user_id)
    finally:
        reset_correlation_id(token)


async def update_job_progress(
    job_id, current: int, total: int, message: str = "", **extra
):
    """Update job progress (called from within handlers).

    Extra kwargs (run_id, listing_id, evaluator_id, etc.) are merged into
    the progress dict.  Preserves run_id from existing progress unless
    explicitly overridden.
    """
    async with async_session() as db:
        job = await db.get(BackgroundJob, job_id)
        if not job:
            return

        new_progress = {
            "current": current,
            "total": total,
            "message": message,
            **extra,
        }

        # Preserve run_id from previous progress (first-class metadata).
        # run_id is semantically a relationship (eval_run → job) stored in
        # the progress dict; it must survive overwrites from step updates.
        existing_run_id = (
            job.progress.get("run_id") if isinstance(job.progress, dict) else None
        )
        if existing_run_id and "run_id" not in extra:
            new_progress["run_id"] = existing_run_id

        job.progress = new_progress
        await db.commit()


def mark_job_cancelled(job_id) -> None:
    """Mark a job as cancelled in the in-memory cache.

    Called by the cancel route AFTER the DB commit succeeds.
    This allows is_job_cancelled() to return True immediately
    without a DB round-trip.
    """
    _cancelled_jobs.add(str(job_id))


def _cleanup_cancelled_job(job_id) -> None:
    """Remove a job from the cancel cache after it reaches a terminal state.

    Prevents unbounded memory growth in long-running worker processes.
    """
    job_key = str(job_id)
    _cancelled_jobs.discard(job_key)
    _cancel_check_times.pop(job_key, None)


async def is_job_cancelled(job_id, tenant_id: uuid.UUID | None = None) -> bool:
    """Check if a job has been cancelled (cooperative cancellation).

    Memory-first: returns immediately if the cancel route has signalled.
    DB fallback: checks the database at most once every _CANCEL_CHECK_INTERVAL
    seconds to catch cancellations from other processes or missed signals.
    """
    job_key = str(job_id)
    # Fast path: already known cancelled
    if job_key in _cancelled_jobs:
        return True
    # Throttled DB fallback
    now = time.monotonic()
    last_check = _cancel_check_times.get(job_key, 0)
    if now - last_check < _CANCEL_CHECK_INTERVAL:
        return False
    _cancel_check_times[job_key] = now
    async with async_session() as db:
        stmt = select(BackgroundJob).where(BackgroundJob.id == job_id, BackgroundJob.status == "cancelled")
        if tenant_id is not None:
            stmt = stmt.where(BackgroundJob.tenant_id == tenant_id)
        job = await db.scalar(stmt)
        if job is not None:
            _cancelled_jobs.add(job_key)
            return True
    return False


async def claim_next_jobs(
    limit: int,
    *,
    now: datetime | None = None,
    worker_id: str = WORKER_INSTANCE_ID,
) -> list[tuple[str, str, dict]]:
    """Atomically claim queued jobs using row-level locking."""
    if limit <= 0:
        return []

    now = now or datetime.now(timezone.utc)
    lease_expires_at = _lease_deadline(now)
    claimed_jobs: list[tuple[str, str, dict]] = []
    claim_window = max(limit, min(
        settings.JOB_CLAIM_WINDOW_MAX,
        max(limit * settings.JOB_CLAIM_WINDOW_MULTIPLIER, limit),
    ))

    async with async_session() as db:
        async with db.begin():
            await cascade_dependency_failures(db=db, commit=False)
            running_result = await db.execute(
                select(BackgroundJob).where(
                    BackgroundJob.status == "running",
                    or_(
                        BackgroundJob.lease_expires_at.is_(None),
                        BackgroundJob.lease_expires_at > now,
                    ),
                )
            )
            running_jobs = running_result.scalars().all()
            counts = _running_quota_counts(running_jobs)

            parent = aliased(BackgroundJob)
            result = await db.execute(
                select(BackgroundJob)
                .outerjoin(parent, BackgroundJob.depends_on_job_id == parent.id)
                .where(
                    or_(
                        and_(
                            BackgroundJob.status == "queued",
                            # Delayed-delivery gate (migration 0025). NULL
                            # means run-now (preserves pre-0025 semantics for
                            # every existing call site); a future timestamp
                            # parks the row until the worker passes through
                            # again at or after that time.
                            or_(
                                BackgroundJob.available_at.is_(None),
                                BackgroundJob.available_at <= now,
                            ),
                        ),
                        and_(
                            BackgroundJob.status == "retryable_failed",
                            BackgroundJob.next_retry_at.is_not(None),
                            BackgroundJob.next_retry_at <= now,
                        ),
                    ),
                    # Dependency gate: either no dependency, or parent completed.
                    # When parent is failed/cancelled, a separate cascade helper
                    # transitions the dependent; we don't claim it here.
                    or_(
                        BackgroundJob.depends_on_job_id.is_(None),
                        parent.status == "completed",
                    ),
                )
                .order_by(
                    BackgroundJob.priority.asc(),
                    func.coalesce(
                        BackgroundJob.next_retry_at,
                        BackgroundJob.available_at,
                        BackgroundJob.created_at,
                    ).asc(),
                    BackgroundJob.created_at.asc(),
                    BackgroundJob.id.asc(),
                )
                .limit(claim_window)
                .with_for_update(skip_locked=True, of=BackgroundJob)
            )
            jobs = result.scalars().all()
            selected_jobs = _select_jobs_for_claim(jobs, limit, counts)

            for job in selected_jobs:
                _apply_job_metadata(job)
                job.status = "running"
                job.started_at = job.started_at or now
                job.attempt_count = (job.attempt_count or 0) + 1
                job.heartbeat_at = now
                job.lease_owner = worker_id
                job.lease_expires_at = lease_expires_at
                job.next_retry_at = None
                claimed_jobs.append((str(job.id), job.job_type, job.params))
                _log_job_event(logging.INFO, "claimed", job, worker_id=worker_id)

    return claimed_jobs


async def _heartbeat_job(job_id: str, *, worker_id: str = WORKER_INSTANCE_ID) -> None:
    """Refresh the worker lease for a running job."""
    while True:
        await asyncio.sleep(settings.JOB_HEARTBEAT_INTERVAL_SECONDS)
        now = datetime.now(timezone.utc)
        try:
            async with async_session() as db:
                result = await db.execute(
                    update(BackgroundJob)
                    .where(
                        BackgroundJob.id == job_id,
                        BackgroundJob.status == "running",
                        BackgroundJob.lease_owner == worker_id,
                    )
                    .values(
                        heartbeat_at=now,
                        lease_expires_at=_lease_deadline(now),
                    )
                )
                await db.commit()
                if result.rowcount == 0:
                    return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Heartbeat update failed for job %s: %s", job_id, exc)


async def _run_job(job_id: str, job_type: str, params: dict) -> None:
    """Execute a single job under the concurrency semaphore."""
    async with _job_semaphore:
        heartbeat_task = asyncio.create_task(_heartbeat_job(job_id))
        try:
            result_data = await process_job(job_id, job_type, params)

            # Re-check: if job was cancelled during execution, don't overwrite
            async with async_session() as db:
                job = await db.get(BackgroundJob, job_id)
                if not job:
                    return
                if job.status == "cancelled":
                    logger.info(
                        f"BackgroundJob {job_id} was cancelled during execution, skipping completed update"
                    )
                elif job.status != "running" or job.lease_owner != WORKER_INSTANCE_ID:
                    logger.warning(
                        "BackgroundJob %s finished after lease ownership changed; skipping completed update",
                        job_id,
                    )
                else:
                    started_at = job.started_at or datetime.now(timezone.utc)
                    duration_seconds = round((datetime.now(timezone.utc) - started_at).total_seconds(), 2)
                    job.status = "completed"
                    job.result = result_data or {}
                    job.completed_at = datetime.now(timezone.utc)
                    job.lease_owner = None
                    job.lease_expires_at = None
                    job.next_retry_at = None
                    job.dead_lettered_at = None
                    job.dead_letter_reason = None
                    # Preserve run_id so frontend can still redirect
                    existing_run_id = (
                        job.progress.get("run_id")
                        if isinstance(job.progress, dict)
                        else None
                    )
                    done_progress: dict = {
                        "current": 1,
                        "total": 1,
                        "message": "Done",
                    }
                    if existing_run_id:
                        done_progress["run_id"] = existing_run_id
                    job.progress = done_progress
                    await db.commit()
                    _log_job_event(
                        logging.INFO,
                        "completed",
                        job,
                        duration_seconds=duration_seconds,
                        worker_id=WORKER_INSTANCE_ID,
                    )
            _cleanup_cancelled_job(job_id)

        except Exception as e:
            logger.error("BackgroundJob %s failed: %s", job_id, e)
            logger.error(traceback.format_exc())

            # Re-fetch job in a fresh session and mark as failed.
            # Retry up to 3 times so a transient DB error doesn't
            # leave the job stuck in "running" forever.
            for attempt in range(3):
                try:
                    async with async_session() as db2:
                        j = await db2.get(BackgroundJob, job_id)
                        if j and j.status not in ("completed", "cancelled", "failed"):
                            failure_time = datetime.now(timezone.utc)
                            transition = _failure_transition(j, e, failure_time)
                            j.status = str(transition["status"])
                            j.error_message = str(transition["error_message"])
                            j.completed_at = transition["completed_at"]
                            j.last_error_at = transition["last_error_at"]
                            j.lease_owner = transition["lease_owner"]
                            j.lease_expires_at = transition["lease_expires_at"]
                            j.heartbeat_at = transition["heartbeat_at"]
                            j.next_retry_at = transition["next_retry_at"]
                            j.dead_lettered_at = transition["dead_lettered_at"]
                            j.dead_letter_reason = transition["dead_letter_reason"]
                            if "progress" in transition:
                                j.progress = transition["progress"]
                            if j.status == "failed":
                                await db2.execute(
                                    update(EvaluationRun)
                                    .where(
                                        EvaluationRun.job_id == job_id,
                                        EvaluationRun.status == "running",
                                    )
                                    .values(
                                        status="failed",
                                        error_message=j.error_message,
                                        completed_at=j.completed_at,
                                    )
                                )
                                # Mirror the EvaluationRun repair for orchestration
                                # WorkflowRun — keyed by job_id. Also fail any
                                # still-running node steps so observability isn't
                                # stuck on intermediate state.
                                from app.models.orchestration import (
                                    WorkflowRun as _WfRunRepair,
                                    WorkflowRunNodeStep as _WfStepRepair,
                                )
                                await db2.execute(
                                    update(_WfRunRepair)
                                    .where(
                                        _WfRunRepair.job_id == job_id,
                                        _WfRunRepair.status.in_(("pending", "running", "waiting")),
                                    )
                                    .values(
                                        status="failed",
                                        error=j.error_message,
                                        completed_at=j.completed_at,
                                    )
                                )
                                await db2.execute(
                                    update(_WfStepRepair)
                                    .where(
                                        _WfStepRepair.run_id.in_(
                                            select(_WfRunRepair.id).where(
                                                _WfRunRepair.job_id == job_id
                                            )
                                        ),
                                        _WfStepRepair.status == "running",
                                    )
                                    .values(status="failed", completed_at=j.completed_at)
                                )
                                await cascade_dependency_failures(db=db2, commit=False)
                            await db2.commit()
                            _log_job_event(
                                logging.WARNING if j.status == "retryable_failed" else logging.ERROR,
                                str(transition["event"]),
                                j,
                                worker_id=WORKER_INSTANCE_ID,
                                retry_delay_seconds=transition.get("retry_delay_seconds"),
                            )
                    break
                except Exception as db_err:
                    logger.error(
                        f"Failed to mark job {job_id} as failed "
                        f"(attempt {attempt + 1}/3): {db_err}"
                    )
                    if attempt < 2:
                        await asyncio.sleep(1)
            _cleanup_cancelled_job(job_id)

        finally:
            heartbeat_task.cancel()
            await asyncio.gather(heartbeat_task, return_exceptions=True)
            _active_tasks.pop(str(job_id), None)


async def worker_loop():
    """Main worker loop. Polls for queued jobs and runs them concurrently."""
    logger.info(
        "BackgroundJob worker started (worker_id=%s, max_concurrent=%d)",
        WORKER_INSTANCE_ID,
        MAX_CONCURRENT_JOBS,
    )
    while True:
        try:
            available_slots = MAX_CONCURRENT_JOBS - len(_active_tasks)
            if MAX_CONCURRENT_JOBS > 0:
                saturation_pct = round((len(_active_tasks) / MAX_CONCURRENT_JOBS) * 100, 1)
                logger.debug(
                    "job_worker_saturation worker_id=%s active=%s max=%s saturation_pct=%s",
                    WORKER_INSTANCE_ID,
                    len(_active_tasks),
                    MAX_CONCURRENT_JOBS,
                    saturation_pct,
                )
            if available_slots > 0:
                jobs = await claim_next_jobs(available_slots)
                for job_id, job_type, params in jobs:
                    if job_id in _active_tasks:
                        continue

                    logger.info("Claimed job %s (type=%s)", job_id, job_type)
                    task = asyncio.create_task(_run_job(job_id, job_type, params))
                    _active_tasks[job_id] = task

        except Exception as e:
            logger.error(f"Worker loop error: {e}")

        await asyncio.sleep(settings.JOB_POLL_INTERVAL_SECONDS)


async def cascade_dependency_failures(db=None, *, commit: bool = True) -> int:
    """Fail jobs whose `depends_on_job_id` parent is failed/cancelled.

    Transitions the dependent job to `failed` with reason `dependency_failed`.
    If the dependent job owns a placeholder `EvaluationRun` (via `progress.run_id`
    or `EvaluationRun.job_id`) that is still in `pending`/`running`, mark it failed
    so the Runs UI never hangs in pending.

    Returns the number of dependents cascaded in this call.
    """
    own_session = db is None
    session = async_session() if own_session else None  # type: ignore[assignment]
    try:
        db_ctx = session if own_session else db  # type: ignore[assignment]
        if own_session:
            await db_ctx.__aenter__()  # type: ignore[union-attr]
        assert db_ctx is not None
        now = datetime.now(timezone.utc)
        parent = aliased(BackgroundJob)
        stmt = (
            select(BackgroundJob)
            .join(parent, BackgroundJob.depends_on_job_id == parent.id)
            .where(
                BackgroundJob.status.in_(("queued", "retryable_failed")),
                parent.status.in_(("failed", "cancelled")),
            )
        )
        result = await db_ctx.execute(stmt)
        dependents = result.scalars().all()
        cascaded = 0
        for dependent in dependents:
            dependent.status = "failed"
            dependent.completed_at = now
            dependent.error_message = "dependency_failed"
            dependent.next_retry_at = None
            dependent.lease_owner = None
            dependent.lease_expires_at = None
            existing_progress = (
                dependent.progress if isinstance(dependent.progress, dict) else {}
            )
            run_id = existing_progress.get("run_id")
            new_progress = dict(existing_progress)
            new_progress["message"] = "Cascaded failure: dependency did not complete"
            dependent.progress = new_progress
            cascaded += 1
            _log_job_event(logging.WARNING, "dependency_cascaded_failed", dependent)

            # Fail any placeholder EvaluationRun attached to this dependent so the
            # Runs UI does not strand in `pending`. Prefer the FK linkage;
            # fall back to `progress.run_id` for legacy rows.
            run_filters = [EvaluationRun.job_id == dependent.id]
            if run_id:
                try:
                    run_filters.append(EvaluationRun.id == uuid.UUID(str(run_id)))
                except (TypeError, ValueError):
                    pass
            evaluation_runs = (
                await db_ctx.execute(
                    select(EvaluationRun).where(
                        or_(*run_filters),
                        EvaluationRun.status.in_(("pending", "running")),
                    )
                )
            ).scalars().all()
            for run in evaluation_runs:
                run.status = "failed"
                run.completed_at = now
                run.error_message = "dependency_failed"
        if cascaded and commit:
            await db_ctx.commit()
        return cascaded
    finally:
        if own_session and session is not None:
            await session.__aexit__(None, None, None)


async def recovery_loop():
    """Periodically recover stale jobs, eval runs, and cascade dependency failures."""
    logger.info("Recovery loop started (interval=300s)")
    while True:
        await asyncio.sleep(300)
        try:
            await recover_stale_jobs()
            await recover_stale_eval_runs()
            await recover_stale_source_sync_runs()
            await cascade_dependency_failures()
        except Exception as e:
            logger.error(f"Recovery loop error: {e}")


async def get_queue_position(job_id: str) -> int:
    """Return 0-based queue position for a queued job. -1 if not queued."""
    async with async_session() as db:
        job = await db.get(BackgroundJob, job_id)
        now = datetime.now(timezone.utc)
        if not job:
            return -1
        if job.status == "retryable_failed":
            if job.next_retry_at and job.next_retry_at > now:
                return -1
        elif job.status != "queued":
            return -1
        else:
            # Delayed-delivery: a queued-but-deferred job isn't really in the
            # ready queue from the user's POV — return -1 until it surfaces.
            if job.available_at is not None and job.available_at > now:
                return -1
        result = await db.execute(
            select(func.count())
            .select_from(BackgroundJob)
            .where(
                or_(
                    and_(
                        BackgroundJob.status == "queued",
                        or_(
                            BackgroundJob.available_at.is_(None),
                            BackgroundJob.available_at <= now,
                        ),
                    ),
                    and_(
                        BackgroundJob.status == "retryable_failed",
                        BackgroundJob.next_retry_at.is_not(None),
                        BackgroundJob.next_retry_at <= now,
                    ),
                ),
                or_(
                    BackgroundJob.priority < job.priority,
                    and_(BackgroundJob.priority == job.priority, BackgroundJob.created_at < job.created_at),
                ),
            )
        )
        return result.scalar() or 0


# ── BackgroundJob Handlers ─────────────────────────────────────────────────


@register_job_handler(
    "evaluate-batch",
    queue_class="bulk",
    priority=200,
    app_id_default="kaira-bot",
    retry_safe=True,
)
async def handle_evaluate_batch(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run batch evaluation on threads from a data file."""
    from app.services.evaluators.batch_runner import run_batch_evaluation

    result = await run_batch_evaluation(
        job_id=job_id,
        tenant_id=tenant_id,
        user_id=user_id,
        data_path=params.get("data_path"),
        csv_content=params.get("csv_content"),
        app_id=params.get("app_id", "kaira-bot"),
        llm_provider=params.get("llm_provider", "gemini"),
        llm_model=params.get("llm_model"),
        api_key=params.get("api_key", ""),
        service_account_path=params.get("service_account_path", ""),
        temperature=params.get("temperature", 0.1),
        intent_system_prompt=params.get("intent_system_prompt", ""),
        evaluate_intent=params.get("evaluate_intent", True),
        evaluate_correctness=params.get("evaluate_correctness", True),
        evaluate_efficiency=params.get("evaluate_efficiency", True),
        thread_ids=params.get("thread_ids"),
        sample_size=params.get("sample_size"),
        progress_callback=update_job_progress,
        name=params.get("name"),
        description=params.get("description"),
        custom_evaluator_ids=params.get("custom_evaluator_ids"),
        timeouts=params.get("timeouts"),
        parallel_threads=params.get("parallel_threads", False),
        thread_workers=params.get("thread_workers", 1),
        thinking=params.get("thinking", "low"),
        skip_previously_processed=params.get("skip_previously_processed", False),
        custom_only=params.get("custom_only", False),
        truncate_responses=params.get("truncate_responses", False),
        selected_rule_ids=params.get("selected_rule_ids"),
        azure_endpoint=params.get("azure_endpoint", ""),
        api_version=params.get("api_version", ""),
        eval_run_id=params.get("eval_run_id"),
    )
    return result


@register_job_handler(
    "evaluate-adversarial",
    queue_class="bulk",
    priority=220,
    app_id_default="kaira-bot",
    retry_safe=True,
)
async def handle_evaluate_adversarial(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run adversarial stress test against live Kaira API."""
    from app.services.evaluators.adversarial_runner import run_adversarial_evaluation

    result = await run_adversarial_evaluation(
        job_id=job_id,
        tenant_id=tenant_id,
        user_id=user_id,
        kaira_test_user_id=params.get("kaira_chat_user_id", ""),
        kaira_credential_pool=params.get("kaira_credential_pool"),
        kaira_api_url=params.get("kaira_api_url", ""),
        kaira_auth_token=params.get("kaira_auth_token", ""),
        test_count=params.get("test_count", 15),
        turn_delay=params.get("turn_delay", 1.5),
        case_delay=params.get("case_delay", 3.0),
        max_turns=params.get("max_turns", settings.ADVERSARIAL_MAX_TURNS),
        llm_provider=params.get("llm_provider", "gemini"),
        llm_model=params.get("llm_model"),
        api_key=params.get("api_key", ""),
        temperature=params.get("temperature", 0.1),
        progress_callback=update_job_progress,
        name=params.get("name"),
        description=params.get("description"),
        timeouts=params.get("timeouts"),
        parallel_cases=params.get("parallel_cases", False),
        case_workers=params.get("case_workers", 1),
        thinking=params.get("thinking", "low"),
        selected_goals=params.get("selected_goals"),
        selected_traits=params.get("selected_traits"),
        selected_rule_ids=params.get("selected_rule_ids"),
        selected_personas=params.get("selected_personas"),
        selected_persona_tactics=params.get("selected_persona_tactics"),
        persona_mixing_mode=params.get("persona_mixing_mode", "single"),
        flow_mode=params.get("flow_mode", "single"),
        extra_instructions=params.get("extra_instructions"),
        case_mode=params.get("case_mode", "generate"),
        saved_case_ids=params.get("saved_case_ids"),
        manual_cases=params.get("manual_cases"),
        include_pinned_cases=params.get("include_pinned_cases", False),
        retry_eval_ids=params.get("retry_eval_ids"),
        source_run_id=params.get("source_run_id"),
        kaira_timeout=params.get("kaira_timeout", 120),
        azure_endpoint=params.get("azure_endpoint", ""),
        api_version=params.get("api_version", ""),
        eval_run_id=params.get("eval_run_id"),
    )
    return result


@register_job_handler(
    "evaluate-voice-rx",
    queue_class="standard",
    priority=100,
    app_id_default="voice-rx",
    retry_safe=True,
)
async def handle_evaluate_voice_rx(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run voice-rx two-call evaluation (transcription + critique)."""
    from app.services.evaluators.voice_rx_runner import run_voice_rx_evaluation

    return await run_voice_rx_evaluation(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler(
    "evaluate-custom",
    queue_class="standard",
    priority=100,
    retry_safe=True,
)
async def handle_evaluate_custom(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run a custom evaluator on a voice-rx listing."""
    from app.services.evaluators.custom_evaluator_runner import run_custom_evaluator

    return await run_custom_evaluator(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler(
    "evaluate-custom-batch",
    queue_class="standard",
    priority=110,
    retry_safe=True,
)
async def handle_evaluate_custom_batch(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run multiple custom evaluators on a single entity."""
    from app.services.evaluators.custom_evaluator_runner import run_custom_eval_batch

    return await run_custom_eval_batch(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler(
    "evaluate-inside-sales",
    queue_class="standard",
    priority=110,
    app_id_default="inside-sales",
    retry_safe=True,
)
async def handle_evaluate_inside_sales(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run inside-sales call quality evaluation."""
    from app.services.evaluators.inside_sales_runner import run_inside_sales_evaluation

    return await run_inside_sales_evaluation(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler(
    "sync-external-source",
    queue_class="standard",
    priority=120,
    retry_safe=True,
    # Schedulable under inside-sales only — the LSQ adapter is the sole
    # concrete source today. When a second source lands, register another
    # ``ScheduledWorkload`` for its app at seed time instead of here.
    schedulable=True,
    schedule_app_id="inside-sales",
    schedule_label="Inside Sales CRM sync",
    schedule_description=(
        "Pulls new and updated LSQ calls and leads on every tick. "
        "Run a bootstrap refresh once before enabling the first cron "
        "so the watermark is established."
    ),
    schedule_default_params={
        "app_id": "inside-sales",
        "source_system": "lsq",
        "sync_mode": "incremental",
    },
)
async def handle_sync_external_source(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Sync an external source into local source tables."""
    from app.services.source_sync import run_external_source_sync

    return await run_external_source_sync(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler(
    "generate-report",
    queue_class="interactive",
    priority=10,
    retry_safe=True,
)
async def handle_generate_report(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Generate and persist a single-run report artifact through the generic composer."""
    from app.services.reports.report_generation_service import generate_single_run_report_artifact

    run_id = params.get("run_id")
    if not run_id:
        raise ValueError("run_id is required")

    await update_job_progress(
        job_id, 0, 2, "Resolving report config…", run_id=run_id
    )
    await update_job_progress(
        job_id, 1, 2, "Composing report artifact…", run_id=run_id
    )
    return await generate_single_run_report_artifact(
        job_id,
        params,
        tenant_id=tenant_id,
        user_id=user_id,
    )


@register_job_handler(
    "generate-evaluator-draft",
    queue_class="interactive",
    priority=20,
    retry_safe=True,
)
async def handle_generate_evaluator_draft(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Generate evaluator output-field draft from a prompt via LLM."""
    from app.services.evaluators.evaluator_draft_service import generate_evaluator_draft

    prompt = params.get("prompt", "")
    if not prompt:
        raise ValueError("prompt is required")

    app_id = params.get("app_id", "")

    # Optionally load rule catalog for auto-matching
    rule_catalog = None
    try:
        from app.services.evaluators.rules_service import load_rules
        async with async_session() as db:
            rule_catalog = await load_rules(db, app_id=app_id, tenant_id=tenant_id)
    except Exception:
        pass  # Rules may not be configured for this app

    await update_job_progress(job_id, 0, 1, "Generating evaluator draft…")

    # Coerce job_id to UUID where possible so usage rows get correct owner
    # attribution. Handler's job_id is a string; tests may pass other shapes.
    draft_job_id: uuid.UUID | None = None
    try:
        draft_job_id = uuid.UUID(str(job_id)) if job_id is not None else None
    except (ValueError, TypeError):
        draft_job_id = None

    result = await generate_evaluator_draft(
        prompt=prompt,
        app_id=app_id,
        tenant_id=str(tenant_id),
        user_id=str(user_id),
        rule_catalog=rule_catalog,
        job_id=draft_job_id,
    )

    return result


@register_job_handler(
    "generate-cross-run-report",
    queue_class="interactive",
    priority=10,
    retry_safe=True,
)
async def handle_generate_cross_run_report(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Generate and persist a cross-run report artifact through the generic composer."""
    from app.services.reports.report_generation_service import generate_cross_run_report_artifact

    app_id = params.get("app_id", "")
    if not app_id:
        raise ValueError("app_id is required")

    await update_job_progress(job_id, 0, 2, "Resolving report config…")
    await update_job_progress(job_id, 1, 2, "Composing cross-run report artifact…")
    return await generate_cross_run_report_artifact(
        job_id,
        params,
        tenant_id=tenant_id,
        user_id=user_id,
    )


@register_job_handler(
    "populate-analytics",
    queue_class="bulk",
    priority=500,
    retry_safe=True,
)
async def handle_populate_analytics(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Populate analytics fact tables for a completed eval run."""
    from app.services.analytics.fact_populator import FactPopulator

    run_id = params.get("run_id")
    if not run_id:
        raise ValueError("run_id is required")

    async with async_session() as db:
        populator = FactPopulator(db)
        result = await populator.populate(uuid.UUID(run_id))
        return result.to_dict()


@register_job_handler(
    "populate-cost-rollup",
    queue_class="bulk",
    priority=510,
    # Rollup is a pure UPSERT over analytics.fact_llm_generation → analytics.agg_llm_usage_daily, so
    # transient DB errors are always safe to retry; a partial day is never
    # observable because populate_rollup_range commits per-day.
    retry_safe=True,
    # Platform-wide daily job. app_id="" because the rollup scans all
    # tenants in one pass rather than per-app. Marked platform_managed
    # so the user-facing registry endpoint does not advertise a workload
    # that users can't actually create (ScheduledJobCreate enforces
    # ``app_id`` min_length=1). The seed_cost_rollup_schedule path
    # bypasses pydantic and writes the system-tenant row directly.
    schedulable=True,
    schedule_app_id="",
    schedule_label="LLM cost daily rollup",
    schedule_description=(
        "Rebuilds analytics.agg_llm_usage_daily for D-1 across all tenants. "
        "Seed creates a default 01:05 UTC schedule under the system tenant."
    ),
    schedule_default_params={},
    schedule_platform_managed=True,
)
async def handle_populate_cost_rollup(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Rebuild ``analytics.agg_llm_usage_daily`` for a date range.

    Params:
        start_date: YYYY-MM-DD (defaults to yesterday UTC)
        end_date:   YYYY-MM-DD (defaults to start_date)
    """
    from datetime import date, datetime, timedelta, timezone
    from app.services.cost_tracking.rollup import populate_rollup_range

    def _parse(value, default):
        if not value:
            return default
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        try:
            return date.fromisoformat(str(value))
        except (TypeError, ValueError):
            return default

    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    start = _parse(params.get("start_date"), yesterday)
    end = _parse(params.get("end_date"), start)

    async with async_session() as db:
        summary = await populate_rollup_range(db, start=start, end=end)
        await db.commit()

    return {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "days_processed": summary["days_processed"],
        "rows_upserted": summary["rows_upserted"],
        "tenants": [str(t) for t in summary["tenants"]],
    }


@register_job_handler(
    "run-workflow",
    queue_class="standard",
    priority=5,
    retry_safe=True,
)
async def handle_run_workflow(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Execute one orchestration.workflow_runs row to quiescence (or until suspended).

    Required params:
        run_id: UUID of the orchestration.workflow_runs row to execute.
    Optional params:
        resume_recipient_ids: list[str] — when present, switches to resume mode (Phase 4).

    Threads ``tenant_id`` into the inner handler so the run cannot be exec'd
    against a foreign tenant if a misrouted/forged job pointed at someone
    else's run_id.
    """
    from app.services.orchestration.run_handler import run_workflow_job

    run_id_raw = params.get("run_id")
    if not run_id_raw:
        raise ValueError("run_id is required")
    run_id = uuid.UUID(str(run_id_raw))

    async with async_session() as db:
        result = await run_workflow_job(
            run_id, db, params=params, job_id=job_id, tenant_id=tenant_id,
        )
        await db.commit()
        return result


@register_job_handler(
    "fire-orchestration-trigger",
    queue_class="standard",
    priority=5,
    retry_safe=True,
)
async def handle_fire_orchestration_trigger(
    job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID,
) -> dict:
    """Materialize a WorkflowRun from a cron WorkflowTrigger and queue run-workflow.

    The scheduler enqueues ONE row of this job-type per cron tick — it cannot
    enqueue ``run-workflow`` directly because ``run-workflow`` requires a
    pre-existing ``run_id``. This handler bridges the gap:
        1. load the trigger (tenant-scoped)
        2. load the workflow + verify it has a published version
        3. INSERT one orchestration.workflow_runs row
        4. INSERT one platform.background_jobs row of type ``run-workflow``
           with ``params={'run_id': ...}`` for the worker to pick up.

    Required params:
        trigger_id: UUID of the orchestration.workflow_triggers row.
    """
    from app.constants import SYSTEM_USER_ID
    from app.models.job import BackgroundJob as _BgJob
    from app.models.orchestration import (
        Workflow as _Wf,
        WorkflowRun as _WfRun,
        WorkflowTrigger as _WfTrig,
    )

    trigger_id_raw = params.get("trigger_id")
    if not trigger_id_raw:
        raise ValueError("trigger_id is required")
    trigger_id = uuid.UUID(str(trigger_id_raw))

    async with async_session() as db:
        trig = (await db.execute(
            select(_WfTrig).where(
                _WfTrig.id == trigger_id,
                _WfTrig.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if trig is None:
            logger.warning(
                "fire-orchestration-trigger: trigger %s not found for tenant %s",
                trigger_id, tenant_id,
            )
            return {"status": "trigger_not_found"}
        if not trig.active:
            return {"status": "trigger_inactive", "trigger_id": str(trigger_id)}

        wf = (await db.execute(
            select(_Wf).where(_Wf.id == trig.workflow_id, _Wf.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if wf is None or wf.current_published_version_id is None:
            logger.warning(
                "fire-orchestration-trigger: workflow %s not publishable",
                trig.workflow_id,
            )
            return {"status": "workflow_not_publishable", "trigger_id": str(trigger_id)}

        run = _WfRun(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            app_id=trig.app_id,
            workflow_id=wf.id,
            workflow_version_id=wf.current_published_version_id,
            trigger_id=trig.id,
            triggered_by=trig.kind,
            triggered_by_user_id=trig.created_by or SYSTEM_USER_ID,
            status="pending",
            params=trig.params or {},
        )
        db.add(run)
        await db.flush()

        next_job = _BgJob(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            app_id=trig.app_id,
            user_id=trig.created_by or user_id or SYSTEM_USER_ID,
            job_type="run-workflow",
            queue_class="standard",
            priority=5,
            params={"run_id": str(run.id)},
            status="queued",
        )
        db.add(next_job)
        await db.flush()
        run.job_id = next_job.id
        await db.commit()

        return {
            "status": "queued",
            "trigger_id": str(trigger_id),
            "run_id": str(run.id),
            "next_job_id": str(next_job.id),
        }


@register_job_handler(
    "resume-waiting-cohorts",
    queue_class="standard",
    priority=4,
    retry_safe=True,
)
async def handle_resume_waiting_cohorts(
    job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> dict:
    """Legacy resume poller — no longer scheduled (the schedulable args
    were removed when the cron was retired). The handler stays registered
    so any in-flight ``resume-waiting-cohorts`` rows from the pre-cutover
    queue complete cleanly. Functionally still does the right thing —
    just never fires from cron anymore. New code paths route resumes
    through ``enqueue_resume_for_recipient`` (per-recipient delayed
    run-workflow jobs)."""
    from app.services.orchestration.resume_poller import poll_and_resume

    async with async_session() as db:
        n = await poll_and_resume(db)
        await db.commit()
        return {"resumed": n}


@register_job_handler(
    "poll-bolna-executions",
    queue_class="standard",
    priority=4,
    retry_safe=True,
)
async def handle_poll_bolna_executions_deprecated(
    job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> dict:
    """Deprecated stub for the retired every-minute Bolna sweeper.

    Kept registered so any cron-fired jobs still in the queue from the
    pre-cutover deploy don't dead-letter. New polling is per-correlation
    (see ``poll-bolna-correlation``)."""
    return {
        "status": "deprecated",
        "reason": (
            "poll-bolna-executions has been replaced by per-correlation "
            "polling (poll-bolna-correlation)."
        ),
    }


@register_job_handler(
    "orchestration-anomaly-sweep",
    queue_class="standard",
    priority=4,
    retry_safe=True,
    schedulable=True,
    schedule_app_id="",
    schedule_label="Orchestration · anomaly sweep (off by default)",
    schedule_description=(
        "Off-by-default safety net for the per-correlation Bolna polling "
        "chain. Re-enqueues a fresh polling job for any open Bolna row "
        "older than 6 hours that has no live polling chain. Flip "
        "``enabled`` only if an orphan is observed in production."
    ),
    schedule_default_params={},
    schedule_platform_managed=True,
)
async def handle_orchestration_anomaly_sweep(
    job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> dict:
    """Find orphan Bolna correlations (open rows older than 6 h with no
    live polling job) and re-enqueue a fresh polling chain for each.

    The schedule row is seeded with ``enabled=False`` — runs only on
    manual fire-now or after an operator flips it on. Daily 03:00 UTC
    when enabled. Per-correlation polling chains (``poll-bolna-correlation``)
    self-terminate when reconciliation completes; this sweep exists for
    the rare case where the chain breaks before the row reconciles."""
    from datetime import timedelta as _td
    from app.services.orchestration.dispatch.bolna_poller import (
        find_orphan_correlations,
    )
    from app.services.orchestration.dispatch.resume_enqueue import (
        enqueue_bolna_correlation_poll,
    )

    async with async_session() as db:
        orphans = await find_orphan_correlations(db, older_than=_td(hours=6))
        re_enqueued = 0
        for orphan in orphans:
            # Anomaly sweep enqueues under the system user — we don't
            # have a run_id handy and the polling job doesn't need one
            # to do its work (it joins by correlation id, not run).
            new_id = await enqueue_bolna_correlation_poll(
                db,
                tenant_id=orphan.tenant_id,
                app_id=orphan.app_id,
                connection_id=orphan.connection_id,
                correlation_id=orphan.correlation_id,
                kind=orphan.kind,
                user_id=SYSTEM_USER_ID,
                initial_delay_seconds=5,
            )
            if new_id is not None:
                re_enqueued += 1
        await db.commit()
        return {
            "orphans_found": len(orphans),
            "re_enqueued": re_enqueued,
        }


@register_job_handler(
    "poll-bolna-correlation",
    queue_class="standard",
    priority=4,
    retry_safe=True,
)
async def handle_poll_bolna_correlation(
    job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> dict:
    """Per-correlation Bolna poll tick (replaces the every-minute cron).

    The dispatch node enqueues this job once per distinct correlation id
    (execution_id for singles, batch_id for batches). The handler fetches
    upstream, runs terminal events through ``bolna_reconciler.apply_event``,
    and either re-enqueues itself with backoff or terminates the chain
    when no rows remain open.
    """
    from app.services.orchestration.dispatch.bolna_poller import (
        poll_correlation_once,
    )
    from datetime import datetime as _dt

    correlation_id = str(params.get("correlation_id") or "")
    kind = str(params.get("kind") or "execution")
    app_id = str(params.get("app_id") or "")
    connection_id_raw = params.get("connection_id")
    attempt = int(params.get("attempt") or 1)
    first_attempt_raw = params.get("first_attempt_at")
    if not correlation_id or not connection_id_raw:
        return {"status": "error", "reason": "missing_correlation_or_connection"}
    try:
        connection_id = uuid.UUID(str(connection_id_raw))
    except (TypeError, ValueError):
        return {"status": "error", "reason": "invalid_connection_id"}
    first_attempt_at: Optional[datetime] = None
    if isinstance(first_attempt_raw, str) and first_attempt_raw:
        try:
            first_attempt_at = _dt.fromisoformat(first_attempt_raw)
        except ValueError:
            first_attempt_at = None

    async with async_session() as db:
        result = await poll_correlation_once(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            connection_id=connection_id,
            correlation_id=correlation_id,
            kind=kind,
            attempt=attempt,
            first_attempt_at=first_attempt_at,
        )
        await db.commit()
        out: dict = {
            "status": result.status,
            "attempt": result.attempt,
            "events_reconciled": result.events_reconciled,
        }
        if result.next_attempt is not None:
            out["next_attempt"] = result.next_attempt
        if result.error:
            out["error"] = result.error
        return out
