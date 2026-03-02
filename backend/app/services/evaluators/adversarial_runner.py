"""Adversarial evaluation runner — orchestrates stress tests and persists results.

Creates eval_runs rows (eval_type='batch_adversarial') with UUID PK.
Called by the job worker when processing 'evaluate-adversarial' jobs.

Standard pipeline contract:
  - Test case generation: LLM generates adversarial test cases based on categories
    and rules from AdversarialConfig (DB-backed, snapshotted per run).
  - Conversation: each test case runs a multi-turn live conversation against the
    Kaira API via KairaClient, with configurable turn delays and timeouts.
  - Evaluation: each transcript is evaluated by the AdversarialEvaluator using
    hardcoded evaluation prompts. Verdicts are persisted per-case in the
    adversarial_evaluations table.
  - Server-side logic: verdict/category aggregation, goal-achieved counting,
    error boundary per test case, parallel execution via run_parallel().
  - Guarantees: creates eval_run record before starting, snapshots adversarial config
    in batch_metadata for auditability, finalises with summary even on failure,
    supports job cancellation, cleans up KairaClient session.
"""
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable

from sqlalchemy import update

from app.database import async_session
from app.models.eval_run import AdversarialEvaluation as DBAdversarialEval, EvalRun
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.adversarial_evaluator import AdversarialEvaluator
from app.services.evaluators.adversarial_config import (
    AdversarialConfig, load_config_from_db, get_default_config,
)
from app.services.evaluators.kaira_client import KairaClient
from app.services.evaluators.models import RunMetadata, serialize
from app.services.evaluators.parallel_engine import run_parallel
from app.services.evaluators.runner_utils import (
    save_api_log, create_eval_run, finalize_eval_run,
)
from app.services.job_worker import (
    JobCancelledError, safe_error_message, update_job_progress,
)

logger = logging.getLogger(__name__)

