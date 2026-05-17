"""Generic evaluation runner shell.

Owns the eval lifecycle that is identical across subjects: promote eval_run
to running, load evaluators, build the LLM wrapper, resolve selection, run
workers in parallel, persist threads, finalize the run, submit the analytics
job. Subject-specific behaviour lives in the worker; dataset-specific SQL
lives in the binding.

App config drives every per-app knob:
  app.config.evaluation.datasets.<dataset_id> = {
    binding: <registry key>,
    worker: <registry key>,
    eval_type: <evaluation_runs.eval_type column value>,
    call_purpose: <cost-tracking call purpose label>,
  }
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from sqlalchemy import select, update

from app.models.application import Application
from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult
from app.models.evaluator import Evaluator
from app.services.access_control import readable_scope_clause
from app.services.evaluators.eval_run_params import EvalRunParams
from app.services.evaluators.llm_base import (
    LoggingLLMWrapper,
    create_llm_provider,
)
from app.services.evaluators.output_schema_utils import find_primary_field
from app.services.evaluators.runner_utils import (
    finalize_eval_run,
    make_usage_callback,
    promote_eval_run_to_running,
    save_api_log,
)
from app.services.evaluators.parallel_engine import run_parallel
from app.services.evaluators.selection import (
    EvaluableCall,
    ResolvedSelection,
    SpecificSelectionMissingError,
    get_binding,
    resolve_selection,
)
from app.services.evaluators.workers import (
    EvaluatorSpec,
    UnknownWorkerError,
    Worker,
    WorkerContext,
    WorkerOutput,
    get_worker,
)
from app.services.job_worker import safe_error_message, update_job_progress

logger = logging.getLogger(__name__)


def _async_session():
    from app.database import async_session

    return async_session()


# ── App config resolution ────────────────────────────────────────────


class DatasetConfigMissing(KeyError):
    """Raised when the App.config does not declare the requested dataset."""


async def _load_dataset_config(app_id: str, dataset_id: str) -> dict[str, Any]:
    """Read app.config.evaluation.datasets[dataset_id] and validate required keys.

    Centralised so a misconfigured app fails loudly at the start of the run
    rather than mid-flight inside a worker.
    """
    async with _async_session() as db:
        app = await db.scalar(select(Application).where(Application.slug == app_id))
    if app is None:
        raise DatasetConfigMissing(f"Application '{app_id}' not found")

    cfg = (app.config or {}).get("evaluation", {}).get("datasets", {}).get(dataset_id)
    if not isinstance(cfg, dict):
        raise DatasetConfigMissing(
            f"App '{app_id}' has no evaluation.datasets.{dataset_id} config"
        )
    for required in ("binding", "worker", "eval_type", "call_purpose"):
        if not cfg.get(required):
            raise DatasetConfigMissing(
                f"evaluation.datasets.{dataset_id} on '{app_id}' is missing "
                f"required key '{required}'"
            )
    return cfg


# ── Run snapshot ─────────────────────────────────────────────────────


def _build_initial_snapshot(
    *,
    params: EvalRunParams,
) -> dict[str, Any]:
    """Persisted before resolution so the run row has searchable text from t=0."""
    return {
        "run_name": params.run_name,
        "run_description": params.run_description,
        "dataset_id": params.dataset_id,
        "selection": params.selection.model_dump(mode="json"),
        "transcription_config": params.transcription_config.model_dump(mode="json"),
        "llm_config": params.llm_config.model_dump(mode="json"),
        "requested_evaluator_ids": [str(eid) for eid in params.evaluator_ids],
        "parallel_workers": params.parallel_workers,
    }


def _record_snapshot(record: EvaluableCall) -> dict[str, Any]:
    """Per-record snapshot stored on the run config + on each thread row.

    `EvaluableCall.model_dump()` minus `raw_attributes`. JSON-mode dump so
    `datetime` becomes ISO-8601 — Pydantic v2's mode='json' handles this.
    """
    snapshot = record.model_dump(mode="json", exclude={"raw_attributes"})
    return snapshot


def _build_resolved_snapshot(
    *,
    initial: dict[str, Any],
    selection: ResolvedSelection,
    evaluators: list[EvaluatorSpec],
) -> dict[str, Any]:
    record_snapshots = [_record_snapshot(r) for r in selection.records]
    return {
        **initial,
        "resolved_evaluators": [
            {"id": str(ev.id), "name": ev.name} for ev in evaluators
        ],
        "selected_record_ids": [r.activity_id for r in selection.records],
        "selected_record_snapshots": record_snapshots,
        "selected_record_count": len(selection.records),
        "selection_diagnostics": selection.diagnostics.model_dump(mode="json"),
    }


# ── Per-record thread persistence ────────────────────────────────────


def _build_thread_metadata(record: EvaluableCall) -> dict[str, Any]:
    """Snake_case, structural projection of the call. No deprecated aliases."""
    return {
        "rep_external_id": record.rep_external_id,
        "rep_label": record.rep_label,
        "rep_email": record.rep_email,
        "lead_id": record.lead_id,
        "direction": record.direction,
        "status": record.status,
        "duration_seconds": record.duration_seconds,
        "recording_url": record.recording_url,
        "phone_number": record.phone_number,
        "display_number": record.display_number,
        "occurred_at": record.occurred_at.isoformat() if record.occurred_at else None,
        "event_code": record.event_code,
        "session_id": record.session_id,
        "notes": record.notes,
    }


async def _persist_thread(
    *,
    run_id: uuid.UUID,
    record: EvaluableCall,
    output: WorkerOutput,
) -> None:
    async with _async_session() as db:
        db.add(
            EvaluationRunThreadResult(
                run_id=run_id,
                thread_id=record.activity_id,
                result={
                    "evaluations": [
                        {
                            "evaluator_id": ev.evaluator_id,
                            "evaluator_name": ev.evaluator_name,
                            "output": ev.output,
                        }
                        for ev in output.evaluator_outputs
                    ],
                    "signals": output.signals,
                    "transcript": output.transcript,
                    "call_metadata": _build_thread_metadata(record),
                    "extra_metadata": output.extra_metadata or {},
                },
                success_status=True,
            )
        )
        await db.commit()


async def _persist_failed_thread(
    *,
    run_id: uuid.UUID,
    record: EvaluableCall | None,
    error: BaseException,
    error_index: int,
) -> None:
    """Per-record failures get their own thread row so the user sees what broke."""
    async with _async_session() as db:
        db.add(
            EvaluationRunThreadResult(
                run_id=run_id,
                thread_id=(
                    record.activity_id if record is not None else f"error-{error_index}"
                ),
                result={
                    "error": safe_error_message(error),
                    "call_metadata": (
                        _build_thread_metadata(record) if record is not None else {}
                    ),
                },
                success_status=False,
            )
        )
        await db.commit()


# ── Shell entry point ────────────────────────────────────────────────


async def run_eval(
    *,
    job_id: str,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    params: EvalRunParams,
) -> dict[str, Any]:
    """Execute one evaluation run end-to-end.

    Caller is the job-handler; it has already validated `params` into the
    typed model. This function is the only entry point — runner glue per app
    becomes one line: `return await run_eval(job_id=..., params=params)`.
    """
    start_time = time.monotonic()
    eval_run_id = params.eval_run_id

    # ── App config + binding/worker resolution ──────────────────
    dataset_cfg = await _load_dataset_config(params.app_id, params.dataset_id)
    binding = get_binding(dataset_cfg["binding"])
    worker: Worker = get_worker(dataset_cfg["worker"])
    eval_type: str = dataset_cfg["eval_type"]
    call_purpose: str = dataset_cfg["call_purpose"]

    initial_snapshot = _build_initial_snapshot(params=params)

    await promote_eval_run_to_running(
        id=eval_run_id,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=params.app_id,
        eval_type=eval_type,
        job_id=job_id,
        llm_provider=params.llm_config.provider,
        llm_model=params.llm_config.model,
        config=initial_snapshot,
        batch_metadata={
            "run_name": params.run_name,
            "run_description": params.run_description,
            "selection": params.selection.model_dump(mode="json"),
            "evaluator_count": len(params.evaluator_ids),
        },
    )

    await update_job_progress(
        job_id, 0, 1, "Loading evaluators...", run_id=str(eval_run_id),
    )

    # ── Load evaluators ─────────────────────────────────────────
    evaluators = await _load_evaluators(
        evaluator_ids=params.evaluator_ids,
        tenant_id=tenant_id,
        user_id=user_id,
    )
    if not evaluators:
        return await _finalize_failed(
            eval_run_id=eval_run_id,
            tenant_id=tenant_id,
            start_time=start_time,
            error_message="No evaluators found",
        )

    # ── LLM wrapper ─────────────────────────────────────────────
    from app.services.llm_credentials import resolve_credentials

    async with _async_session() as db:
        creds = await resolve_credentials(db, tenant_id, params.llm_config.provider)
    provider_kwargs: dict[str, Any] = {}
    if creds.provider == "azure_openai":
        provider_kwargs["azure_endpoint"] = creds.extra_config.get("base_url") or ""
        provider_kwargs["api_version"] = creds.extra_config.get(
            "api_version", "2025-03-01-preview"
        )
    provider = create_llm_provider(
        provider=creds.provider,
        api_key=creds.secret.get("api_key", ""),
        model_name=params.llm_config.model or "",
        temperature=params.llm_config.temperature,
        service_account_path=creds.service_account_path or "",
        **provider_kwargs,
    )
    usage_cb = make_usage_callback(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=params.app_id,
        owner_type="eval_run",
        owner_id=eval_run_id,
        default_call_purpose=call_purpose,
    )
    llm = LoggingLLMWrapper(provider, log_callback=save_api_log, usage_callback=usage_cb)
    llm.set_context(str(eval_run_id))

    # ── Resolve selection ───────────────────────────────────────
    await update_job_progress(
        job_id, 0, 1, "Resolving selection...", run_id=str(eval_run_id),
    )
    try:
        async with _async_session() as db:
            selection = await resolve_selection(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=params.app_id,
                binding=binding,
                spec=params.selection,
            )
    except SpecificSelectionMissingError as exc:
        return await _finalize_failed(
            eval_run_id=eval_run_id,
            tenant_id=tenant_id,
            start_time=start_time,
            error_message=str(exc),
            config={
                **initial_snapshot,
                "selection_error": {
                    "kind": "specific_selection_missing",
                    "missing_ids": list(exc.missing_ids),
                },
            },
        )

    resolved_snapshot = _build_resolved_snapshot(
        initial=initial_snapshot, selection=selection, evaluators=evaluators
    )
    async with _async_session() as db:
        await db.execute(
            update(EvaluationRun)
            .where(
                EvaluationRun.id == eval_run_id,
                EvaluationRun.tenant_id == tenant_id,
            )
            .values(
                config=resolved_snapshot,
                batch_metadata={
                    "run_name": params.run_name,
                    "run_description": params.run_description,
                    "selection": params.selection.model_dump(mode="json"),
                    "evaluator_count": len(evaluators),
                    "selected_record_count": selection.diagnostics.selected,
                    "selected_record_ids": [
                        r.activity_id for r in selection.records
                    ],
                    "selection_diagnostics": selection.diagnostics.model_dump(
                        mode="json"
                    ),
                },
            )
        )
        await db.commit()

    if selection.diagnostics.selected == 0:
        return await _finalize_failed(
            eval_run_id=eval_run_id,
            tenant_id=tenant_id,
            start_time=start_time,
            error_message=_empty_selection_message(selection),
            config=resolved_snapshot,
        )

    # ── Run workers ─────────────────────────────────────────────
    records = selection.records
    total = len(records)
    logger.info("Resolved %d records for evaluation", total)

    async def _evaluate_one(
        index: int,  # noqa: ARG001 — required by run_parallel's worker signature
        record: EvaluableCall,
    ) -> dict[str, Any]:
        worker_llm = llm.clone_for_thread(record.activity_id)
        ctx = WorkerContext(
            record=record,
            evaluators=evaluators,
            llm=worker_llm,
            transcription_config=params.transcription_config.model_dump(mode="json"),
            tenant_id=tenant_id,
            user_id=user_id,
        )
        output = await worker(ctx)
        await _persist_thread(run_id=eval_run_id, record=record, output=output)
        return {
            "record_id": record.activity_id,
            "per_evaluator_scores": {
                ev.evaluator_id: ev.score for ev in output.evaluator_outputs
            },
            "is_error": False,
        }

    def _msg(ok: int, err: int, current: int, tot: int) -> str:
        return f"Record {current}/{tot} ({ok} ok, {err} errors)"

    async def _progress_cb(current: int, total_count: int, message: str) -> None:
        await update_job_progress(job_id, current, total_count, message)

    try:
        results = await run_parallel(
            items=records,
            worker=_evaluate_one,
            concurrency=params.parallel_workers,
            job_id=job_id,
            tenant_id=tenant_id,
            progress_callback=_progress_cb,
            progress_message=_msg,
            inter_item_delay=0.5,
        )
    except Exception as exc:
        logger.error("run_parallel failed: %s", exc)
        return await _finalize_failed(
            eval_run_id=eval_run_id,
            tenant_id=tenant_id,
            start_time=start_time,
            error_message=safe_error_message(exc),
            config=resolved_snapshot,
        )

    # ── Aggregate ───────────────────────────────────────────────
    evaluated, failed, per_eval_scores = await _aggregate(
        results=results,
        records=records,
        evaluators=evaluators,
        eval_run_id=eval_run_id,
    )

    summary = _build_summary(
        evaluators=evaluators,
        per_eval_scores=per_eval_scores,
        evaluated=evaluated,
        failed=failed,
        total=total,
        diagnostics=selection.diagnostics,
    )
    final_status = "completed" if failed == 0 else "completed_with_errors"

    await finalize_eval_run(
        eval_run_id, tenant_id,
        status=final_status,
        duration_ms=(time.monotonic() - start_time) * 1000,
        summary=summary,
        config={
            **resolved_snapshot,
            "evaluator_count": len(evaluators),
            "evaluator_name": evaluators[0].name if evaluators else "",
            "record_count": total,
            "parallel_workers": params.parallel_workers,
        },
    )

    # ── Analytics submission (fire-and-forget) ──────────────────
    try:
        from app.services.analytics import submit_analytics_job

        async with _async_session() as db:
            await submit_analytics_job(
                db=db, run_id=eval_run_id,
                app_id=params.app_id, tenant_id=tenant_id, user_id=user_id,
            )
            await db.commit()
    except Exception:
        logger.warning(
            "Failed to submit analytics job for run %s", eval_run_id, exc_info=True
        )

    return {
        "status": final_status,
        "run_id": str(eval_run_id),
        **summary,
    }


# ── Internal helpers ────────────────────────────────────────────────


async def _load_evaluators(
    *,
    evaluator_ids: list[uuid.UUID],
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> list[EvaluatorSpec]:
    from types import SimpleNamespace

    auth_view = SimpleNamespace(
        tenant_id=tenant_id, user_id=user_id, app_access=frozenset()
    )
    out: list[EvaluatorSpec] = []
    async with _async_session() as db:
        for eid in evaluator_ids:
            ev = await db.scalar(
                select(Evaluator).where(
                    Evaluator.id == eid,
                    readable_scope_clause(Evaluator, auth_view),
                )
            )
            if ev:
                out.append(
                    EvaluatorSpec(
                        id=ev.id,
                        name=ev.name,
                        prompt=ev.prompt,
                        output_schema=ev.output_schema,
                    )
                )
    return out


async def _aggregate(
    *,
    results: list,
    records: list[EvaluableCall],
    evaluators: list[EvaluatorSpec],
    eval_run_id: uuid.UUID,
) -> tuple[int, int, dict[str, list[float]]]:
    evaluated = 0
    failed = 0
    per_eval_scores: dict[str, list[float]] = {str(ev.id): [] for ev in evaluators}
    for index, r in enumerate(results):
        if isinstance(r, BaseException):
            failed += 1
            record = records[index] if index < len(records) else None
            await _persist_failed_thread(
                run_id=eval_run_id, record=record, error=r, error_index=failed
            )
        elif isinstance(r, dict):
            evaluated += 1
            for ev_id, score in (r.get("per_evaluator_scores") or {}).items():
                if isinstance(score, (int, float)):
                    per_eval_scores.setdefault(ev_id, []).append(float(score))
    return evaluated, failed, per_eval_scores


def _build_summary(
    *,
    evaluators: list[EvaluatorSpec],
    per_eval_scores: dict[str, list[float]],
    evaluated: int,
    failed: int,
    total: int,
    diagnostics,
) -> dict[str, Any]:
    evaluator_summaries: list[dict[str, Any]] = []
    averages: list[float] = []
    for ev in evaluators:
        ev_id = str(ev.id)
        scores = per_eval_scores.get(ev_id, [])
        primary = find_primary_field(ev.output_schema) or {}
        avg = round(sum(scores) / len(scores), 1) if scores else None
        if avg is not None:
            averages.append(avg)
        evaluator_summaries.append(
            {
                "id": ev_id,
                "name": ev.name,
                "primary_field": primary.get("key"),
                "primary_type": primary.get("type"),
                "average_score": avg,
                "completed": len(scores),
            }
        )
    overall = round(sum(averages) / len(averages), 1) if averages else None
    return {
        "total": total,
        "evaluated": evaluated,
        "failed": failed,
        "average_score": overall,
        "evaluator_names": [ev.name for ev in evaluators],
        "evaluators": evaluator_summaries,
        "overall_score": overall,
        "selection_diagnostics": diagnostics.model_dump(mode="json"),
    }


def _empty_selection_message(selection: ResolvedSelection) -> str:
    diag = selection.diagnostics
    return (
        f"Selection resolved 0 records. "
        f"Universe={diag.universe_total}, after predicates={diag.after_universe_predicates}, "
        f"after skip-evaluated={diag.after_skip_evaluated}. "
        f"Predicates: {json.dumps(diag.predicate_summary, sort_keys=True)}"
    )


async def _finalize_failed(
    *,
    eval_run_id: uuid.UUID,
    tenant_id: uuid.UUID,
    start_time: float,
    error_message: str,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    await finalize_eval_run(
        eval_run_id, tenant_id,
        status="failed",
        duration_ms=(time.monotonic() - start_time) * 1000,
        error_message=error_message,
        config=config,
    )
    return {"status": "failed", "error": error_message, "run_id": str(eval_run_id)}


__all__ = ["DatasetConfigMissing", "UnknownWorkerError", "run_eval"]
