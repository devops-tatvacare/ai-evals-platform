"""Background job worker.

Polls the jobs table for 'queued' jobs and processes them concurrently.
Runs as asyncio tasks within the FastAPI process.

For production scale: extract to a separate worker process or use Celery.
For current scale (company-internal): this is sufficient.
"""

import asyncio
import logging
import time
import traceback
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, select, update

from app.database import async_session
from app.models.job import Job
from app.models.eval_run import EvalRun

logger = logging.getLogger(__name__)

# ── Concurrency primitives ───────────────────────────────────────
MAX_CONCURRENT_JOBS = 3
_job_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
_active_tasks: dict[str, asyncio.Task] = {}

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
            job.error_message = (
                f"Recovered on startup: job was running for >{stale_minutes} minutes"
            )
            job.completed_at = datetime.now(timezone.utc)
            logger.warning(
                f"Recovered stale job {job.id} (started at {job.started_at})"
            )
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
            run.error_message = f"Recovered on startup: job was {job.status}"
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


async def _run_job(job_id: str, job_type: str, params: dict) -> None:
    """Execute a single job under the concurrency semaphore."""
    async with _job_semaphore:
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
                else:
                    job.status = "completed"
                    job.result = result_data or {}
                    job.completed_at = datetime.now(timezone.utc)
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
                    logger.info(f"Job {job_id} completed")
            _cleanup_cancelled_job(job_id)

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            logger.error(traceback.format_exc())

            # Re-fetch job in a fresh session and mark as failed.
            # Retry up to 3 times so a transient DB error doesn't
            # leave the job stuck in "running" forever.
            for attempt in range(3):
                try:
                    async with async_session() as db2:
                        j = await db2.get(Job, job_id)
                        if j and j.status not in ("completed", "cancelled"):
                            j.status = "failed"
                            # Format step-specific error for PipelineStepError
                            if hasattr(e, "step") and hasattr(e, "message"):
                                error_message = f"[{e.step}] {e.message}"[:2000]
                            else:
                                error_message = safe_error_message(e)[:2000]
                            j.error_message = error_message
                            j.completed_at = datetime.now(timezone.utc)
                            await db2.execute(
                                update(EvalRun)
                                .where(
                                    EvalRun.job_id == job_id,
                                    EvalRun.status == "running",
                                )
                                .values(
                                    status="failed",
                                    error_message=error_message,
                                    completed_at=j.completed_at,
                                )
                            )
                            await db2.commit()
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
            _active_tasks.pop(str(job_id), None)


async def worker_loop():
    """Main worker loop. Polls for queued jobs and runs them concurrently."""
    logger.info("Job worker started (max_concurrent=%d)", MAX_CONCURRENT_JOBS)
    while True:
        try:
            available_slots = MAX_CONCURRENT_JOBS - len(_active_tasks)
            if available_slots > 0:
                async with async_session() as db:
                    result = await db.execute(
                        select(Job)
                        .where(Job.status == "queued")
                        .order_by(Job.created_at)
                        .limit(available_slots)
                    )
                    jobs = result.scalars().all()

                    for job in jobs:
                        job_key = str(job.id)
                        if job_key in _active_tasks:
                            continue

                        logger.info(f"Processing job {job.id} (type={job.job_type})")
                        job.status = "running"
                        job.started_at = datetime.now(timezone.utc)
                        await db.commit()

                        task = asyncio.create_task(
                            _run_job(job_key, job.job_type, job.params)
                        )
                        _active_tasks[job_key] = task

        except Exception as e:
            logger.error(f"Worker loop error: {e}")

        await asyncio.sleep(5)


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
        if not job or job.status != "queued":
            return -1
        result = await db.execute(
            select(func.count())
            .select_from(Job)
            .where(
                Job.status == "queued",
                Job.created_at < job.created_at,
            )
        )
        return result.scalar() or 0


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
        skip_previously_processed=params.get("skip_previously_processed", False),
        custom_only=params.get("custom_only", False),
        truncate_responses=params.get("truncate_responses", False),
        azure_endpoint=params.get("azure_endpoint", ""),
        api_version=params.get("api_version", ""),
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
        selected_goals=params.get("selected_goals"),
        flow_mode=params.get("flow_mode", "single"),
        extra_instructions=params.get("extra_instructions"),
        kaira_timeout=params.get("kaira_timeout", 120),
        azure_endpoint=params.get("azure_endpoint", ""),
        api_version=params.get("api_version", ""),
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
    from app.services.evaluators.custom_evaluator_runner import run_custom_eval_batch

    return await run_custom_eval_batch(job_id=job_id, params=params)


