"""Jobs API - submit, list, check status, cancel background jobs."""
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone

from app.database import get_db
from app.models.job import Job

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.post("", status_code=201)
async def submit_job(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Submit a new background job."""
    job = Job(
        job_type=body["job_type"],
        params=body.get("params", {}),
        status="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return {
        "id": str(job.id),
        "job_type": job.job_type,
        "status": job.status,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


@router.get("")
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
    jobs = result.scalars().all()
    return [_to_dict(j) for j in jobs]


@router.get("/{job_id}")
async def get_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get job status and progress."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return _to_dict(job)


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Cancel a queued or running job."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status in ("completed", "failed", "cancelled"):
        raise HTTPException(400, f"Cannot cancel job in '{job.status}' state")
    job.status = "cancelled"
    job.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"id": str(job_id), "status": "cancelled"}


def _to_dict(job: Job) -> dict:
    return {
        "id": str(job.id),
        "job_type": job.job_type,
        "status": job.status,
        "params": job.params,
        "result": job.result,
        "progress": job.progress,
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }
