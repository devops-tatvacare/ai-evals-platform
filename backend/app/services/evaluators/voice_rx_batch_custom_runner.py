"""Voice-RX batch custom evaluator runner — runs multiple evaluators on one listing.

Creates N EvalRun rows (one per evaluator, eval_type='custom').
Called by the job worker when processing 'evaluate-custom-batch' jobs.
"""
import asyncio
import logging

from sqlalchemy import update

from app.database import async_session
from app.models.evaluator import Evaluator
from app.models.job import Job
from app.services.evaluators.custom_evaluator_runner import run_custom_evaluator
from app.services.job_worker import is_job_cancelled, JobCancelledError, safe_error_message

logger = logging.getLogger(__name__)


async def run_voice_rx_batch_custom(job_id, params: dict) -> dict:
    """Run multiple custom evaluators on a single listing/session.

    Params:
        evaluator_ids: list[str]  - UUIDs of evaluators to run
        listing_id: str           - UUID of listing (voice-rx)
        session_id: str           - UUID of session (kaira-bot) — optional
        app_id: str               - "voice-rx" or "kaira-bot"
        parallel: bool            - Run evaluators in parallel (default: True)
        timeouts: dict            - LLM timeout config
    """
    evaluator_ids = params["evaluator_ids"]
    listing_id = params.get("listing_id")
    session_id = params.get("session_id")
    app_id = params.get("app_id", "voice-rx")
    parallel = params.get("parallel", True)

    # Validate evaluators exist
    async with async_session() as db:
        valid_ids = []
        for eid in evaluator_ids:
            ev = await db.get(Evaluator, eid)
            if ev:
                valid_ids.append(eid)
            else:
                logger.warning("Evaluator %s not found, skipping", eid)

        if not valid_ids:
            raise ValueError("No valid evaluators found")

    total = len(valid_ids)
    completed = 0
    errors = 0
    eval_run_ids = []

    async def _update_progress(current, message):
        async with async_session() as db:
            await db.execute(
                update(Job).where(Job.id == job_id).values(
                    progress={
                        "current": current,
                        "total": total,
                        "message": message,
                    }
                )
            )
            await db.commit()

    await _update_progress(0, f"Starting {total} evaluators...")

    async def _run_one(eid, index):
        """Run one evaluator, creating its own EvalRun via custom_evaluator_runner."""
        nonlocal completed, errors

        if await is_job_cancelled(job_id):
            raise JobCancelledError("Batch cancelled")

        sub_params = {
            "evaluator_id": eid,
            "app_id": app_id,
            "timeouts": params.get("timeouts"),
        }
        if listing_id:
            sub_params["listing_id"] = listing_id
        if session_id:
            sub_params["session_id"] = session_id

        try:
            result = await run_custom_evaluator(job_id=job_id, params=sub_params)
            eval_run_ids.append(result.get("eval_run_id"))
            completed += 1
            return result
        except Exception as e:
            errors += 1
            logger.error("Batch custom eval %s failed: %s", eid, e)
            return {"evaluator_id": eid, "status": "failed", "error": safe_error_message(e)}

    try:
        if parallel:
            tasks = [_run_one(eid, i) for i, eid in enumerate(valid_ids)]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for i, r in enumerate(results):
                if isinstance(r, Exception):
                    errors += 1
                    logger.error("Batch custom eval %s raised: %s", valid_ids[i], r)
        else:
            for i, eid in enumerate(valid_ids):
                await _update_progress(i, f"Running evaluator {i + 1}/{total}...")
                await _run_one(eid, i)

        await _update_progress(total, f"Completed: {completed} success, {errors} failed")

    except JobCancelledError:
        logger.info("Batch custom eval cancelled at %d/%d", completed, total)
        raise

    return {
        "total": total,
        "completed": completed,
        "errors": errors,
        "eval_run_ids": eval_run_ids,
    }