ProgressCallback = Callable  # async (job_id, current, total, message) -> None





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
    timeouts: Optional[dict] = None,
    parallel_cases: bool = False,
    case_workers: int = 1,
    thinking: str = "low",
    selected_categories: Optional[list] = None,
    extra_instructions: Optional[str] = None,
    kaira_timeout: float = 120,
    azure_endpoint: str = "",
    api_version: str = "",
) -> dict:
    """Run adversarial stress test against live Kaira API."""
    start_time = time.monotonic()
    run_id = uuid.uuid4()

    # Resolve adversarial config (from DB or defaults)
    config = await load_config_from_db()

    # Filter to selected categories if specified
    if selected_categories:
        for cat in config.categories:
            cat.enabled = cat.id in selected_categories
        # Re-validate after filtering
        if not any(c.enabled for c in config.categories):
            config = get_default_config()  # safety fallback

    # Build snapshot of resolved config for audit
    config_snapshot = {
        "categories": [c.model_dump() for c in config.enabled_categories],
        "rules": [r.model_dump() for r in config.rules],
        "version": config.version,
    }

    # Create eval run record FIRST so failures are always visible in the UI
    await create_eval_run(
        id=run_id,
        app_id="kaira-bot",
        eval_type="batch_adversarial",
        job_id=job_id,
        llm_provider=llm_provider or "gemini",
        llm_model=llm_model or "",
        batch_metadata={
            "name": name,
            "description": description,
            "command": "adversarial",
            "eval_temperature": temperature,
            "total_items": test_count,
            "thinking": thinking,
            "adversarial_config": config_snapshot,
            "extra_instructions": extra_instructions,
        },
    )

    # Write run_id to job progress so frontend can redirect early
    await update_job_progress(
        job_id, 0, test_count, "Initializing...", run_id=str(run_id),
    )

    # Resolve API key from settings if not provided
    sa_path = ""
    db_settings = None
    auth_method = "api_key"  # default when caller provides api_key directly
    if not api_key:
        from app.services.evaluators.settings_helper import get_llm_settings_from_db
        db_settings = await get_llm_settings_from_db(auth_intent="managed_job", provider_override=llm_provider or None)
        api_key = db_settings["api_key"]
        sa_path = db_settings.get("service_account_path", "")
        auth_method = db_settings.get("auth_method", "api_key")
        if not llm_provider:
            llm_provider = db_settings["provider"]
        if not llm_model:
            llm_model = db_settings["selected_model"]

    # Create LLM provider with logging wrapper
    # Pick up Azure kwargs from DB settings when applicable
    if not azure_endpoint and llm_provider == "azure_openai":
        azure_endpoint = db_settings.get("azure_endpoint", "") if db_settings else ""
        api_version = db_settings.get("api_version", "") if db_settings else ""
    inner_llm = create_llm_provider(
        provider=llm_provider, api_key=api_key,
        model_name=llm_model or "", temperature=temperature,
        service_account_path=sa_path,
        azure_endpoint=azure_endpoint, api_version=api_version,
    )
    llm: BaseLLMProvider = LoggingLLMWrapper(inner_llm, log_callback=save_api_log)
    if timeouts:
        llm.set_timeouts(timeouts)
    llm.set_context(str(run_id))

    # Update run with resolved model name and auth method
    async with async_session() as db:
        await db.execute(
            update(EvalRun).where(EvalRun.id == run_id).values(
                llm_provider=llm_provider, llm_model=inner_llm.model_name,
                config={"auth_method": auth_method},
            )
        )
        await db.commit()

    # Create adversarial evaluator (with resolved config) and Kaira client
    evaluator = AdversarialEvaluator(llm, config=config)
    client = KairaClient(
        auth_token=kaira_auth_token, base_url=kaira_api_url,
        log_callback=save_api_log, run_id=str(run_id),
        timeout=kaira_timeout,
    )
    await client.open()

    async def report_progress(current: int, total: int, message: str):
        await update_job_progress(
            job_id, current, total, message, run_id=str(run_id),
        )

    # Determine effective concurrency
    effective_concurrency = case_workers if parallel_cases else 1

    try:
        # Phase 1: Generate test cases
        await report_progress(0, test_count, "Generating test cases...")
        llm.set_test_case_label("Test Case Generation")
        cases = await evaluator.generate_test_cases(
            test_count, thinking=thinking, extra_instructions=extra_instructions,
        )
        llm.set_test_case_label(None)  # Clear after generation phase

        # Phase 2: Run each test case with per-case error boundary.
        # Each worker returns a result dict; aggregation happens after run_parallel.

        async def _evaluate_one_case(_index: int, tc) -> dict:
            """Evaluate a single adversarial test case — called by run_parallel()."""
            # Build a human-readable label for this test case
            case_label = f"Case {_index + 1}: {tc.category}"

            # Each worker gets its own evaluator with isolated conversation state
            worker_llm = llm.clone_for_thread(f"adversarial-{_index}") if effective_concurrency > 1 else llm
            worker_llm.set_test_case_label(case_label)
            worker_evaluator = AdversarialEvaluator(worker_llm) if effective_concurrency > 1 else evaluator

            i = _index + 1
            logger.info(f"Running live test {i}/{len(cases)}: {tc.category}")

            transcript = None
            try:
                transcript = await worker_evaluator.conversation_agent.run_conversation(
                    test_case=tc, client=client, user_id=user_id, turn_delay=turn_delay,
                    thinking=thinking, test_case_label=case_label,
                )

                evaluation = await worker_evaluator.evaluate_transcript(tc, transcript, thinking=thinking)

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

                logger.info(f"  -> {evaluation.verdict} (Goal: {evaluation.goal_achieved})")
                return {
                    "verdict": evaluation.verdict,
                    "category": tc.category,
                    "goal_achieved": evaluation.goal_achieved,
                    "is_error": False,
                }

            except JobCancelledError:
                raise

            except Exception as e:
                logger.error(f"Test case {i}/{len(cases)} ({tc.category}) failed: {e}")

                result_data = {
                    "test_case": serialize(tc),
                    "error": safe_error_message(e),
                }
                if transcript:
                    result_data["transcript"] = serialize(transcript)

                try:
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
                except Exception as save_err:
                    logger.warning(f"Failed to save error record for test case {i} ({tc.category}): {save_err}")

                return {
                    "verdict": None,
                    "category": tc.category,
                    "goal_achieved": False,
                    "is_error": True,
                }

        async def _progress_bridge(current: int, total_count: int, message: str):
            await report_progress(current, total_count, message)

        def _progress_message(ok: int, err: int, current: int, tot: int) -> str:
            return f"Test case {current}/{tot} ({ok} ok, {err} errors)"

        case_results = await run_parallel(
            items=cases,
            worker=_evaluate_one_case,
            concurrency=effective_concurrency,
            job_id=job_id,
            progress_callback=_progress_bridge,
            progress_message=_progress_message,
            inter_item_delay=case_delay,
        )

        # Aggregate results from worker return values
        verdicts: dict[str, int] = {}
        categories: dict[str, int] = {}
        error_count = 0
        goal_achieved_count = 0
        for r in case_results:
            if isinstance(r, BaseException):
                error_count += 1
                continue
            categories[r["category"]] = categories.get(r["category"], 0) + 1
            if r["is_error"]:
                error_count += 1
            else:
                if r["verdict"]:
                    verdicts[r["verdict"]] = verdicts.get(r["verdict"], 0) + 1
                if r["goal_achieved"]:
                    goal_achieved_count += 1

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

        await finalize_eval_run(
            run_id,
            status=final_status,
            duration_ms=round(duration * 1000, 2),
            summary=summary,
        )

        return {"run_id": str(run_id), "duration_seconds": round(duration, 2), **summary}

    except JobCancelledError:
        duration = time.monotonic() - start_time
        summary = {"cancelled": True}
        await finalize_eval_run(
            run_id,
            status="cancelled",
            duration_ms=round(duration * 1000, 2),
            summary=summary,
        )
        logger.info(f"Adversarial run {run_id} cancelled")
        return {"run_id": str(run_id), "cancelled": True}

    except Exception as e:
        await finalize_eval_run(
            run_id,
            status="failed",
            duration_ms=round((time.monotonic() - start_time) * 1000, 2),
            error_message=safe_error_message(e),
        )
        raise

    finally:
        await client.close()
