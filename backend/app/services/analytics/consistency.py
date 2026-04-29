"""Shared analytics consistency queries and backfill helpers."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_facts import AggEvaluationRun
from app.models.eval_run import EvaluationRun
from app.models.job import Job
from app.services.analytics import submit_analytics_job
from app.services.analytics.constants import ANALYTICS_ELIGIBLE_RUN_STATUSES

_ACTIVE_ANALYTICS_JOB_STATUSES = ('queued', 'running', 'retryable_failed')


def _run_filters(*, tenant_id: UUID, app_id: str | None = None) -> list[Any]:
    filters: list[Any] = [
        EvaluationRun.tenant_id == tenant_id,
        EvaluationRun.status.in_(ANALYTICS_ELIGIBLE_RUN_STATUSES),
    ]
    if app_id:
        filters.append(EvaluationRun.app_id == app_id)
    return filters


def _run_fact_filters(*, tenant_id: UUID, app_id: str | None = None) -> list[Any]:
    filters: list[Any] = [
        AggEvaluationRun.tenant_id == tenant_id,
        AggEvaluationRun.status.in_(ANALYTICS_ELIGIBLE_RUN_STATUSES),
    ]
    if app_id:
        filters.append(AggEvaluationRun.app_id == app_id)
    return filters


async def list_runs_missing_analytics(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    app_id: str | None = None,
    limit: int | None = None,
) -> list[EvaluationRun]:
    """Return eligible terminal runs that do not yet have a run fact."""
    stmt = (
        select(EvaluationRun)
        .outerjoin(AggEvaluationRun, AggEvaluationRun.run_id == EvaluationRun.id)
        .where(
            *_run_filters(tenant_id=tenant_id, app_id=app_id),
            AggEvaluationRun.run_id.is_(None),
        )
        .order_by(EvaluationRun.created_at.desc(), EvaluationRun.id.desc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return list((await db.execute(stmt)).scalars().all())


async def build_analytics_consistency_summary(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    app_id: str | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    """Summarize run-to-analytics consistency for eligible terminal runs."""
    eligible_run_count = (
        await db.scalar(
            select(func.count())
            .select_from(EvaluationRun)
            .where(*_run_filters(tenant_id=tenant_id, app_id=app_id))
        )
    ) or 0
    analytics_run_fact_count = (
        await db.scalar(
            select(func.count())
            .select_from(AggEvaluationRun)
            .where(*_run_fact_filters(tenant_id=tenant_id, app_id=app_id))
        )
    ) or 0
    status_rows = await db.execute(
        select(EvaluationRun.status, func.count())
        .where(*_run_filters(tenant_id=tenant_id, app_id=app_id))
        .group_by(EvaluationRun.status)
        .order_by(EvaluationRun.status.asc())
    )
    missing_status_rows = await db.execute(
        select(EvaluationRun.status, func.count())
        .outerjoin(AggEvaluationRun, AggEvaluationRun.run_id == EvaluationRun.id)
        .where(
            *_run_filters(tenant_id=tenant_id, app_id=app_id),
            AggEvaluationRun.run_id.is_(None),
        )
        .group_by(EvaluationRun.status)
        .order_by(EvaluationRun.status.asc())
    )
    missing_runs = await list_runs_missing_analytics(
        db,
        tenant_id=tenant_id,
        app_id=app_id,
        limit=limit,
    )
    missing_by_status = {row[0]: row[1] for row in missing_status_rows.all()}
    missing_run_fact_count = sum(missing_by_status.values())

    return {
        'eligibleStatuses': list(ANALYTICS_ELIGIBLE_RUN_STATUSES),
        'eligibleRunCount': int(eligible_run_count),
        'analyticsRunFactCount': int(analytics_run_fact_count),
        'missingRunFactCount': int(missing_run_fact_count),
        'eligibleByStatus': {row[0]: row[1] for row in status_rows.all()},
        'missingByStatus': missing_by_status,
        'missingRuns': [
            {
                'runId': str(run.id),
                'appId': run.app_id,
                'evalType': run.eval_type,
                'status': run.status,
                'createdAt': run.created_at.isoformat() if run.created_at else None,
                'completedAt': run.completed_at.isoformat() if run.completed_at else None,
            }
            for run in missing_runs
        ],
    }


async def enqueue_missing_analytics_jobs(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    app_id: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Queue populate-analytics jobs for eligible runs missing run facts."""
    missing_runs = await list_runs_missing_analytics(
        db,
        tenant_id=tenant_id,
        app_id=app_id,
        limit=limit,
    )
    active_jobs = (
        await db.execute(
            select(Job).where(
                Job.tenant_id == tenant_id,
                Job.job_type == 'populate-analytics',
                Job.status.in_(_ACTIVE_ANALYTICS_JOB_STATUSES),
                *( [Job.app_id == app_id] if app_id else [] ),
            )
        )
    ).scalars().all()
    active_run_ids = {
        str(job.params.get('run_id'))
        for job in active_jobs
        if isinstance(job.params, dict) and job.params.get('run_id')
    }

    queued_runs: list[dict[str, Any]] = []
    skipped_run_ids: list[str] = []
    for run in missing_runs:
        run_id = str(run.id)
        if run_id in active_run_ids:
            skipped_run_ids.append(run_id)
            continue
        await submit_analytics_job(
            db=db,
            run_id=run.id,
            app_id=run.app_id,
            tenant_id=run.tenant_id,
            user_id=run.user_id,
        )
        queued_runs.append(
            {
                'runId': run_id,
                'appId': run.app_id,
                'evalType': run.eval_type,
                'status': run.status,
            }
        )

    return {
        'eligibleStatuses': list(ANALYTICS_ELIGIBLE_RUN_STATUSES),
        'requestedLimit': limit,
        'queuedCount': len(queued_runs),
        'skippedAlreadyQueuedCount': len(skipped_run_ids),
        'queuedRuns': queued_runs,
        'skippedRunIds': skipped_run_ids,
    }
