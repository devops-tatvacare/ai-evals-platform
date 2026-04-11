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

from app.config import settings
from app.database import async_session
from app.models.job import Job
from app.models.eval_run import EvalRun

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
JOB_QUEUE_DEFAULTS: dict[str, dict[str, int | str]] = {
    "generate-report": {"queue_class": "interactive", "priority": 10},
    "generate-cross-run-report": {"queue_class": "interactive", "priority": 10},
    "generate-evaluator-draft": {"queue_class": "interactive", "priority": 20},
    "sync-external-source": {"queue_class": "standard", "priority": 120},
    "evaluate-voice-rx": {"queue_class": "standard", "priority": 100},
    "evaluate-custom": {"queue_class": "standard", "priority": 100},
    "evaluate-custom-batch": {"queue_class": "standard", "priority": 110},
    "evaluate-inside-sales": {"queue_class": "standard", "priority": 110},
    "evaluate-batch": {"queue_class": "bulk", "priority": 200},
    "evaluate-adversarial": {"queue_class": "bulk", "priority": 220},
    "populate-analytics": {"queue_class": "bulk", "priority": 500},
}
JOB_APP_DEFAULTS: dict[str, str] = {
    "evaluate-voice-rx": "voice-rx",
    "evaluate-inside-sales": "inside-sales",
    "evaluate-batch": "kaira-bot",
    "evaluate-adversarial": "kaira-bot",
}
RETRY_SAFE_JOB_TYPES = frozenset({
    "generate-report",
    "generate-cross-run-report",
    "generate-evaluator-draft",
    "sync-external-source",
    "populate-analytics",
})


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


def _format_job_context(job: Job | None = None, **extra) -> str:
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


def _log_job_event(level: int, event: str, job: Job | None = None, **extra) -> None:
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


def _apply_job_metadata(job: Job) -> None:
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


def _running_quota_counts(jobs: list[Job]) -> dict[str, Counter]:
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


def _is_retryable_error(error: Exception) -> bool:
    if isinstance(error, (asyncio.TimeoutError, TimeoutError, ConnectionError)):
        return True

    name = type(error).__name__.lower()
    message = str(error).lower()
    retryable_fragments = (
        "timed out",
        "timeout",
        "temporarily unavailable",
        "temporary failure",
        "connection reset",
        "connection aborted",
        "connection error",
        "service unavailable",
        "too many requests",
        "rate limit",
        " 429",
        " 500",
        " 502",
        " 503",
        " 504",
    )
    if "timeout" in name or "connection" in name:
        return True
    return any(fragment in message for fragment in retryable_fragments)


def _retry_delay_seconds(attempt_count: int) -> int:
    exponent = max(attempt_count - 1, 0)
    delay = settings.JOB_RETRY_BASE_DELAY_SECONDS * (2 ** exponent)
    return min(delay, settings.JOB_RETRY_MAX_DELAY_SECONDS)


def _failure_transition(job: Job, error: Exception, now: datetime) -> dict[str, object]:
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


def _can_claim_job(job: Job, counts: dict[str, Counter]) -> bool:
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
    }
    return counts["queue_class"][queue_class] < class_limit_map.get(queue_class, MAX_CONCURRENT_JOBS)


def _reserve_claim(job: Job, counts: dict[str, Counter]) -> None:
    counts["tenant"][_tenant_key(job)] += 1
    counts["app"][_app_key(job)] += 1
    counts["user"][_user_key(job)] += 1
    counts["queue_class"][_clean_str(job.queue_class)] += 1


