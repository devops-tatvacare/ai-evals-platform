"""Analytics services — fact population and job submission."""
from __future__ import annotations


async def submit_analytics_job(*, db, run_id, app_id, tenant_id, user_id):
    """Submit a populate-analytics job for a completed run.

    Called inside the caller's transaction — does not commit.
    """
    from app.models.job import Job

    job = Job(
        job_type="populate-analytics",
        app_id=app_id,
        tenant_id=tenant_id,
        user_id=user_id,
        priority=500,
        queue_class="analytics",
        max_attempts=3,
        params={"run_id": str(run_id), "app_id": app_id},
    )
    db.add(job)
    await db.flush()
