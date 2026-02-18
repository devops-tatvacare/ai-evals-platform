"""Adversarial evaluation runner — orchestrates stress tests and persists results.

Creates eval_runs rows (eval_type='batch_adversarial') with UUID PK.
Called by the job worker when processing 'evaluate-adversarial' jobs.
"""
import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable

from sqlalchemy import update

from app.database import async_session
from app.models.eval_run import EvalRun, AdversarialEvaluation as DBAdversarialEval, ApiLog
from app.models.job import Job
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.adversarial_evaluator import AdversarialEvaluator
from app.services.evaluators.kaira_client import KairaClient
from app.services.evaluators.models import RunMetadata, serialize
from app.services.job_worker import is_job_cancelled, JobCancelledError

logger = logging.getLogger(__name__)

ProgressCallback = Callable  # async (job_id, current, total, message) -> None


async def _save_api_log(log_entry: dict):
    """Persist an LLM API log entry to PostgreSQL."""
    run_id = log_entry.get("run_id")
    if run_id and isinstance(run_id, str):
        try:
            run_id = uuid.UUID(run_id)
        except ValueError:
            run_id = None

    async with async_session() as db:
        db.add(ApiLog(
            run_id=run_id,
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
    """Run adversarial stress test against live Kaira API."""
    start_time = time.monotonic()
    run_id = uuid.uuid4()

    # Create eval run record FIRST so failures are always visible in the UI
    async with async_session() as db:
        db.add(EvalRun(
            id=run_id,
            app_id="kaira-evals",
            eval_type="batch_adversarial",
            job_id=job_id,
            status="running",
            started_at=datetime.now(timezone.utc),
            llm_provider=llm_provider or "gemini",
            llm_model=llm_model or "",
            batch_metadata={
                "name": name,
                "description": description,
                "command": "adversarial",
                "eval_temperature": temperature,
                "total_items": test_count,
            },
        ))
        await db.commit()

    # Write run_id to job progress so frontend can redirect early
    async with async_session() as db:
        await db.execute(
            update(Job).where(Job.id == job_id).values(
                progress={
                    "current": 0, "total": test_count,
                    "message": "Initializing...", "run_id": str(run_id),
                }
            )
        )
        await db.commit()

    # Resolve API key from settings if not provided
    sa_path = ""
    if not api_key:
        from app.services.evaluators.settings_helper import get_llm_settings_from_db
        db_settings = await get_llm_settings_from_db(auth_intent="managed_job")
        api_key = db_settings["api_key"]
        sa_path = db_settings.get("service_account_path", "")
        if not llm_provider:
            llm_provider = db_settings["provider"]
        if not llm_model:
            llm_model = db_settings["selected_model"]

    # Create LLM provider with logging wrapper
    inner_llm = create_llm_provider(
        provider=llm_provider, api_key=api_key,
        model_name=llm_model or "", temperature=temperature,
        service_account_path=sa_path,
    )
    llm: BaseLLMProvider = LoggingLLMWrapper(inner_llm, log_callback=_save_api_log)
    llm.set_context(str(run_id))

    # Update run with resolved model name
    async with async_session() as db:
        await db.execute(
            update(EvalRun).where(EvalRun.id == run_id).values(
                llm_provider=llm_provider, llm_model=inner_llm.model_name,
            )
        )
        await db.commit()

    # Create adversarial evaluator and Kaira client
    evaluator = AdversarialEvaluator(llm)
    client = KairaClient(auth_token=kaira_auth_token, base_url=kaira_api_url)

    async def check_cancelled():
        if await is_job_cancelled(job_id):
            raise JobCancelledError("Job was cancelled by user")

    async def report_progress(current: int, total: int, message: str):
        async with async_session() as db:
            await db.execute(
                update(Job).where(Job.id == job_id).values(
                    progress={
                        "current": current, "total": total,
                        "message": message, "run_id": str(run_id),
                    }
                )
            )
            await db.commit()

    try:
        # Phase 1: Generate test cases
        await report_progress(0, test_count, "Generating test cases...")
        cases = await evaluator.generate_test_cases(test_count)

        # Phase 2: Run each test case with per-case error boundary
        verdicts: dict[str, int] = {}
        categories: dict[str, int] = {}
        error_count = 0
        goal_achieved_count = 0

        for i, tc in enumerate(cases, 1):
            await check_cancelled()

            if i > 1:
                await asyncio.sleep(case_delay)

            logger.info(f"Running live test {i}/{len(cases)}: {tc.category}")
            await report_progress(i, len(cases), f"{tc.category}: running conversation...")

            transcript = None
            try:
                transcript = await evaluator.conversation_agent.run_conversation(
                    test_case=tc, client=client, user_id=user_id, turn_delay=turn_delay,
                )

                await report_progress(i, len(cases), f"{tc.category}: judging transcript...")
                evaluation = await evaluator.evaluate_transcript(tc, transcript)

                async with async_session() as db:
                    db.add(DBAdversarialEval(
                        run_id=run_id,
                        category=tc.category,
                        difficulty=tc.difficulty,
                        verdict=evaluation.verdict,
                        goal_achieved=evaluation.goal_achieved,
                        total_turns=evaluation.transcript.total_turns,
                        result=serialize(evaluation),
                    ))
                    await db.commit()

                verdicts[evaluation.verdict] = verdicts.get(evaluation.verdict, 0) + 1
                categories[tc.category] = categories.get(tc.category, 0) + 1
                if evaluation.goal_achieved:
                    goal_achieved_count += 1
                logger.info(f"  -> {evaluation.verdict} (Goal: {evaluation.goal_achieved})")

            except JobCancelledError:
                raise

            except Exception as e:
                logger.error(f"Test case {i}/{len(cases)} ({tc.category}) failed: {e}")
                error_count += 1
                categories[tc.category] = categories.get(tc.category, 0) + 1

                result_data = {
                    "test_case": serialize(tc),
                    "error": str(e),
                }
                if transcript:
                    result_data["transcript"] = serialize(transcript)

                async with async_session() as db:
                    db.add(DBAdversarialEval(
                        run_id=run_id,
                        category=tc.category,
                        difficulty=tc.difficulty,
                        verdict=None,
                        goal_achieved=False,
                        total_turns=transcript.total_turns if transcript else 0,
                        result=result_data,
                    ))
                    await db.commit()

        # Finalize
        duration = time.monotonic() - start_time
        total_cases = len(cases)
        summary = {
            "total_tests": total_cases,
            "verdict_distribution": verdicts,
            "category_distribution": categories,
            "goal_achieved_count": goal_achieved_count,
            "errors": error_count,
        }

        if error_count == total_cases:
            final_status = "failed"
        elif error_count > 0:
            final_status = "completed_with_errors"
        else:
            final_status = "completed"

        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == run_id).values(
                    status=final_status,
                    completed_at=datetime.now(timezone.utc),
                    duration_ms=round(duration * 1000, 2),
                    summary=summary,
                )
            )
            await db.commit()

        return {"run_id": str(run_id), "duration_seconds": round(duration, 2), **summary}

    except JobCancelledError:
        duration = time.monotonic() - start_time
        summary = {"cancelled": True}
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == run_id).values(
                    status="cancelled",
                    completed_at=datetime.now(timezone.utc),
                    duration_ms=round(duration * 1000, 2),
                    summary=summary,
                )
            )
            await db.commit()
        logger.info(f"Adversarial run {run_id} cancelled")
        return {"run_id": str(run_id), "cancelled": True}

    except Exception as e:
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == run_id).values(
                    status="failed",
                    error_message=str(e),
                    completed_at=datetime.now(timezone.utc),
                    duration_ms=round((time.monotonic() - start_time) * 1000, 2),
                )
            )
            await db.commit()
        raise
