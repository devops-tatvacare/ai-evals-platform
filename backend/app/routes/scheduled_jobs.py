"""CRUD + control surface for tenant-scoped scheduled jobs."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext
from app.auth.permissions import require_permission
from app.constants import SYSTEM_TENANT_ID
from app.database import get_db
from app.models.job import BackgroundJob
from app.models.scheduled_job import ScheduledJobDefinition
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
from app.services.scheduler.workloads import (
    ensure_handler_workloads_registered,
    get_workload,
    get_workloads,
)

# One-shot: makes sure every ``@register_job_handler(..., schedulable=True)``
# has populated the workload registry before the route module is consumed.
# Safe to call at import; a second call is a dict lookup on ``sys.modules``.
ensure_handler_workloads_registered()

router = APIRouter(prefix="/api/scheduled-jobs", tags=["scheduled-jobs"])

RECENT_FIRES_LIMIT = 50

# Ordered list of keys runners use to report a row/record count in
# ``BackgroundJob.result``. First match wins. Centralized here so the schedule
# detail route stays runner-agnostic — adding a new runner that already
# uses one of these keys is automatic.
_ROW_COUNT_KEYS: tuple[str, ...] = (
    "rows_processed",
    "rows_inserted",
    "records_upserted",
    "records_processed",
    "rows",
)


def _extract_fire_row_count(result: dict[str, Any] | None) -> int | None:
    """Pull a row/record count out of a finished job's ``result`` dict.

    Returns ``None`` when the runner did not surface a count under any
    known key (e.g. evaluation jobs). The UI hides the Rows column when
    every visible fire returns ``None``.
    """
    if not isinstance(result, dict):
        return None
    for key in _ROW_COUNT_KEYS:
        value = result.get(key)
        if isinstance(value, bool):
            # ``bool`` is an ``int`` subclass — guard against truthy flags.
            continue
        if isinstance(value, int):
            return value
    return None


def _serialize_fire_summary(job: BackgroundJob) -> ScheduledJobFireSummary:
    summary = ScheduledJobFireSummary.model_validate(job, from_attributes=True)
    summary.rows = _extract_fire_row_count(job.result)
    return summary


def _is_platform_schedule(schedule: ScheduledJobDefinition) -> bool:
    """Platform-managed schedules are owned by the system tenant.

    Every other tenant sees them as read-only — they show up in the UI
    list so operators know they exist (e.g. the daily cost rollup), but
    mutations are rejected with 403.
    """
    return schedule.tenant_id == SYSTEM_TENANT_ID


async def _resolve_last_fire_statuses(
    db: AsyncSession, schedules: Iterable[ScheduledJobDefinition]
) -> dict[uuid.UUID | None, str | None]:
    """Batch-load ``jobs.status`` for every schedule's ``last_fire_job_id``.

    One query per list call, regardless of list size. Avoids N+1 when a
    tenant has dozens of schedules. Missing/deleted jobs (and schedules
    that have never fired) are absent from the result — the serializer
    treats a missing key as ``last_fire_status=None``. Return type
    includes ``None`` keys so callers can pass ``last_fire_job_id``
    (which is ``UUID | None``) without pre-filtering.
    """
    ids = {s.last_fire_job_id for s in schedules if s.last_fire_job_id is not None}
    if not ids:
        return {}
    rows = await db.execute(
        select(BackgroundJob.id, BackgroundJob.status).where(BackgroundJob.id.in_(ids))
    )
    return {job_id: status for job_id, status in rows.all()}


def _serialize_schedule(
    schedule: ScheduledJobDefinition,
    *,
    last_fire_status: str | None = None,
) -> ScheduledJobRow:
    row = ScheduledJobRow.model_validate(schedule, from_attributes=True)
    row.is_platform_managed = _is_platform_schedule(schedule)
    row.last_fire_status = last_fire_status
    return row


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
                "Mark the handler `schedulable=True` in `@register_job_handler` "
                "(app.services.job_worker) before creating a schedule."
            ),
        )


async def _load_visible(
    db: AsyncSession,
    schedule_id: uuid.UUID,
    auth: AuthContext,
) -> ScheduledJobDefinition:
    """Return a schedule the caller is permitted to SEE.

    Visibility is: owning tenant's rows + SYSTEM_TENANT_ID rows (platform-wide).
    Use this for read endpoints (GET detail). For mutation endpoints call
    ``_load_owned_for_mutation`` instead — that one rejects platform rows
    with 403 so non-system users cannot edit them.
    """
    schedule = await db.scalar(
        select(ScheduledJobDefinition).where(
            ScheduledJobDefinition.id == schedule_id,
            or_(
                ScheduledJobDefinition.tenant_id == auth.tenant_id,
                ScheduledJobDefinition.tenant_id == SYSTEM_TENANT_ID,
            ),
        )
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="Scheduled job not found")
    return schedule


async def _load_owned_for_mutation(
    db: AsyncSession,
    schedule_id: uuid.UUID,
    auth: AuthContext,
) -> ScheduledJobDefinition:
    """Return a schedule the caller is permitted to MUTATE.

    Strict tenant ownership: platform-managed (system-tenant) rows return
    403, not 404, so the UI can distinguish "doesn't exist" from "exists
    but you can't touch it" and render a disabled button with a tooltip
    instead of hiding the row entirely.
    """
    schedule = await _load_visible(db, schedule_id, auth)
    if schedule.tenant_id != auth.tenant_id:
        raise HTTPException(
            status_code=403,
            detail=(
                "This schedule is platform-managed and cannot be modified "
                "from a tenant account. Contact platform operators."
            ),
        )
    return schedule


@router.get("/registry", response_model=ScheduledJobsRegistryResponse)
async def list_registry(
    auth: AuthContext = require_permission("schedule:manage"),
) -> ScheduledJobsRegistryResponse:
    """Drive the Create Schedule overlay: predicates, workloads, apps, exhaust modes.

    ``platform_managed`` workloads (e.g. the daily cost rollup seeded under
    the system tenant) are excluded here — users cannot create them, and
    surfacing them in the overlay would be dead UI. They remain looked up
    by ``get_workload(app_id, job_type)`` for the scheduler engine and
    for admin/ops tooling.
    """
    del auth  # auth only needed for permission gating
    user_facing = [w for w in get_workloads() if not w.platform_managed]
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
        for w in user_facing
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
    apps = sorted({w.app_id for w in user_facing})
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
    """List schedules visible to the caller.

    Returns the caller's own tenant schedules + every platform-managed
    schedule (owned by ``SYSTEM_TENANT_ID``, e.g. the daily cost rollup).
    Platform rows are tagged ``isPlatformManaged=true`` so the UI can
    mark them read-only. ``last_fire_status`` is resolved in one batched
    query to avoid N+1s.
    """
    stmt = select(ScheduledJobDefinition).where(
        or_(
            ScheduledJobDefinition.tenant_id == auth.tenant_id,
            ScheduledJobDefinition.tenant_id == SYSTEM_TENANT_ID,
        )
    )
    if app_id:
        stmt = stmt.where(ScheduledJobDefinition.app_id == app_id)
    stmt = stmt.order_by(ScheduledJobDefinition.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    statuses = await _resolve_last_fire_statuses(db, rows)
    return [
        _serialize_schedule(row, last_fire_status=statuses.get(row.last_fire_job_id))
        for row in rows
    ]


@router.get("/{schedule_id}", response_model=ScheduledJobDetailResponse)
async def get_schedule(
    schedule_id: uuid.UUID,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
) -> ScheduledJobDetailResponse:
    schedule = await _load_visible(db, schedule_id, auth)
    # ``recent_fires`` is scoped to the schedule's own tenant (not the
    # caller's) so a tenant user inspecting a platform schedule sees the
    # actual firing history rather than an empty list.
    fires_stmt = (
        select(BackgroundJob)
        .where(
            BackgroundJob.scheduled_job_id == schedule.id,
            BackgroundJob.tenant_id == schedule.tenant_id,
        )
        .order_by(desc(BackgroundJob.created_at), desc(BackgroundJob.id))
        .limit(RECENT_FIRES_LIMIT)
    )
    fires = (await db.execute(fires_stmt)).scalars().all()
    statuses = await _resolve_last_fire_statuses(db, [schedule])
    return ScheduledJobDetailResponse(
        schedule=_serialize_schedule(
            schedule,
            last_fire_status=statuses.get(schedule.last_fire_job_id),
        ),
        recent_fires=[_serialize_fire_summary(job) for job in fires],
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

    schedule = ScheduledJobDefinition(
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
        created_by_user_email_snapshot=auth.email,
        notify_owner_on_failure=payload.notify_owner_on_failure,
        notify_emails_on_failure=list(payload.notify_emails_on_failure),
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
    schedule = await _load_owned_for_mutation(db, schedule_id, auth)
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
    if "notify_owner_on_failure" in data:
        schedule.notify_owner_on_failure = bool(data["notify_owner_on_failure"])
    if "notify_emails_on_failure" in data:
        schedule.notify_emails_on_failure = list(data["notify_emails_on_failure"] or [])
    await db.commit()
    await db.refresh(schedule)
    return _serialize_schedule(schedule)


@router.delete("/{schedule_id}", status_code=204)
async def delete_schedule(
    schedule_id: uuid.UUID,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
):
    schedule = await _load_owned_for_mutation(db, schedule_id, auth)
    await db.delete(schedule)
    await db.commit()


@router.post("/{schedule_id}/toggle", response_model=ScheduledJobRow)
async def toggle_schedule(
    schedule_id: uuid.UUID,
    auth: AuthContext = require_permission("schedule:manage"),
    db: AsyncSession = Depends(get_db),
) -> ScheduledJobRow:
    schedule = await _load_owned_for_mutation(db, schedule_id, auth)
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
    schedule = await _load_owned_for_mutation(db, schedule_id, auth)
    job, reason = await engine_fire_now(db, schedule)
    if job is None:
        raise HTTPException(
            status_code=409,
            detail=f"Fire-now blocked by predicate: {reason}",
        )
    await db.refresh(schedule)
    return _serialize_schedule(schedule)
