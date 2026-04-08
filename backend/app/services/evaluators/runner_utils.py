"""Shared utilities for evaluation runners.

Extracted from the four runner files to eliminate duplication:
  - save_api_log        → was copy-pasted in every runner
  - create_eval_run     → replaces inline db.add(EvalRun(...)) blocks
  - finalize_eval_run   → replaces terminal-state UPDATE blocks
  - find_primary_field  → replaces _detect_primary_field / inline scan
"""
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import update

from app.models.eval_run import EvalRun, ApiLog
from app.services.evaluators.output_schema_utils import find_primary_field

logger = logging.getLogger(__name__)


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
) -> None:
    """Create an EvalRun in 'running' state.

    Call this as early as possible so failures are always visible in the UI.
    """
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
            status="running",
            started_at=datetime.now(timezone.utc),
            llm_provider=llm_provider,
            llm_model=llm_model,
            config=config or {},
            batch_metadata=batch_metadata,
        ))
        await db.commit()


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
