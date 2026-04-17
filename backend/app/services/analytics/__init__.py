"""Analytics services — fact population and job submission."""
from __future__ import annotations

from app.services.analytics.constants import ANALYTICS_ELIGIBLE_RUN_STATUSES


def should_populate_analytics_for_status(status: str) -> bool:
    return status in ANALYTICS_ELIGIBLE_RUN_STATUSES


async def submit_analytics_job(*, db, run_id, app_id, tenant_id, user_id):
    """Submit a populate-analytics job for an eligible terminal run.

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
        params={
            "run_id": str(run_id),
            "app_id": app_id,
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
        },
    )
    db.add(job)
    await db.flush()
