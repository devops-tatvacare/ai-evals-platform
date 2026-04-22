"""Boundary helpers for `[now-7d, now]` hot-window decisions + on-demand syncs.

§PR5 — when a user's filter window extends before `now - 7d`, the backend
enqueues a scoped `sync-external-source` job for the missing window and
chains dependents via `depends_on_job_id`. This module owns:

  - `hot_boundary(now)`: returns `now - 7d`
  - `is_inside_hot_window(...)`: pure predicate
  - `validate_ondemand_window(...)`: enforces the 30-day cap (§1.1)
  - `build_boundary_sync_job_params(...)`: explicit `date_range` payload
    (never routed through `build_manual_refresh_job_params()` which would
    collapse to `incremental` after any prior successful sync)
  - `find_or_enqueue_ondemand_sync(...)`: dedup against queued/running
    on-demand sync jobs that already cover the requested window
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job

_log = logging.getLogger(__name__)

HOT_WINDOW_DAYS = 7
ONDEMAND_WINDOW_CAP_DAYS = 30
_DATE_FMT = "%Y-%m-%d %H:%M:%S"


def _parse(value: str) -> datetime:
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValueError("date string required")
    if "T" in cleaned:
        cleaned = cleaned.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(cleaned)
    else:
        parsed = datetime.strptime(cleaned, _DATE_FMT)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def hot_boundary(now: datetime) -> datetime:
    """`now - 7d` — the earliest timestamp guaranteed in the synced source window."""
    tz_now = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    return tz_now - timedelta(days=HOT_WINDOW_DAYS)


def is_inside_hot_window(date_from: str, date_to: str, now: datetime) -> bool:
    """True when `[date_from, date_to]` sits entirely within `[now-7d, now]`."""
    boundary = hot_boundary(now)
    try:
        from_dt = _parse(date_from)
        to_dt = _parse(date_to)
    except ValueError:
        return False
    return from_dt >= boundary and to_dt <= now.astimezone(timezone.utc)


def validate_ondemand_window(
    date_from: str,
    date_to: str,
    now: datetime,
    *,
    max_days: int = ONDEMAND_WINDOW_CAP_DAYS,
) -> None:
    """Raises HTTPException(400) when the out-of-window range exceeds `max_days`."""
    try:
        from_dt = _parse(date_from)
        to_dt = _parse(date_to)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date range: {exc}") from exc

    if to_dt < from_dt:
        raise HTTPException(status_code=400, detail="date_to must be >= date_from")

    boundary = hot_boundary(now)
    # Only the portion before the hot boundary is the "on-demand" range.
    effective_from = min(from_dt, boundary)
    span_days = max(0, (boundary - effective_from).days)
    if span_days > max_days:
        raise HTTPException(
            status_code=400,
            detail=f"Out-of-window range capped at {max_days} days",
        )


def build_boundary_sync_job_params(
    source_family: str,
    date_from: str,
    date_to: str,
    *,
    event_codes: str | None = None,
) -> dict[str, Any]:
    """Explicit `date_range` job params for a boundary-crossing on-demand sync.

    Distinct from `build_manual_refresh_job_params()` which can drop into
    `incremental` mode after a successful sync — that would silently discard
    the out-of-window portion the caller wanted. Always emits `date_range`
    plus `is_scheduled_run: False`.
    """
    if source_family not in ("calls", "leads"):
        raise ValueError(f"source_family must be 'calls' or 'leads', got {source_family!r}")
    params: dict[str, Any] = {
        "app_id": "inside-sales",
        "source_family": source_family,
        "source_system": "lsq",
        "sync_mode": "date_range",
        "date_from": date_from,
        "date_to": date_to,
        "is_scheduled_run": False,
    }
    if source_family == "calls" and event_codes:
        params["event_codes"] = event_codes
    return params


async def find_or_enqueue_ondemand_sync(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    source_family: str,
    date_from: str,
    date_to: str,
    user_id: uuid.UUID,
    event_codes: str | None = None,
) -> Job:
    """Reuse a queued/running on-demand sync that already covers the needed window.

    Dedup rule: a pending `sync-external-source` job is considered a match when
    `(tenant_id, app_id, source_family)` match and the pending job's
    `[date_from, date_to]` fully contains `[date_from, date_to]` of the new
    request. Otherwise enqueue a fresh job.
    """
    from app.services.job_worker import get_job_submission_metadata

    req_from = _parse(date_from)
    req_to = _parse(date_to)

    pending_stmt = (
        select(Job)
        .where(
            Job.tenant_id == tenant_id,
            Job.app_id == app_id,
            Job.job_type == "sync-external-source",
            Job.status.in_(("queued", "running", "retryable_failed")),
        )
        .order_by(Job.created_at.desc())
        .limit(25)
    )
    pending = (await db.execute(pending_stmt)).scalars().all()
    for existing in pending:
        params = existing.params or {}
        if params.get("source_family") != source_family:
            continue
        if params.get("is_scheduled_run"):
            # Scheduled fires prune; we do NOT want to chain dependents onto
            # a fire that will shrink the synced source window before they read.
            continue
        try:
            ex_from = _parse(str(params.get("date_from") or ""))
            ex_to = _parse(str(params.get("date_to") or ""))
        except ValueError:
            continue
        if ex_from <= req_from and ex_to >= req_to:
            _log.info(
                "inside_sales.boundary.dedup_hit",
                extra={
                    "tenantId": str(tenant_id),
                    "sourceFamily": source_family,
                    "existingJobId": str(existing.id),
                },
            )
            return existing

    payload = build_boundary_sync_job_params(
        source_family, date_from, date_to, event_codes=event_codes
    )
    metadata = get_job_submission_metadata("sync-external-source", payload)
    job = Job(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        job_type="sync-external-source",
        status="queued",
        params={
            **payload,
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "app_id": str(metadata["app_id"]),
        },
        priority=int(metadata["priority"]),
        queue_class=str(metadata["queue_class"]),
        max_attempts=int(metadata["max_attempts"]),
        progress={"current": 0, "total": 0, "message": "Boundary sync queued"},
    )
    db.add(job)
    await db.flush()
    _log.info(
        "inside_sales.boundary.enqueued",
        extra={
            "tenantId": str(tenant_id),
            "sourceFamily": source_family,
            "jobId": str(job.id),
            "dateFrom": date_from,
            "dateTo": date_to,
        },
    )
    return job
