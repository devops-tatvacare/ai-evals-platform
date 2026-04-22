"""Jobs API - submit, list, check status, cancel background jobs."""
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc, update
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone

from app.auth.app_scope import ensure_registered_app_access
from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission
from app.database import get_db
from app.models.job import Job
from app.models.eval_run import EvalRun
from app.schemas.job import JobCreate, JobResponse

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


async def _maybe_chain_boundary_sync(
    db: AsyncSession,
    *,
    auth: AuthContext,
    job_params: dict,
) -> UUID | None:
    """For evaluate-inside-sales: if filter window crosses `now-7d`, enqueue
    (or dedup) a date_range sync and return its id for `depends_on_job_id`.

    Returns None for in-window evals and for eval payloads that don't carry
    a usable `call_selection` date range (e.g. specific-IDs or manual runs).
    """
    from datetime import datetime as _dt, timezone as _tz

    from app.services.inside_sales_boundary import (
        find_or_enqueue_ondemand_sync,
        is_inside_hot_window,
        validate_ondemand_window,
    )

    call_selection = job_params.get("call_selection") or {}
    date_from = str(call_selection.get("date_from") or "").strip()
    date_to = str(call_selection.get("date_to") or "").strip()
    source_family = str(call_selection.get("source_family") or "calls").strip() or "calls"
    if not date_from or not date_to:
        return None

    now = _dt.now(_tz.utc)
    if is_inside_hot_window(date_from, date_to, now):
        return None

    validate_ondemand_window(date_from, date_to, now)

    event_codes = call_selection.get("event_codes")
    event_codes_str = event_codes if isinstance(event_codes, str) else None
    sync_job = await find_or_enqueue_ondemand_sync(
        db,
        tenant_id=auth.tenant_id,
        app_id="inside-sales",
        source_family=source_family,
        date_from=date_from,
        date_to=date_to,
        user_id=auth.user_id,
        event_codes=event_codes_str,
    )
    return sync_job.id


@router.post("", response_model=JobResponse, status_code=201)
async def submit_job(
    body: JobCreate,
    auth: AuthContext = require_permission('evaluation:run'),
    db: AsyncSession = Depends(get_db),
):
    """Submit a new background job. Injects auth context into params for downstream runners."""
    job_data = body.model_dump()
    job_params = dict(job_data.get("params") or {})

    from app.services.job_worker import get_job_submission_metadata

    try:
        metadata = get_job_submission_metadata(job_data["job_type"], job_params)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    await ensure_registered_app_access(
        db,
        auth,
        metadata["app_id"],
        required=True,
        param_name="app_id",
    )

    # Inject auth context into params — runners read this
    job_params["tenant_id"] = str(auth.tenant_id)
    job_params["user_id"] = str(auth.user_id)
    if metadata["app_id"]:
        job_params["app_id"] = metadata["app_id"]
    job_data["params"] = job_params

    # § PR5 boundary chaining for evaluate-inside-sales: if the filter window
    # extends before `now - 7d`, enqueue a scoped on-demand sync first and
    # chain this eval job to it via `depends_on_job_id`. Dedup against any
    # queued/running sync that already covers the same window.
    depends_on_job_id = None
    if job_data["job_type"] == "evaluate-inside-sales":
        depends_on_job_id = await _maybe_chain_boundary_sync(
            db, auth=auth, job_params=job_params
        )

    job = Job(
        **job_data,
        app_id=metadata["app_id"],
        priority=metadata["priority"],
        queue_class=metadata["queue_class"],
        max_attempts=metadata["max_attempts"],
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        depends_on_job_id=depends_on_job_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Placeholder EvalRun so queued work is visible in the Runs list before
    # the worker claims the job. Runners reuse params["eval_run_id"] so the
    # placeholder id is promoted in place instead of duplicated.
    from app.services.evaluators.runner_utils import create_pending_eval_run_for_job
    eval_run_id = await create_pending_eval_run_for_job(job, job_params)
    if eval_run_id is not None:
        job_params["eval_run_id"] = str(eval_run_id)
        job.params = job_params
        await db.commit()
        await db.refresh(job)

    return job


@router.get("", response_model=list[JobResponse])
async def list_jobs(
    status: Optional[str] = Query(None),
    job_type: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """List jobs for the current user."""
    query = (
        select(Job)
        .where(
            Job.tenant_id == auth.tenant_id,
            Job.user_id == auth.user_id,
        )
        .order_by(desc(Job.created_at))
        .limit(limit)
        .offset(offset)
    )
    if status:
        query = query.where(Job.status == status)
    if job_type:
        query = query.where(Job.job_type == job_type)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Get job status and progress."""
    job = await db.scalar(
        select(Job).where(
            Job.id == job_id,
            Job.tenant_id == auth.tenant_id,
            Job.user_id == auth.user_id,
        )
    )
    if not job:
        raise HTTPException(404, "Job not found")
    await ensure_registered_app_access(
        db,
        auth,
        job.app_id,
        required=False,
        param_name="app_id",
    )

    # Compute queue position for queued jobs
    if job.status in ("queued", "retryable_failed"):
        from app.services.job_worker import get_queue_position
        job.queue_position = await get_queue_position(str(job_id))

    return job


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: UUID,
    auth: AuthContext = require_permission('evaluation:cancel'),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a queued or running job."""
    job = await db.scalar(
        select(Job).where(
            Job.id == job_id,
            Job.tenant_id == auth.tenant_id,
            Job.user_id == auth.user_id,
        )
    )
    if not job:
        raise HTTPException(404, "Job not found")
    await ensure_registered_app_access(
        db,
        auth,
        job.app_id,
        required=False,
        param_name="app_id",
    )
    if job.status in ("completed", "failed"):
        raise HTTPException(400, f"Cannot cancel job in '{job.status}' state")
    if job.status == "cancelled":
        # Still fix any orphaned eval_run (idempotent)
        await db.execute(
            update(EvalRun)
            .where(EvalRun.job_id == job_id, EvalRun.status.in_(("pending", "running")))
            .values(status="cancelled", completed_at=datetime.now(timezone.utc))
        )
        await db.commit()
        from app.services.job_worker import mark_job_cancelled
        mark_job_cancelled(job_id)
        return {"id": str(job_id), "status": "cancelled"}
    now = datetime.now(timezone.utc)
    job.status = "cancelled"
    job.completed_at = now
    job.lease_owner = None
    job.lease_expires_at = None
    job.heartbeat_at = now
    job.next_retry_at = None
    # Also cancel any associated eval_run so RunDetail reflects it immediately
    await db.execute(
        update(EvalRun)
        .where(EvalRun.job_id == job_id, EvalRun.status.in_(("pending", "running")))
        .values(status="cancelled", completed_at=now)
    )
    await db.commit()
    from app.services.job_worker import mark_job_cancelled
    mark_job_cancelled(job_id)
    return {"id": str(job_id), "status": "cancelled"}
