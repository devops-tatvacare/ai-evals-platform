"""CRUD + control surface for tenant-scoped scheduled jobs."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext
from app.auth.permissions import require_permission
from app.database import get_db
from app.models.job import Job
from app.models.scheduled_job import ScheduledJob
from app.schemas.scheduled_job import (
    RegisteredPredicateEntry,
    RegisteredWorkloadEntry,
    ScheduledJobCreate,
    ScheduledJobDetailResponse,
    ScheduledJobFireSummary,
    ScheduledJobRow,
    ScheduledJobUpdate,
    ScheduledJobsRegistryResponse,
    ScheduleOverride,
)
from app.services.scheduler.config import VALID_ON_EXHAUST_MODES
from app.services.scheduler.engine import (
    fire_now as engine_fire_now,
    next_cron_tick,
    validate_cron_expression,
)
from app.services.scheduler.predicates import get_registered_predicates
from app.services.scheduler.workloads import get_workload, get_workloads

router = APIRouter(prefix="/api/scheduled-jobs", tags=["scheduled-jobs"])

RECENT_FIRES_LIMIT = 50


def _serialize_schedule(schedule: ScheduledJob) -> ScheduledJobRow:
    return ScheduledJobRow.model_validate(schedule, from_attributes=True)


def _override_to_jsonb(override: ScheduleOverride | dict[str, Any] | None) -> dict[str, Any]:
    """Canonical snake_case dict for JSONB storage.

    The engine reads `schedule.override.get("skip_criteria")` etc. (snake_case),
    so the DB payload must always be snake_case. Accepts either the parsed
    pydantic model (typical path after FastAPI validation) or a raw dict.
    """
    if override is None:
        return ScheduleOverride().model_dump(exclude_none=False)
    if isinstance(override, ScheduleOverride):
        return override.model_dump(exclude_none=False)
    try:
        parsed = ScheduleOverride.model_validate(override or {})
    except Exception as exc:  # pydantic.ValidationError or similar
        raise HTTPException(status_code=400, detail=f"Invalid override: {exc}") from exc
    return parsed.model_dump(exclude_none=False)


def _validate_workload(app_id: str, job_type: str) -> None:
    if get_workload(app_id, job_type) is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown scheduled workload: app={app_id!r} type={job_type!r}. "
                "Register it in app.services.scheduler.workloads before creating a schedule."
            ),
        )


async def _load_owned(
    db: AsyncSession,
    schedule_id: uuid.UUID,
    auth: AuthContext,
) -> ScheduledJob:
    schedule = await db.scalar(
        select(ScheduledJob).where(
            ScheduledJob.id == schedule_id,
            ScheduledJob.tenant_id == auth.tenant_id,
        )
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="Scheduled job not found")
    return schedule


@router.get("/registry", response_model=ScheduledJobsRegistryResponse)
async def list_registry(
    auth: AuthContext = require_permission("schedule:manage"),
) -> ScheduledJobsRegistryResponse:
    """Drive the Create Schedule overlay: predicates, workloads, apps, exhaust modes."""
    del auth  # auth only needed for permission gating
    workloads = [
        RegisteredWorkloadEntry(
            app_id=w.app_id,
            job_type=w.job_type,
            label=w.label,
            description=w.description,
            launch_source=w.launch_source,
            source_list_endpoint=w.source_list_endpoint,
            default_params=w.default_params,
        )
        for w in get_workloads()
    ]
    predicates = [
        RegisteredPredicateEntry(
            id=entry["id"],
            label=entry["label"],
            description=entry["description"],
            default_scope=entry.get("defaultScope"),
            supported_scopes=list(entry.get("supportedScopes") or []),
        )
        for entry in get_registered_predicates()
    ]
    apps = sorted({w.app_id for w in get_workloads()})
    return ScheduledJobsRegistryResponse(
        predicates=predicates,
        workloads=workloads,
        apps=apps,
        on_exhaust_modes=sorted(VALID_ON_EXHAUST_MODES),
    )


@router.get("", response_model=list[ScheduledJobRow])
async def list_schedules(
    app_id: str | None = None,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
) -> list[ScheduledJobRow]:
    stmt = select(ScheduledJob).where(ScheduledJob.tenant_id == auth.tenant_id)
    if app_id:
        stmt = stmt.where(ScheduledJob.app_id == app_id)
    stmt = stmt.order_by(ScheduledJob.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [_serialize_schedule(row) for row in rows]


@router.get("/{schedule_id}", response_model=ScheduledJobDetailResponse)
async def get_schedule(
    schedule_id: uuid.UUID,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
) -> ScheduledJobDetailResponse:
    schedule = await _load_owned(db, schedule_id, auth)
    fires_stmt = (
        select(Job)
        .where(
            Job.scheduled_job_id == schedule.id,
            Job.tenant_id == auth.tenant_id,
        )
        .order_by(desc(Job.created_at), desc(Job.id))
        .limit(RECENT_FIRES_LIMIT)
    )
    fires = (await db.execute(fires_stmt)).scalars().all()
    return ScheduledJobDetailResponse(
        schedule=_serialize_schedule(schedule),
        recent_fires=[
            ScheduledJobFireSummary.model_validate(job, from_attributes=True) for job in fires
        ],
    )


@router.post("", response_model=ScheduledJobRow, status_code=201)
async def create_schedule(
    payload: ScheduledJobCreate,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
) -> ScheduledJobRow:
    try:
        cron = validate_cron_expression(payload.cron)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _validate_workload(payload.app_id, payload.job_type)
    override = _override_to_jsonb(payload.override)
    now = datetime.now(timezone.utc)

    schedule = ScheduledJob(
        id=uuid.uuid4(),
        tenant_id=auth.tenant_id,
        app_id=payload.app_id,
        job_type=payload.job_type,
        schedule_key=payload.schedule_key,
        name=payload.name,
        description=payload.description,
        cron=cron,
        params=payload.params or {},
        override=override,
        enabled=payload.enabled,
        next_check_at=next_cron_tick(cron, now),
        current_cycle_attempts=0,
        created_by=auth.user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(schedule)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Schedule already exists for (app_id, job_type, schedule_key)",
        ) from exc
    await db.refresh(schedule)
    return _serialize_schedule(schedule)


@router.patch("/{schedule_id}", response_model=ScheduledJobRow)
async def update_schedule(
    schedule_id: uuid.UUID,
    payload: ScheduledJobUpdate,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
) -> ScheduledJobRow:
    schedule = await _load_owned(db, schedule_id, auth)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        schedule.name = data["name"]
    if "description" in data:
        schedule.description = data["description"]
    if "params" in data:
        schedule.params = data["params"] or {}
    if "override" in data:
        schedule.override = _override_to_jsonb(data["override"] or {})
    if "enabled" in data:
        schedule.enabled = bool(data["enabled"])
    if "cron" in data:
        try:
            new_cron = validate_cron_expression(data["cron"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        schedule.cron = new_cron
        schedule.next_check_at = next_cron_tick(new_cron, datetime.now(timezone.utc))
    await db.commit()
    await db.refresh(schedule)
    return _serialize_schedule(schedule)


@router.delete("/{schedule_id}", status_code=204)
async def delete_schedule(
    schedule_id: uuid.UUID,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
):
    schedule = await _load_owned(db, schedule_id, auth)
    await db.delete(schedule)
    await db.commit()


@router.post("/{schedule_id}/toggle", response_model=ScheduledJobRow)
async def toggle_schedule(
    schedule_id: uuid.UUID,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
) -> ScheduledJobRow:
    schedule = await _load_owned(db, schedule_id, auth)
    schedule.enabled = not schedule.enabled
    if schedule.enabled and schedule.next_check_at is None:
        schedule.next_check_at = next_cron_tick(schedule.cron, datetime.now(timezone.utc))
    await db.commit()
    await db.refresh(schedule)
    return _serialize_schedule(schedule)


@router.post("/{schedule_id}/fire-now", response_model=ScheduledJobRow)
async def fire_now_route(
    schedule_id: uuid.UUID,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
) -> ScheduledJobRow:
    schedule = await _load_owned(db, schedule_id, auth)
    job, reason = await engine_fire_now(db, schedule)
    if job is None:
        raise HTTPException(
            status_code=409,
            detail=f"Fire-now blocked by predicate: {reason}",
        )
    await db.refresh(schedule)
    return _serialize_schedule(schedule)