@register_job_handler("generate-report")
async def handle_generate_report(job_id, params: dict) -> dict:
    """Generate a single-run evaluation report (aggregation + AI narrative).

    Params:
        run_id (str): eval run UUID
        refresh (bool): force regeneration, bypass cache
        provider (str|None): LLM provider for narrative
        model (str|None): LLM model for narrative
    """
    import time as _time
    from app.database import async_session as _async_session
    from app.services.reports.report_service import ReportService

    run_id = params.get("run_id")
    if not run_id:
        raise ValueError("run_id is required")

    start = _time.monotonic()

    await update_job_progress(
        job_id, 0, 2, "Aggregating evaluation data…", run_id=run_id
    )

    async with _async_session() as db:
        service = ReportService(db)
        await update_job_progress(
            job_id, 1, 2, "Generating AI narrative…", run_id=run_id
        )
        payload = await service.generate(
            run_id,
            force_refresh=params.get("refresh", False),
            llm_provider=params.get("provider"),
            llm_model=params.get("model"),
        )

    duration = round(_time.monotonic() - start, 2)

    return {
        "run_id": run_id,
        "duration_seconds": duration,
        "has_narrative": payload.narrative is not None,
        "health_grade": payload.health_score.grade if payload.health_score else None,
    }


@register_job_handler("generate-cross-run-report")
async def handle_generate_cross_run_report(job_id, params: dict) -> dict:
    """Generate cross-run AI summary (LLM call on aggregated analytics).

    Params:
        app_id (str): application ID
        stats (dict): cross-run stats payload
        health_trend (list): trend data
        top_issues (list): top issues data
        provider (str|None): LLM provider
        model (str|None): LLM model
    """
    import time as _time
    from app.database import async_session as _async_session
    from app.services.reports.cross_run_narrator import CrossRunNarrator
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    from app.services.evaluators.llm_base import create_llm_provider

    app_id = params.get("app_id", "")
    start = _time.monotonic()

    await update_job_progress(job_id, 0, 1, "Generating cross-run AI summary…")

    # Resolve LLM credentials — use provider from job params so the correct
    # provider-specific API key is resolved from the DB settings.
    job_provider = params.get("provider") or None
    db_settings = await get_llm_settings_from_db(
        provider_override=job_provider, auth_intent="managed_job"
    )
    provider_name = job_provider or db_settings.get("provider", "gemini")
    model_name = params.get("model") or db_settings.get("selected_model", "")
    api_key = db_settings.get("api_key", "")

    provider = create_llm_provider(
        provider=provider_name,
        model_name=model_name,
        api_key=api_key,
        service_account_path=db_settings.get("service_account_path", ""),
        azure_endpoint=db_settings.get("azure_endpoint", ""),
        api_version=db_settings.get("api_version", ""),
    )

    narrator = CrossRunNarrator(provider)
    summary = await narrator.generate(
        stats=params.get("stats", {}),
        health_trend=params.get("health_trend", []),
        top_issues=params.get("top_issues", []),
        top_recommendations=params.get("top_recommendations", []),
    )

    # Cache the summary in evaluation_analytics
    async with _async_session() as db:
        from app.models.evaluation_analytics import EvaluationAnalytics
        from sqlalchemy import select as _select
        from datetime import datetime as _dt, timezone as _tz

        result = await db.execute(
            _select(EvaluationAnalytics).where(
                EvaluationAnalytics.scope == "cross_run_summary",
                EvaluationAnalytics.app_id == app_id,
            )
        )
        existing = result.scalar_one_or_none()
        summary_data = (
            summary.model_dump() if hasattr(summary, "model_dump") else summary
        )
        if existing:
            existing.analytics_data = summary_data
            existing.computed_at = _dt.now(_tz.utc)
        else:
            db.add(
                EvaluationAnalytics(
                    app_id=app_id,
                    scope="cross_run_summary",
                    analytics_data=summary_data,
                )
            )
        await db.commit()

    duration = round(_time.monotonic() - start, 2)
    return {
        "app_id": app_id,
        "duration_seconds": duration,
        "summary": summary_data,
    }
