"""Batch evaluation runner — orchestrates evaluations and persists results.

Creates eval_runs rows (eval_type='batch_thread') with UUID PK.
Called by the job worker when processing 'evaluate-batch' jobs.
"""
import hashlib
import logging
import time
import uuid
from pathlib import Path
from typing import Optional, Callable

from sqlalchemy import update, select

from app.database import async_session
from app.models.eval_run import EvalRun, ThreadEvaluation as DBThreadEval, ApiLog
from app.models.evaluator import Evaluator
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.data_loader import DataLoader
from app.services.evaluators.intent_evaluator import IntentEvaluator
from app.services.evaluators.correctness_evaluator import CorrectnessEvaluator
from app.services.evaluators.efficiency_evaluator import EfficiencyEvaluator
from app.services.evaluators.models import RunMetadata, serialize
from app.services.evaluators.prompt_resolver import resolve_prompt
from app.services.evaluators.schema_generator import generate_json_schema
from app.services.evaluators.response_parser import _safe_parse_json
from app.services.job_worker import is_job_cancelled, JobCancelledError, safe_error_message

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


def _file_hash(path: str) -> str:
    """Compute MD5 hash of a file for deduplication."""
    try:
        h = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()[:12]
    except Exception:
        return ""


async def run_batch_evaluation(
    job_id,
    data_path: Optional[str] = None,
    csv_content: Optional[str] = None,
    app_id: str = "kaira-bot",
    llm_provider: str = "gemini",
    llm_model: Optional[str] = None,
    api_key: str = "",
    service_account_path: str = "",
    temperature: float = 0.1,
    intent_system_prompt: str = "",
    evaluate_intent: bool = True,
    evaluate_correctness: bool = True,
    evaluate_efficiency: bool = True,
    thread_ids: Optional[list] = None,
    sample_size: Optional[int] = None,
    progress_callback: Optional[ProgressCallback] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    custom_evaluator_ids: Optional[list[str]] = None,
    timeouts: Optional[dict] = None,
) -> dict:
    """Run batch evaluation on threads from a data file."""
    start_time = time.monotonic()
    run_id = uuid.uuid4()

    # Create eval run record FIRST so failures are always visible in the UI
    data_hash = _file_hash(data_path) if data_path else ""
    async with async_session() as db:
        db.add(EvalRun(
            id=run_id,
            app_id=app_id,
            eval_type="batch_thread",
            job_id=job_id,
            status="running",
            started_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
            llm_provider=llm_provider or "gemini",
            llm_model=llm_model or "",
            batch_metadata={
                "name": name,
                "description": description,
                "data_path": data_path or "(uploaded)",
                "data_file_hash": data_hash,
                "total_items": 0,
                "command": "evaluate-batch",
                "eval_temperature": temperature,
            },
        ))
        await db.commit()

    # Write run_id to job progress so frontend can redirect early
    from app.models.job import Job
    async with async_session() as db:
        await db.execute(
            update(Job).where(Job.id == job_id).values(
                progress={"current": 0, "total": 0, "message": "Initializing...", "run_id": str(run_id)}
            )
        )
        await db.commit()

    # Resolve API key from settings if not provided
    auth_method = "api_key"  # default when caller provides api_key directly
    if not api_key:
        from app.services.evaluators.settings_helper import get_llm_settings_from_db
        db_settings = await get_llm_settings_from_db(auth_intent="managed_job")
        api_key = db_settings["api_key"]
        auth_method = db_settings.get("auth_method", "api_key")
        if not service_account_path:
            service_account_path = db_settings.get("service_account_path", "")
        if not llm_provider:
            llm_provider = db_settings["provider"]
        if not llm_model:
            llm_model = db_settings["selected_model"]

    # Load data
    loader = DataLoader(csv_content=csv_content, csv_path=Path(data_path) if data_path else None)

    # Resolve thread IDs
    if thread_ids:
        ids_to_evaluate = thread_ids
    elif sample_size:
        import random
        all_ids = loader.get_all_thread_ids()
        ids_to_evaluate = random.sample(all_ids, min(sample_size, len(all_ids)))
    else:
        ids_to_evaluate = loader.get_all_thread_ids()

    total = len(ids_to_evaluate)

    # Update run with resolved details
    async with async_session() as db:
        await db.execute(
            update(EvalRun).where(EvalRun.id == run_id).values(
                llm_provider=llm_provider, llm_model=llm_model or "",
                batch_metadata={
                    "name": name,
                    "description": description,
                    "data_path": data_path or "(uploaded)",
                    "data_file_hash": data_hash,
                    "total_items": total,
                    "command": "evaluate-batch",
                    "eval_temperature": temperature,
                    "auth_method": auth_method,
                },
            )
        )
        await db.commit()

    # Create LLM provider with logging wrapper
    inner_llm = create_llm_provider(
        provider=llm_provider, api_key=api_key,
        model_name=llm_model or "", temperature=temperature,
        service_account_path=service_account_path,
    )
    llm: BaseLLMProvider = LoggingLLMWrapper(inner_llm, log_callback=_save_api_log)
    if timeouts:
        llm.set_timeouts(timeouts)
    llm.set_context(str(run_id))

    # Create evaluators
    intent_eval = IntentEvaluator(llm, system_prompt=intent_system_prompt) if evaluate_intent else None
    correctness_eval = CorrectnessEvaluator(llm) if evaluate_correctness else None
    efficiency_eval = EfficiencyEvaluator(llm) if evaluate_efficiency else None

    # Track which evaluators are disabled so UI can show "Skipped"
    skipped_evaluators = [
        name for name, enabled in [
            ("intent", evaluate_intent),
            ("correctness", evaluate_correctness),
            ("efficiency", evaluate_efficiency),
        ] if not enabled
    ]

    # Load custom evaluators if specified
    custom_evaluators: list[Evaluator] = []
    if custom_evaluator_ids:
        async with async_session() as db:
            for eid in custom_evaluator_ids:
                ev = await db.get(Evaluator, eid)
                if ev:
                    custom_evaluators.append(ev)

    # Process threads
    results_summary = {
        "total": total, "completed": 0, "errors": 0,
        "intent_accuracy_sum": 0.0,
        "correctness_verdicts": {},
        "efficiency_verdicts": {},
        "custom_evaluations": {},
    }

    try:
        for i, thread_id in enumerate(ids_to_evaluate, 1):
            if await is_job_cancelled(job_id):
                raise JobCancelledError("Job was cancelled by user")

            if progress_callback:
                await progress_callback(job_id, i, total, f"Evaluating thread {i}/{total}")

            llm.set_thread_id(thread_id)

            try:
                thread = loader.get_thread(thread_id)
                if not thread:
                    logger.warning(f"Thread {thread_id} not found, skipping")
                    results_summary["errors"] += 1
                    continue

                # --- Run each evaluator independently ---
                intent_results = []
                correctness_results = []
                efficiency_result = None
                custom_results = {}
                eval_errors = []
                failed_evaluators = {}

                if intent_eval:
                    try:
                        intent_results = await intent_eval.evaluate_thread(thread.messages)
                    except Exception as ie_err:
                        msg = safe_error_message(ie_err)
                        eval_errors.append(f"Intent: {msg}")
                        failed_evaluators["intent"] = msg
                        logger.error("Intent eval failed for %s: %s", thread_id, msg)

                if correctness_eval:
                    try:
                        correctness_results = await correctness_eval.evaluate_thread(thread)
                    except Exception as ce_err:
                        msg = safe_error_message(ce_err)
                        eval_errors.append(f"Correctness: {msg}")
                        failed_evaluators["correctness"] = msg
                        logger.error("Correctness eval failed for %s: %s", thread_id, msg)

                if efficiency_eval:
                    try:
                        efficiency_result = await efficiency_eval.evaluate_thread(thread)
                    except Exception as ee_err:
                        msg = safe_error_message(ee_err)
                        eval_errors.append(f"Efficiency: {msg}")
                        failed_evaluators["efficiency"] = msg
                        logger.error("Efficiency eval failed for %s: %s", thread_id, msg)

                # Run custom evaluators on this thread (already per-evaluator try/except)
                if custom_evaluators:
                    interleaved = []
                    for m in thread.messages:
                        interleaved.append({"role": "user", "content": m.query_text})
                        interleaved.append({"role": "assistant", "content": m.final_response_message})

                    for cev in custom_evaluators:
                        try:
                            resolve_ctx = {"messages": interleaved}
                            resolved = resolve_prompt(cev.prompt, resolve_ctx)
                            prompt_text = resolved["prompt"]
                            json_schema = generate_json_schema(cev.output_schema)

                            output = await llm.generate_json(
                                prompt=prompt_text,
                                json_schema=json_schema,
                            )
                            custom_results[str(cev.id)] = {
                                "evaluator_id": str(cev.id),
                                "evaluator_name": cev.name,
                                "status": "completed",
                                "output": output,
                            }
                            if str(cev.id) not in results_summary["custom_evaluations"]:
                                results_summary["custom_evaluations"][str(cev.id)] = {
                                    "name": cev.name, "completed": 0, "errors": 0,
                                }
                            results_summary["custom_evaluations"][str(cev.id)]["completed"] += 1
                        except Exception as ce_err:
                            logger.error("Custom evaluator %s failed for thread %s: %s", cev.id, thread_id, ce_err)
                            custom_results[str(cev.id)] = {
                                "evaluator_id": str(cev.id),
                                "evaluator_name": cev.name,
                                "status": "failed",
                                "error": safe_error_message(ce_err),
                            }
                            if str(cev.id) not in results_summary["custom_evaluations"]:
                                results_summary["custom_evaluations"][str(cev.id)] = {
                                    "name": cev.name, "completed": 0, "errors": 0,
                                }
                            results_summary["custom_evaluations"][str(cev.id)]["errors"] += 1

                # --- Compute metrics from whatever succeeded ---
                intent_accuracy = 0.0
                if intent_results:
                    correct = sum(1 for e in intent_results if e.is_correct_intent)
                    intent_accuracy = correct / len(intent_results)

                worst_correctness = "NOT APPLICABLE"
                severity = ["NOT APPLICABLE", "PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL"]
                for ce in correctness_results:
                    if severity.index(ce.verdict) > severity.index(worst_correctness):
                        worst_correctness = ce.verdict

                eff_verdict = efficiency_result.verdict if efficiency_result else "N/A"

                # --- Build result with ALL partial data ---
                is_success = (not eval_errors) and thread.is_successful
                result_data = {
                    "thread": serialize(thread),
                    "intent_evaluations": [serialize(ie) for ie in intent_results],
                    "correctness_evaluations": [serialize(ce) for ce in correctness_results],
                    "efficiency_evaluation": serialize(efficiency_result) if efficiency_result else None,
                    "success_status": is_success,
                    "custom_evaluations": custom_results if custom_results else None,
                    "failed_evaluators": failed_evaluators if failed_evaluators else None,
                    "skipped_evaluators": skipped_evaluators if skipped_evaluators else None,
                }
                if eval_errors:
                    result_data["error"] = "; ".join(eval_errors)

                # --- Save to DB (always, with full partial results) ---
                async with async_session() as db:
                    db.add(DBThreadEval(
                        run_id=run_id, thread_id=thread_id,
                        data_file_hash=data_hash,
                        intent_accuracy=intent_accuracy,
                        worst_correctness=worst_correctness,
                        efficiency_verdict=eff_verdict,
                        success_status=is_success,
                        result=result_data,
                    ))
                    await db.commit()

                # --- Update summary ---
                if eval_errors:
                    results_summary["errors"] += 1
                else:
                    results_summary["completed"] += 1
                    results_summary["intent_accuracy_sum"] += intent_accuracy
                    results_summary["correctness_verdicts"][worst_correctness] = \
                        results_summary["correctness_verdicts"].get(worst_correctness, 0) + 1
                    results_summary["efficiency_verdicts"][eff_verdict] = \
                        results_summary["efficiency_verdicts"].get(eff_verdict, 0) + 1

            except Exception as e:
                # Safety net for non-evaluator errors (data loading, DB save, etc.)
                error_msg = safe_error_message(e)
                logger.error(f"Error evaluating thread {thread_id}: {error_msg}")
                results_summary["errors"] += 1

                try:
                    async with async_session() as db:
                        db.add(DBThreadEval(
                            run_id=run_id, thread_id=thread_id,
                            data_file_hash=data_hash,
                            intent_accuracy=0.0,
                            worst_correctness="NOT APPLICABLE",
                            efficiency_verdict="N/A",
                            success_status=False,
                            result={"error": error_msg},
                        ))
                        await db.commit()
                except Exception as save_err:
                    logger.warning(f"Failed to save error record for thread {thread_id}: {save_err}")

            # Update progress after each thread (success or failure) so frontend sees advancement
            if progress_callback:
                await progress_callback(
                    job_id, i, total,
                    f"Thread {i}/{total} processed ({results_summary['completed']} ok, {results_summary['errors']} errors)",
                )

        # Finalize
        duration = time.monotonic() - start_time
        completed = results_summary["completed"]
        errors = results_summary["errors"]
        avg_intent = (results_summary["intent_accuracy_sum"] / completed
                      if completed > 0 else 0.0)

        if completed == 0 and errors > 0:
            final_status = "failed"
            error_message = f"All {errors} thread evaluations failed"
        elif completed > 0 and errors > 0:
            final_status = "completed_with_errors"
            error_message = f"{errors} of {total} thread evaluations failed"
        else:
            final_status = "completed"
            error_message = None

        summary = {
            "total_threads": total,
            "completed": completed,
            "errors": errors,
            "avg_intent_accuracy": round(avg_intent, 4),
            "correctness_verdicts": results_summary["correctness_verdicts"],
            "efficiency_verdicts": results_summary["efficiency_verdicts"],
        }
        if results_summary.get("custom_evaluations"):
            summary["custom_evaluations"] = results_summary["custom_evaluations"]

        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == run_id).values(
                    status=final_status,
                    completed_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
                    duration_ms=round(duration * 1000, 2),
                    summary=summary,
                    error_message=error_message,
                )
            )
            await db.commit()

        return {"run_id": str(run_id), "duration_seconds": round(duration, 2), **summary}

    except JobCancelledError:
        duration = time.monotonic() - start_time
        summary = {
            "total_threads": total,
            "completed": results_summary["completed"],
            "errors": results_summary["errors"],
            "cancelled": True,
        }
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == run_id).values(
                    status="cancelled",
                    completed_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
                    duration_ms=round(duration * 1000, 2),
                    summary=summary,
                )
            )
            await db.commit()
        logger.info(f"Batch run {run_id} cancelled after {results_summary['completed']}/{total} threads")
        return {"run_id": str(run_id), "cancelled": True, **summary}

    except Exception as e:
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(
                    EvalRun.id == run_id,
                    EvalRun.status != "cancelled",
                ).values(
                    status="failed",
                    error_message=safe_error_message(e),
                    completed_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
                    duration_ms=round((time.monotonic() - start_time) * 1000, 2),
                )
            )
            await db.commit()
        raise
