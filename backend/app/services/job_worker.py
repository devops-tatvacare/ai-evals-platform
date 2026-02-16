"""Background job worker.

Polls the jobs table for 'queued' jobs and processes them.
Runs as an asyncio task within the FastAPI process.

For production scale: extract to a separate worker process or use Celery.
For current scale (company-internal): this is sufficient.
"""
import asyncio
import logging
import traceback
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.job import Job

logger = logging.getLogger(__name__)

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
    """Update job progress (called from within handlers)."""
    async with async_session() as db:
        await db.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(progress={"current": current, "total": total, "message": message})
        )
        await db.commit()


async def is_job_cancelled(job_id) -> bool:
    """Check if a job has been cancelled (for cooperative cancellation)."""
    async with async_session() as db:
        job = await db.get(Job, job_id)
        return job is not None and job.status == "cancelled"


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

                        # Mark as completed
                        job.status = "completed"
                        job.result = result_data or {}
                        job.completed_at = datetime.now(timezone.utc)
                        job.progress = {"current": 1, "total": 1, "message": "Done"}
                        await db.commit()
                        logger.info(f"Job {job.id} completed")

                    except Exception as e:
                        logger.error(f"Job {job.id} failed: {e}")
                        logger.error(traceback.format_exc())

                        # Re-fetch job in case session was invalidated
                        async with async_session() as db2:
                            j = await db2.get(Job, job.id)
                            if j:
                                j.status = "failed"
                                j.error_message = str(e)
                                j.completed_at = datetime.now(timezone.utc)
                                await db2.commit()

        except Exception as e:
            logger.error(f"Worker loop error: {e}")

        await asyncio.sleep(5)


# ── Placeholder job handler ──────────────────────────────────────

@register_job_handler("evaluate-batch")
async def handle_evaluate_batch(job_id, params: dict) -> dict:
    """Placeholder for batch evaluation job. Replaced in step 3.4."""
    total = params.get("total_items", 5)
    for i in range(total):
        if await is_job_cancelled(job_id):
            return {"total_processed": i, "summary": "Cancelled"}
        await update_job_progress(job_id, i + 1, total, f"Processing item {i + 1}/{total}")
        await asyncio.sleep(1)

    return {"total_processed": total, "summary": "Placeholder evaluation complete"}
