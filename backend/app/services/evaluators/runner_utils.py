"""Shared utilities for evaluation runners.

Extracted from the four runner files to eliminate duplication:
  - save_api_log        → was copy-pasted in every runner
  - create_eval_run     → replaces inline db.add(EvalRun(...)) blocks
  - finalize_eval_run   → replaces terminal-state UPDATE blocks
  - find_primary_field  → replaces _detect_primary_field / inline scan

Submit-time placeholder flow (Phase 0, 2026-04):
  - create_pending_eval_run_for_job: called from POST /api/jobs, inserts an
    EvalRun with status='pending' so queued work is visible in the UI before
    the worker claims the job. Returns the EvalRun id, which is also stored
    back into job.params['eval_run_id'] so runners reuse the same id.
  - promote_eval_run_to_running: called from runners. UPDATE-if-placeholder-
    exists, INSERT-otherwise (backward compat for non-wizard paths).
"""
import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from sqlalchemy import update

from app.models.eval_run import EvalRun, ApiLog
from app.models.job import Job
from app.services.cost_tracking.provider_map import internal_provider_from_classname
from app.services.cost_tracking.recorder import record_llm_usage
from app.services.evaluators.output_schema_utils import find_primary_field

logger = logging.getLogger(__name__)

# ── Job type → eval type mapping ─────────────────────────────────────
#
# Only job types that produce exactly ONE EvalRun appear here. Batch-of-runs
# types (evaluate-custom-batch fans out to N child run_custom_evaluator calls,
# each with its own EvalRun) are intentionally absent — a single placeholder
# would be orphaned. Non-evaluation job types (generate-report,
# sync-external-source, populate-analytics) also return None.
#
# Single source of truth. Don't mirror this mapping elsewhere.
JOB_TYPE_TO_EVAL_TYPE: dict[str, str] = {
    "evaluate-voice-rx": "full_evaluation",
    "evaluate-batch": "batch_thread",
    "evaluate-adversarial": "batch_adversarial",
    "evaluate-custom": "custom",
    "evaluate-inside-sales": "call_quality",
}


def _async_session():
    from app.database import async_session

    return async_session()


# ── API Log Persistence ──────────────────────────────────────────────


