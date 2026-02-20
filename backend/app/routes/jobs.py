"""Jobs API - submit, list, check status, cancel background jobs."""
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc, update
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone

from app.database import get_db
from app.models.job import Job
from app.models.eval_run import EvalRun
from app.schemas.job import JobCreate, JobResponse

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.post("", response_model=JobResponse, status_code=201)
async def submit_job(
    body: JobCreate,
    db: AsyncSession = Depends(get_db),
):
    """Submit a new background job."""
    job = Job(**body.model_dump())
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


@router.get("", response_model=list[JobResponse])
async def list_jobs(
    status: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List jobs, optionally filtered by status."""
    query = select(Job).order_by(desc(Job.created_at)).limit(limit).offset(offset)
    if status:
        query = query.where(Job.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get job status and progress."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Cancel a queued or running job."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status in ("completed", "failed"):
        raise HTTPException(400, f"Cannot cancel job in '{job.status}' state")
    if job.status == "cancelled":
        # Still fix any orphaned eval_run (idempotent)
        await db.execute(
            update(EvalRun)
            .where(EvalRun.job_id == job_id, EvalRun.status == "running")
            .values(status="cancelled", completed_at=datetime.now(timezone.utc))
        )
        await db.commit()
        from app.services.job_worker import mark_job_cancelled
        mark_job_cancelled(job_id)
        return {"id": str(job_id), "status": "cancelled"}
    now = datetime.now(timezone.utc)
    job.status = "cancelled"
    job.completed_at = now
    # Also cancel any associated eval_run so RunDetail reflects it immediately
    await db.execute(
        update(EvalRun)
        .where(EvalRun.job_id == job_id, EvalRun.status == "running")
        .values(status="cancelled", completed_at=now)
    )
    await db.commit()
    from app.services.job_worker import mark_job_cancelled
    mark_job_cancelled(job_id)
    return {"id": str(job_id), "status": "cancelled"}