def _select_jobs_for_claim(
    candidates: list[Job],
    limit: int,
    counts: dict[str, Counter],
) -> list[Job]:
    groups: dict[tuple[str, str], list[Job]] = {}
    for job in candidates:
        _apply_job_metadata(job)
        groups.setdefault(_app_key(job), []).append(job)

    selected: list[Job] = []
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
            select(Job).where(
                Job.status == "running",
                or_(
                    Job.lease_expires_at < now,
                    and_(
                        Job.lease_expires_at.is_(None),
                        Job.started_at < cutoff,
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


async def recover_stale_eval_runs():
    """Reconcile eval_runs stuck in 'running' whose job is already terminal.

    This handles the case where:
    - The worker crashed mid-LLM-call and never updated the eval_run
    - The cancel route's UPDATE missed the eval_run (race condition)
    - Docker restart killed the worker before the runner's except handler ran

    Call on startup AFTER recover_stale_jobs() so jobs are already in their
    correct terminal state.
    """
    async with async_session() as db:
        result = await db.execute(
            select(EvalRun)
            .join(Job, EvalRun.job_id == Job.id)
            .where(
                EvalRun.status == "running",
                Job.status.in_(["completed", "failed", "cancelled"]),
            )
        )
        stale_runs = result.scalars().all()
        for run in stale_runs:
            job = await db.get(Job, run.job_id)
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


# Job handler registry - add new job types here
JOB_HANDLERS = {}


def register_job_handler(job_type: str):
    """Decorator to register a job handler function."""

    def decorator(func):
        JOB_HANDLERS[job_type] = func
        return func

    return decorator


async def process_job(job_id, job_type: str, params: dict) -> dict:
    """Dispatch job to the appropriate handler.

    Extracts tenant_id/user_id from params (injected by the job submission
    route) and passes them as keyword args to the handler.
    """
    handler = JOB_HANDLERS.get(job_type)
    if not handler:
        raise ValueError(f"Unknown job type: {job_type}")

    tenant_id = uuid.UUID(params["tenant_id"])
    user_id = uuid.UUID(params["user_id"])
    return await handler(job_id, params, tenant_id=tenant_id, user_id=user_id)


async def update_job_progress(
    job_id, current: int, total: int, message: str = "", **extra
):
    """Update job progress (called from within handlers).

    Extra kwargs (run_id, listing_id, evaluator_id, etc.) are merged into
    the progress dict.  Preserves run_id from existing progress unless
    explicitly overridden.
    """
    async with async_session() as db:
        job = await db.get(Job, job_id)
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
        stmt = select(Job).where(Job.id == job_id, Job.status == "cancelled")
        if tenant_id is not None:
            stmt = stmt.where(Job.tenant_id == tenant_id)
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
            running_result = await db.execute(
                select(Job).where(
                    Job.status == "running",
                    or_(
                        Job.lease_expires_at.is_(None),
                        Job.lease_expires_at > now,
                    ),
                )
            )
            running_jobs = running_result.scalars().all()
            counts = _running_quota_counts(running_jobs)

            result = await db.execute(
                select(Job)
                .where(
                    or_(
                        Job.status == "queued",
                        and_(
                            Job.status == "retryable_failed",
                            Job.next_retry_at.is_not(None),
                            Job.next_retry_at <= now,
                        ),
                    )
                )
                .order_by(
                    Job.priority.asc(),
                    func.coalesce(Job.next_retry_at, Job.created_at).asc(),
                    Job.created_at.asc(),
                    Job.id.asc(),
                )
                .limit(claim_window)
                .with_for_update(skip_locked=True)
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
                    update(Job)
                    .where(
                        Job.id == job_id,
                        Job.status == "running",
                        Job.lease_owner == worker_id,
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
                job = await db.get(Job, job_id)
                if not job:
                    return
                if job.status == "cancelled":
                    logger.info(
                        f"Job {job_id} was cancelled during execution, skipping completed update"
                    )
                elif job.status != "running" or job.lease_owner != WORKER_INSTANCE_ID:
                    logger.warning(
                        "Job %s finished after lease ownership changed; skipping completed update",
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
            logger.error("Job %s failed: %s", job_id, e)
            logger.error(traceback.format_exc())

            # Re-fetch job in a fresh session and mark as failed.
            # Retry up to 3 times so a transient DB error doesn't
            # leave the job stuck in "running" forever.
            for attempt in range(3):
                try:
                    async with async_session() as db2:
                        j = await db2.get(Job, job_id)
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
                                    update(EvalRun)
                                    .where(
                                        EvalRun.job_id == job_id,
                                        EvalRun.status == "running",
                                    )
                                    .values(
                                        status="failed",
                                        error_message=j.error_message,
                                        completed_at=j.completed_at,
                                    )
                                )
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
        "Job worker started (worker_id=%s, max_concurrent=%d)",
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


async def recovery_loop():
    """Periodically recover stale jobs and eval runs."""
    logger.info("Recovery loop started (interval=300s)")
    while True:
        await asyncio.sleep(300)
        try:
            await recover_stale_jobs()
            await recover_stale_eval_runs()
        except Exception as e:
            logger.error(f"Recovery loop error: {e}")


async def get_queue_position(job_id: str) -> int:
    """Return 0-based queue position for a queued job. -1 if not queued."""
    async with async_session() as db:
        job = await db.get(Job, job_id)
        now = datetime.now(timezone.utc)
        if not job:
            return -1
        if job.status == "retryable_failed":
            if job.next_retry_at and job.next_retry_at > now:
                return -1
        elif job.status != "queued":
            return -1
        result = await db.execute(
            select(func.count())
            .select_from(Job)
            .where(
                or_(
                    Job.status == "queued",
                    and_(
                        Job.status == "retryable_failed",
                        Job.next_retry_at.is_not(None),
                        Job.next_retry_at <= now,
                    ),
                ),
                or_(
                    Job.priority < job.priority,
                    and_(Job.priority == job.priority, Job.created_at < job.created_at),
                ),
            )
        )
        return result.scalar() or 0


# ── Job Handlers ─────────────────────────────────────────────────


@register_job_handler("evaluate-batch")
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
    )
    return result


@register_job_handler("evaluate-adversarial")
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
    )
    return result


@register_job_handler("evaluate-voice-rx")
async def handle_evaluate_voice_rx(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run voice-rx two-call evaluation (transcription + critique)."""
    from app.services.evaluators.voice_rx_runner import run_voice_rx_evaluation

    return await run_voice_rx_evaluation(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler("evaluate-custom")
async def handle_evaluate_custom(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run a custom evaluator on a voice-rx listing."""
    from app.services.evaluators.custom_evaluator_runner import run_custom_evaluator

    return await run_custom_evaluator(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler("evaluate-custom-batch")
async def handle_evaluate_custom_batch(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run multiple custom evaluators on a single entity."""
    from app.services.evaluators.custom_evaluator_runner import run_custom_eval_batch

    return await run_custom_eval_batch(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler("evaluate-inside-sales")
async def handle_evaluate_inside_sales(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Run inside-sales call quality evaluation."""
    from app.services.evaluators.inside_sales_runner import run_inside_sales_evaluation

    return await run_inside_sales_evaluation(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler("sync-external-source")
async def handle_sync_external_source(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Sync an external source into local mirror tables."""
    from app.services.source_sync import run_external_source_sync

    return await run_external_source_sync(job_id=job_id, params=params, tenant_id=tenant_id, user_id=user_id)


@register_job_handler("generate-report")
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


@register_job_handler("generate-evaluator-draft")
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

    result = await generate_evaluator_draft(
        prompt=prompt,
        app_id=app_id,
        tenant_id=str(tenant_id),
        user_id=str(user_id),
        rule_catalog=rule_catalog,
    )

    return result


@register_job_handler("generate-cross-run-report")
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


@register_job_handler("populate-analytics")
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
