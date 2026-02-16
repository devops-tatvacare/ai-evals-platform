"""Adversarial evaluation runner — orchestrates stress tests and persists results.

Parallel to batch_runner.py but for adversarial evaluations.
Called by the job worker when processing 'evaluate-adversarial' jobs.
"""
import logging
import time
from typing import Optional, Callable

from sqlalchemy import update

from app.database import async_session
from app.models.eval_run import EvalRun, AdversarialEvaluation as DBAdversarialEval, ApiLog
from app.models.job import Job
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.adversarial_evaluator import AdversarialEvaluator
from app.services.evaluators.models import RunMetadata, serialize
from app.services.job_worker import is_job_cancelled, JobCancelledError

logger = logging.getLogger(__name__)

ProgressCallback = Callable  # async (job_id, current, total, message) -> None


async def _save_api_log(log_entry: dict):
    """Persist an LLM API log entry to PostgreSQL."""
    async with async_session() as db:
        db.add(ApiLog(
            run_id=log_entry.get("run_id"),
            thread_id=log_entry.get("thread_id"),
            provider=log_entry.get("provider", "unknown"),
            model=log_entry.get("model", "unknown"),
            method=log_entry.get("method", "unknown"),
            prompt=log_entry.get("prompt", ""),
            system_prompt=log_entry.get("system_prompt"),
            response=log_entry.get("response"),
            error=log_entry.get("error"),
            duration_ms=log_entry.get("duration_ms"),
            tokens_in=log_entry.get("tokens_in"),
            tokens_out=log_entry.get("tokens_out"),
        ))
        await db.commit()


async def run_adversarial_evaluation(
    job_id,
    user_id: str,
    kaira_api_url: str = "",
    kaira_auth_token: str = "",
    test_count: int = 15,
    turn_delay: float = 1.5,
    case_delay: float = 3.0,
    llm_provider: str = "gemini",
    llm_model: Optional[str] = None,
    api_key: str = "",
    temperature: float = 0.1,
    progress_callback: Optional[ProgressCallback] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> dict:
    """Run adversarial stress test against live Kaira API.

    This is the main entry point called from the job worker.
    """
    start_time = time.monotonic()
    run_id = RunMetadata.new_run_id()

    # Create eval run record FIRST so failures are always visible in the UI
    async with async_session() as db:
        db.add(EvalRun(
            id=run_id, job_id=job_id, command="adversarial",
            name=name, description=description,
            llm_provider=llm_provider or "gemini",
            llm_model=llm_model or "",
            eval_temperature=temperature,
            status="running", total_items=test_count,
        ))
        await db.commit()

    # Write run_id to job progress so frontend can redirect early
    async with async_session() as db:
        await db.execute(
            update(Job).where(Job.id == job_id).values(
                progress={
                    "current": 0, "total": test_count,
                    "message": "Initializing...", "run_id": run_id,
                }
            )
        )
        await db.commit()

    # Resolve API key from settings if not provided
    if not api_key:
        from app.services.evaluators.settings_helper import get_llm_settings_from_db
        db_settings = await get_llm_settings_from_db()
        api_key = db_settings["api_key"]
        if not llm_provider:
            llm_provider = db_settings["provider"]
        if not llm_model:
            llm_model = db_settings["selected_model"]

    # Create LLM provider with logging wrapper
    inner_llm = create_llm_provider(
        provider=llm_provider, api_key=api_key,
        model_name=llm_model or "", temperature=temperature,
    )
    llm: BaseLLMProvider = LoggingLLMWrapper(inner_llm, log_callback=_save_api_log)
    llm.set_context(run_id)

    # Update run with resolved model name
    async with async_session() as db:
        await db.execute(
            update(EvalRun).where(EvalRun.id == run_id).values(
                llm_provider=llm_provider, llm_model=inner_llm.model_name,
            )
        )
        await db.commit()

    # Create adversarial evaluator
    evaluator = AdversarialEvaluator(llm)

    # Progress bridge: adapts adversarial evaluator callbacks to job progress
    # Writes run_id into progress so frontend can poll and redirect
    async def adversarial_progress(current: int, total: int, message: str):
        async with async_session() as db:
            await db.execute(
                update(Job).where(Job.id == job_id).values(
                    progress={
                        "current": current, "total": total,
                        "message": message, "run_id": run_id,
                    }
                )
            )
            await db.commit()

    # Cancellation check callable for the evaluator
    async def check_cancelled():
        if await is_job_cancelled(job_id):
            raise JobCancelledError("Job was cancelled by user")

    try:
        # Run the stress test
        results = await evaluator.run_live_stress_test(
            user_id=user_id,
            count=test_count,
            kaira_auth_token=kaira_auth_token,
            kaira_api_url=kaira_api_url,
            turn_delay=turn_delay,
            case_delay=case_delay,
            progress_callback=adversarial_progress,
            cancellation_check=check_cancelled,
        )

        # Persist each adversarial evaluation result
        verdicts = {}
        categories = {}
        for eval_result in results:
            async with async_session() as db:
                db.add(DBAdversarialEval(
                    run_id=run_id,
                    category=eval_result.test_case.category,
                    difficulty=eval_result.test_case.difficulty,
                    verdict=eval_result.verdict,
                    goal_achieved=eval_result.goal_achieved,
                    total_turns=eval_result.transcript.total_turns if eval_result.transcript else 0,
                    result=serialize(eval_result),
                ))
                await db.commit()

            verdicts[eval_result.verdict] = verdicts.get(eval_result.verdict, 0) + 1
            categories[eval_result.test_case.category] = categories.get(eval_result.test_case.category, 0) + 1

        # Finalize
        duration = time.monotonic() - start_time
        summary = {
            "total_tests": len(results),
            "verdict_distribution": verdicts,
            "category_distribution": categories,
            "goal_achieved_count": sum(1 for r in results if r.goal_achieved),
        }

        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == run_id).values(
                    status="completed", duration_seconds=round(duration, 2), summary=summary,
                )
            )
            await db.commit()

        return {"run_id": run_id, "duration_seconds": round(duration, 2), **summary}

    except JobCancelledError:
        # Mark run as cancelled — partial thread results already persisted individually
        # won't have `results` here since the error came from inside run_live_stress_test
        duration = time.monotonic() - start_time
        summary = {"cancelled": True}
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == run_id).values(
                    status="cancelled", duration_seconds=round(duration, 2), summary=summary,
                )
            )
            await db.commit()
        logger.info(f"Adversarial run {run_id} cancelled")
        return {"run_id": run_id, "cancelled": True}

    except Exception as e:
        # Mark run as failed
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == run_id).values(
                    status="failed", error_message=str(e),
                    duration_seconds=round(time.monotonic() - start_time, 2),
                )
            )
            await db.commit()
        raise
