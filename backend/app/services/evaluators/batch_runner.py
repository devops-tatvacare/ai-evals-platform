"""Batch evaluation runner — orchestrates evaluations and persists results.

Ported from kaira-evals/src/kaira_evaluator.py — adapted for async + PostgreSQL.
Called by the job worker when processing 'evaluate-batch' jobs.
"""
import hashlib
import logging
import time
from pathlib import Path
from typing import Optional, Callable, Awaitable

from sqlalchemy import update

from app.database import async_session
from app.models.eval_run import EvalRun, ThreadEvaluation as DBThreadEval, ApiLog
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.data_loader import DataLoader
from app.services.evaluators.intent_evaluator import IntentEvaluator
from app.services.evaluators.correctness_evaluator import CorrectnessEvaluator
from app.services.evaluators.efficiency_evaluator import EfficiencyEvaluator
from app.services.evaluators.models import RunMetadata, serialize

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
) -> dict:
    """Run batch evaluation on threads from a data file.

    This is the main entry point called from the job worker.
    """
    start_time = time.monotonic()
    run_id = RunMetadata.new_run_id()

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

    # Create LLM provider with logging wrapper
    inner_llm = create_llm_provider(
        provider=llm_provider, api_key=api_key,
        model_name=llm_model or "", temperature=temperature,
        service_account_path=service_account_path,
    )
    llm: BaseLLMProvider = LoggingLLMWrapper(inner_llm, log_callback=_save_api_log)
    llm.set_context(run_id)

    # Create evaluators
    intent_eval = IntentEvaluator(llm, system_prompt=intent_system_prompt) if evaluate_intent else None
    correctness_eval = CorrectnessEvaluator(llm) if evaluate_correctness else None
    efficiency_eval = EfficiencyEvaluator(llm) if evaluate_efficiency else None

    # Create eval run record in DB
    data_hash = _file_hash(data_path) if data_path else ""
    async with async_session() as db:
        db.add(EvalRun(
            id=run_id, job_id=job_id, command="evaluate-batch",
            llm_provider=llm_provider, llm_model=inner_llm.model_name,
            eval_temperature=temperature,
            data_path=data_path or "(uploaded)",
            data_file_hash=data_hash,
            status="running", total_items=total,
        ))
        await db.commit()

    # Process threads
    results_summary = {
        "total": total, "completed": 0, "errors": 0,
        "intent_accuracy_sum": 0.0,
        "correctness_verdicts": {},
        "efficiency_verdicts": {},
    }

    try:
        for i, thread_id in enumerate(ids_to_evaluate, 1):
            if progress_callback:
                await progress_callback(job_id, i, total, f"Evaluating thread {i}/{total}")

            llm.set_thread_id(thread_id)

            try:
                thread = loader.get_thread(thread_id)
                if not thread:
                    logger.warning(f"Thread {thread_id} not found, skipping")
                    results_summary["errors"] += 1
                    continue

                # Run evaluators
                intent_results = []
                if intent_eval:
                    intent_results = await intent_eval.evaluate_thread(thread.messages)

                correctness_results = []
                if correctness_eval:
                    correctness_results = await correctness_eval.evaluate_thread(thread)

                efficiency_result = None
                if efficiency_eval:
                    efficiency_result = await efficiency_eval.evaluate_thread(thread)

                # Compute metrics
                intent_accuracy = 0.0
                if intent_results:
                    correct = sum(1 for e in intent_results if e.is_correct_intent)
                    intent_accuracy = correct / len(intent_results)
                    results_summary["intent_accuracy_sum"] += intent_accuracy

                worst_correctness = "NOT APPLICABLE"
                severity = ["NOT APPLICABLE", "PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL"]
                for ce in correctness_results:
                    if severity.index(ce.verdict) > severity.index(worst_correctness):
                        worst_correctness = ce.verdict
                results_summary["correctness_verdicts"][worst_correctness] = \
                    results_summary["correctness_verdicts"].get(worst_correctness, 0) + 1

                eff_verdict = efficiency_result.verdict if efficiency_result else "N/A"
                results_summary["efficiency_verdicts"][eff_verdict] = \
                    results_summary["efficiency_verdicts"].get(eff_verdict, 0) + 1

                # Save thread evaluation to DB
                result_data = {
                    "intent_evaluations": [serialize(ie) for ie in intent_results],
                    "correctness_evaluations": [serialize(ce) for ce in correctness_results],
                    "efficiency_evaluation": serialize(efficiency_result) if efficiency_result else None,
                    "success_status": thread.is_successful,
                }

                async with async_session() as db:
                    db.add(DBThreadEval(
                        run_id=run_id, thread_id=thread_id,
                        data_file_hash=data_hash,
                        intent_accuracy=intent_accuracy,
                        worst_correctness=worst_correctness,
                        efficiency_verdict=eff_verdict,
                        success_status=thread.is_successful,
                        result=result_data,
                    ))
                    await db.commit()

                results_summary["completed"] += 1

            except Exception as e:
                logger.error(f"Error evaluating thread {thread_id}: {e}")
                results_summary["errors"] += 1

        # Finalize
        duration = time.monotonic() - start_time
        avg_intent = (results_summary["intent_accuracy_sum"] / results_summary["completed"]
                      if results_summary["completed"] > 0 else 0.0)

        summary = {
            "total_threads": total,
            "completed": results_summary["completed"],
            "errors": results_summary["errors"],
            "avg_intent_accuracy": round(avg_intent, 4),
            "correctness_verdicts": results_summary["correctness_verdicts"],
            "efficiency_verdicts": results_summary["efficiency_verdicts"],
        }

        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == run_id).values(
                    status="completed", duration_seconds=round(duration, 2), summary=summary,
                )
            )
            await db.commit()

        return {"run_id": run_id, "duration_seconds": round(duration, 2), **summary}

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
