"""Background job worker.

Polls the jobs table for 'queued' jobs and processes them.
Runs as an asyncio task within the FastAPI process.

For production scale: extract to a separate worker process or use Celery.
For current scale (company-internal): this is sufficient.
"""
import asyncio
import logging
import time
import traceback
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, select, update

from app.database import async_session
from app.models.job import Job
from app.models.eval_run import EvalRun

logger = logging.getLogger(__name__)

# ── In-memory cancel cache ───────────────────────────────────────
# Avoids per-item DB queries in parallel_engine / runner hot loops.
# mark_job_cancelled() is called by the cancel route AFTER commit.
# is_job_cancelled() checks this set first, DB fallback every 10s.
_cancelled_jobs: set[str] = set()
_cancel_check_times: dict[str, float] = {}
_CANCEL_CHECK_INTERVAL = 10.0  # seconds between DB fallback checks


async def recover_stale_jobs(stale_minutes: int = 15):
    """Mark jobs stuck in 'running' for longer than `stale_minutes` as failed.

    Call on startup to recover from process crashes that left jobs stranded.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=stale_minutes)
    async with async_session() as db:
        result = await db.execute(
            select(Job).where(
                and_(
                    Job.status == "running",
                    Job.started_at < cutoff,
                )
            )
        )
        stale_jobs = result.scalars().all()
        for job in stale_jobs:
            job.status = "failed"
            job.error_message = f"Recovered on startup: job was running for >{stale_minutes} minutes"
            job.completed_at = datetime.now(timezone.utc)
            logger.warning(f"Recovered stale job {job.id} (started at {job.started_at})")
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
            select(EvalRun).join(Job, EvalRun.job_id == Job.id).where(
                EvalRun.status == "running",
                Job.status.in_(["completed", "failed", "cancelled"]),
            )
        )
        stale_runs = result.scalars().all()
        for run in stale_runs:
            job = await db.get(Job, run.job_id)
            run.status = "cancelled" if job.status == "cancelled" else "failed"
            run.error_message = f"Recovered on startup: job was {job.status}"
            run.completed_at = datetime.now(timezone.utc)
            logger.warning(f"Recovered stale eval_run {run.id} (job {run.job_id} was {job.status})")
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


# Job handler registry - add new job types here
JOB_HANDLERS = {}


def register_job_handler(job_type: str):
    """Decorator to register a job handler function."""
    def decorator(func):
        JOB_HANDLERS[job_type] = func
        return func
    return decorator


async def process_job(job_id, job_type: str, params: dict) -> dict:
    """Dispatch job to the appropriate handler."""
    handler = JOB_HANDLERS.get(job_type)
    if not handler:
        raise ValueError(f"Unknown job type: {job_type}")
    return await handler(job_id, params)


async def update_job_progress(job_id, current: int, total: int, message: str = ""):
    """Update job progress (called from within handlers).

    Preserves run_id from existing progress so the frontend can always
    find the associated eval_run for redirect.
    """
    async with async_session() as db:
        job = await db.get(Job, job_id)
        if job:
            new_progress = {"current": current, "total": total, "message": message}
            # Preserve run_id if it was set previously
            if isinstance(job.progress, dict) and "run_id" in job.progress:
                new_progress["run_id"] = job.progress["run_id"]
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


async def is_job_cancelled(job_id) -> bool:
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
        job = await db.get(Job, job_id)
        if job is not None and job.status == "cancelled":
            _cancelled_jobs.add(job_key)
            return True
    return False


async def worker_loop():
    """Main worker loop. Polls for queued jobs every 5 seconds."""
    logger.info("Job worker started")
    while True:
        try:
            async with async_session() as db:
                # Pick the oldest queued job
                result = await db.execute(
                    select(Job)
                    .where(Job.status == "queued")
                    .order_by(Job.created_at)
                    .limit(1)
                )
                job = result.scalar_one_or_none()

                if job:
                    logger.info(f"Processing job {job.id} (type={job.job_type})")

                    # Mark as running
                    job.status = "running"
                    job.started_at = datetime.now(timezone.utc)
                    await db.commit()

                    try:
                        result_data = await process_job(job.id, job.job_type, job.params)

                        # Re-check: if job was cancelled during execution, don't overwrite
                        await db.refresh(job)
                        if job.status == "cancelled":
                            logger.info(f"Job {job.id} was cancelled during execution, skipping completed update")
                        else:
                            job.status = "completed"
                            job.result = result_data or {}
                            job.completed_at = datetime.now(timezone.utc)
                            # Preserve run_id so frontend can still redirect
                            done_progress = {"current": 1, "total": 1, "message": "Done"}
                            if isinstance(job.progress, dict) and "run_id" in job.progress:
                                done_progress["run_id"] = job.progress["run_id"]
                            job.progress = done_progress
                            await db.commit()
                            logger.info(f"Job {job.id} completed")
                        _cleanup_cancelled_job(job.id)

                    except Exception as e:
                        logger.error(f"Job {job.id} failed: {e}")
                        logger.error(traceback.format_exc())

                        # Re-fetch job in a fresh session and mark as failed.
                        # Retry up to 3 times so a transient DB error doesn't
                        # leave the job stuck in "running" forever.
                        for attempt in range(3):
                            try:
                                async with async_session() as db2:
                                    j = await db2.get(Job, job.id)
                                    if j and j.status not in ("completed", "cancelled"):
                                        j.status = "failed"
                                        # Format step-specific error for PipelineStepError
                                        if hasattr(e, 'step') and hasattr(e, 'message'):
                                            j.error_message = f"[{e.step}] {e.message}"[:2000]
                                        else:
                                            j.error_message = safe_error_message(e)[:2000]
                                        j.completed_at = datetime.now(timezone.utc)
                                        await db2.commit()
                                break
                            except Exception as db_err:
                                logger.error(
                                    f"Failed to mark job {job.id} as failed "
                                    f"(attempt {attempt + 1}/3): {db_err}"
                                )
                                if attempt < 2:
                                    await asyncio.sleep(1)
                        _cleanup_cancelled_job(job.id)

        except Exception as e:
            logger.error(f"Worker loop error: {e}")

        await asyncio.sleep(5)


# ── Job Handlers ─────────────────────────────────────────────────

@register_job_handler("evaluate-batch")
async def handle_evaluate_batch(job_id, params: dict) -> dict:
    """Run batch evaluation on threads from a data file."""
    from app.services.evaluators.batch_runner import run_batch_evaluation

    result = await run_batch_evaluation(
        job_id=job_id,
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
    )
    return result


@register_job_handler("evaluate-adversarial")
async def handle_evaluate_adversarial(job_id, params: dict) -> dict:
    """Run adversarial stress test against live Kaira API."""
    from app.services.evaluators.adversarial_runner import run_adversarial_evaluation

    result = await run_adversarial_evaluation(
        job_id=job_id,
        user_id=params.get("user_id", ""),
        kaira_api_url=params.get("kaira_api_url", ""),
        kaira_auth_token=params.get("kaira_auth_token", ""),
        test_count=params.get("test_count", 15),
        turn_delay=params.get("turn_delay", 1.5),
        case_delay=params.get("case_delay", 3.0),
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
        selected_categories=params.get("selected_categories"),
        extra_instructions=params.get("extra_instructions"),
        kaira_timeout=params.get("kaira_timeout", 120),
    )
    return result


@register_job_handler("evaluate-voice-rx")
async def handle_evaluate_voice_rx(job_id, params: dict) -> dict:
    """Run voice-rx two-call evaluation (transcription + critique)."""
    from app.services.evaluators.voice_rx_runner import run_voice_rx_evaluation
    return await run_voice_rx_evaluation(job_id=job_id, params=params)


@register_job_handler("evaluate-custom")
async def handle_evaluate_custom(job_id, params: dict) -> dict:
    """Run a custom evaluator on a voice-rx listing."""
    from app.services.evaluators.custom_evaluator_runner import run_custom_evaluator
    return await run_custom_evaluator(job_id=job_id, params=params)


@register_job_handler("evaluate-custom-batch")
async def handle_evaluate_custom_batch(job_id, params: dict) -> dict:
    """Run multiple custom evaluators on a single entity."""
    from app.services.evaluators.voice_rx_batch_custom_runner import run_voice_rx_batch_custom
    return await run_voice_rx_batch_custom(job_id=job_id, params=params)