async def save_api_log(log_entry: dict) -> None:
    """Persist an LLM API log entry to PostgreSQL.

    Superset version: handles all optional fields including test_case_label
    (used by adversarial runner).
    """
    run_id = log_entry.get("run_id")
    if run_id and isinstance(run_id, str):
        try:
            run_id = uuid.UUID(run_id)
        except ValueError:
            run_id = None

    async with _async_session() as db:
        db.add(ApiLog(
            run_id=run_id,
            thread_id=log_entry.get("thread_id"),
            test_case_label=log_entry.get("test_case_label"),
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


# ── LLM Usage (cost_tracking) Callback Factory ───────────────────────


def make_usage_callback(
    *,
    tenant_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
    app_id: str,
    owner_type: str,
    owner_id: Optional[uuid.UUID] = None,
    subsystem: Optional[str] = None,
) -> Callable[[dict], Awaitable[None]]:
    """Return an async callable suitable for ``LoggingLLMWrapper(usage_callback=...)``.

    The wrapper invokes this with a per-call envelope (provider classname,
    model, method, metadata, status, error_code, call_purpose, stage_index,
    duration_ms). The closure attaches caller-known context (tenant, user, app,
    owner_type/owner_id) and forwards to ``record_llm_usage``.
    """

    async def _callback(entry: dict) -> None:
        try:
            provider_key = internal_provider_from_classname(
                entry.get("provider_classname") or ""
            )
            await record_llm_usage(
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=app_id,
                owner_type=owner_type,
                owner_id=owner_id,
                subsystem=subsystem,
                provider=provider_key,
                model=entry.get("model") or "",
                api_surface=(entry.get("metadata") or {}).get("api_surface"),
                call_purpose=entry.get("call_purpose"),
                stage_index=entry.get("stage_index"),
                metadata=entry.get("metadata"),
                duration_ms=entry.get("duration_ms"),
                status=entry.get("status") or "ok",
                error_code=entry.get("error_code"),
            )
        except Exception as exc:  # noqa: BLE001 — callback must never raise
            logger.warning("make_usage_callback forward failed: %s", exc)

    return _callback


# ── EvalRun Lifecycle ────────────────────────────────────────────────


async def create_eval_run(
    *,
    id: uuid.UUID,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    eval_type: str,
    job_id,
    listing_id: Optional[uuid.UUID] = None,
    session_id: Optional[uuid.UUID] = None,
    evaluator_id: Optional[uuid.UUID] = None,
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    config: Optional[dict] = None,
    batch_metadata: Optional[dict] = None,
    status: str = "running",
    started_at: Optional[datetime] = None,
) -> None:
    """Create an EvalRun row.

    Defaults to status='running' + started_at=now() for the existing runner
    call sites. Submit-time placeholders pass status='pending' and leave
    started_at as None (the row is not "running" yet).
    """
    if started_at is None and status == "running":
        started_at = datetime.now(timezone.utc)
    async with _async_session() as db:
        db.add(EvalRun(
            id=id,
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            eval_type=eval_type,
            job_id=job_id,
            listing_id=listing_id,
            session_id=session_id,
            evaluator_id=evaluator_id,
            status=status,
            started_at=started_at,
            llm_provider=llm_provider,
            llm_model=llm_model,
            config=config or {},
            batch_metadata=batch_metadata,
        ))
        await db.commit()


async def promote_eval_run_to_running(
    *,
    id: uuid.UUID,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    eval_type: str,
    job_id,
    listing_id: Optional[uuid.UUID] = None,
    session_id: Optional[uuid.UUID] = None,
    evaluator_id: Optional[uuid.UUID] = None,
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    config: Optional[dict] = None,
    batch_metadata: Optional[dict] = None,
) -> None:
    """Promote a pending placeholder EvalRun to running, or INSERT if none exists.

    Runners call this instead of ``create_eval_run`` so that:
      - If a submit-time placeholder exists (normal wizard flow), its status
        flips from 'pending' to 'running' and the runner-time fields
        (llm_provider, llm_model, config, batch_metadata, started_at) are
        populated. Placeholder row id is preserved.
      - If no placeholder exists (non-wizard paths, tests, retries after a
        placeholder-less submit), the row is INSERTed with status='running'.
      - Retries: if a previous attempt wrote a terminal row with the same id,
        the UPDATE resets status to 'running' and clears error_message so the
        new attempt owns the row.

    Match by primary key; tenant_id is added as a belt-and-braces filter.
    """
    now = datetime.now(timezone.utc)
    values: dict[str, Any] = {
        "status": "running",
        "started_at": now,
        "error_message": None,
        # On retry the prior attempt may have set terminal markers; reset them
        # so the row cleanly represents "this new attempt is underway".
        "completed_at": None,
        "duration_ms": None,
    }
    # Only overwrite fields the caller provided — don't null out placeholder data.
    if listing_id is not None:
        values["listing_id"] = listing_id
    if session_id is not None:
        values["session_id"] = session_id
    if evaluator_id is not None:
        values["evaluator_id"] = evaluator_id
    if llm_provider is not None:
        values["llm_provider"] = llm_provider
    if llm_model is not None:
        values["llm_model"] = llm_model
    if config is not None:
        values["config"] = config
    if batch_metadata is not None:
        values["batch_metadata"] = batch_metadata

    async with _async_session() as db:
        result = await db.execute(
            update(EvalRun)
            .where(EvalRun.id == id, EvalRun.tenant_id == tenant_id)
            .values(**values)
        )
        if result.rowcount:
            await db.commit()
            return

    # No placeholder → fall through to INSERT via the existing helper.
    await create_eval_run(
        id=id,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        eval_type=eval_type,
        job_id=job_id,
        listing_id=listing_id,
        session_id=session_id,
        evaluator_id=evaluator_id,
        llm_provider=llm_provider,
        llm_model=llm_model,
        config=config,
        batch_metadata=batch_metadata,
        status="running",
        started_at=now,
    )


def _uuid_or_none(value) -> Optional[uuid.UUID]:
    """Coerce a params value to UUID. Accepts UUID, str, or None."""
    if value is None or value == "":
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


async def create_pending_eval_run_for_job(job: Job, params: dict) -> Optional[uuid.UUID]:
    """Insert a placeholder EvalRun at job-submit time.

    Called from POST /api/jobs so queued work is visible in the Runs list
    before the worker claims the job.

    Behavior:
      - Job types not in JOB_TYPE_TO_EVAL_TYPE (e.g. sync-external-source,
        populate-analytics, generate-report) → returns None, no row inserted.
      - Job types that produce an EvalRun → inserts status='pending' with
        whatever FK fields are derivable from params. Runner-time fields
        (llm_provider, config, batch_metadata) are filled in later by
        promote_eval_run_to_running.

    Returns the EvalRun id on success, None if no placeholder was created.
    Callers must also store this id back into job.params['eval_run_id'] so
    the runner reuses it.
    """
    eval_type = JOB_TYPE_TO_EVAL_TYPE.get(job.job_type)
    if not eval_type:
        return None

    eval_run_id = uuid.uuid4()
    await create_eval_run(
        id=eval_run_id,
        tenant_id=job.tenant_id,
        user_id=job.user_id,
        app_id=job.app_id or "",
        eval_type=eval_type,
        job_id=job.id,
        listing_id=_uuid_or_none(params.get("listing_id")),
        session_id=_uuid_or_none(params.get("session_id")),
        evaluator_id=_uuid_or_none(params.get("evaluator_id")),
        status="pending",
    )
    return eval_run_id


async def finalize_eval_run(
    run_id: uuid.UUID,
    tenant_id: uuid.UUID,
    *,
    status: str,
    duration_ms: float,
    result: Optional[dict] = None,
    summary: Optional[dict] = None,
    error_message: Optional[str] = None,
    config: Optional[dict] = None,
) -> None:
    """Set an EvalRun to a terminal state.

    Guards against overwriting a cancel for non-cancel finalize
    (WHERE status != 'cancelled').  Cancel finalize always applies.
    Filters by tenant_id to ensure we only update our own records.
    """
    values: dict = {
        "status": status,
        "completed_at": datetime.now(timezone.utc),
        "duration_ms": duration_ms,
    }
    if result is not None:
        values["result"] = result
    if summary is not None:
        values["summary"] = summary
    if error_message is not None:
        values["error_message"] = error_message
    if config is not None:
        values["config"] = config

    async with _async_session() as db:
        condition = (EvalRun.id == run_id) & (EvalRun.tenant_id == tenant_id)
        if status != "cancelled":
            # Don't overwrite a cancel that arrived via the cancel route
            condition = condition & (EvalRun.status != "cancelled")  # type: ignore[assignment]
        await db.execute(update(EvalRun).where(condition).values(**values))
        await db.commit()


# ── Schema Utilities ─────────────────────────────────────────────────
