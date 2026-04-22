"""Boundary helpers — hot window predicate, 30-day cap, date_range builder."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.services.inside_sales_boundary import (
    build_boundary_sync_job_params,
    hot_boundary,
    is_inside_hot_window,
    validate_ondemand_window,
)


def _now() -> datetime:
    return datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc)


def test_hot_boundary_is_exactly_seven_days_before_now():
    now = _now()
    assert hot_boundary(now) == now - timedelta(days=7)


def test_is_inside_hot_window_true_for_last_3_days():
    now = _now()
    date_from = (now - timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S")
    date_to = now.strftime("%Y-%m-%d %H:%M:%S")
    assert is_inside_hot_window(date_from, date_to, now) is True


def test_is_inside_hot_window_false_when_before_boundary():
    now = _now()
    date_from = (now - timedelta(days=14)).strftime("%Y-%m-%d %H:%M:%S")
    date_to = now.strftime("%Y-%m-%d %H:%M:%S")
    assert is_inside_hot_window(date_from, date_to, now) is False


def test_validate_ondemand_window_rejects_over_30_days():
    now = _now()
    date_from = (now - timedelta(days=60)).strftime("%Y-%m-%d %H:%M:%S")
    date_to = now.strftime("%Y-%m-%d %H:%M:%S")
    with pytest.raises(HTTPException) as exc:
        validate_ondemand_window(date_from, date_to, now)
    assert exc.value.status_code == 400
    assert "30 days" in exc.value.detail


def test_validate_ondemand_window_allows_in_cap_window():
    now = _now()
    date_from = (now - timedelta(days=20)).strftime("%Y-%m-%d %H:%M:%S")
    date_to = now.strftime("%Y-%m-%d %H:%M:%S")
    validate_ondemand_window(date_from, date_to, now)


def test_validate_ondemand_window_rejects_reversed_range():
    now = _now()
    date_from = now.strftime("%Y-%m-%d %H:%M:%S")
    date_to = (now - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    with pytest.raises(HTTPException):
        validate_ondemand_window(date_from, date_to, now)


def test_build_boundary_sync_params_is_explicit_date_range_never_incremental():
    params = build_boundary_sync_job_params(
        "calls",
        "2026-04-01 00:00:00",
        "2026-04-05 00:00:00",
        event_codes="21,22",
    )
    assert params["sync_mode"] == "date_range"
    assert params["date_from"] == "2026-04-01 00:00:00"
    assert params["date_to"] == "2026-04-05 00:00:00"
    assert params["is_scheduled_run"] is False
    assert params["event_codes"] == "21,22"
    assert params["source_family"] == "calls"


def test_build_boundary_sync_params_rejects_unknown_family():
    with pytest.raises(ValueError):
        build_boundary_sync_job_params("contacts", "2026-04-01 00:00:00", "2026-04-05 00:00:00")


@pytest.mark.asyncio
async def test_find_or_enqueue_dedups_on_covering_pending_sync():
    import uuid
    from unittest.mock import AsyncMock

    from app.models.job import Job
    from app.services.inside_sales_boundary import find_or_enqueue_ondemand_sync

    tenant = uuid.uuid4()
    user = uuid.uuid4()
    existing = Job(
        id=uuid.uuid4(),
        tenant_id=tenant,
        user_id=user,
        app_id="inside-sales",
        job_type="sync-external-source",
        status="queued",
        params={
            "source_family": "calls",
            "date_from": "2026-04-01 00:00:00",
            "date_to": "2026-04-10 00:00:00",
            "is_scheduled_run": False,
        },
    )

    class _Result:
        def scalars(self):
            class _Scalars:
                def all(_self):
                    return [existing]
            return _Scalars()

    db = AsyncMock()
    db.execute = AsyncMock(return_value=_Result())
    db.flush = AsyncMock()
    db.add = AsyncMock()

    matched = await find_or_enqueue_ondemand_sync(
        db,
        tenant_id=tenant,
        app_id="inside-sales",
        source_family="calls",
        date_from="2026-04-02 00:00:00",
        date_to="2026-04-09 00:00:00",
        user_id=user,
    )
    assert matched is existing
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_find_or_enqueue_skips_scheduled_runs_when_deduping():
    """A scheduled fire prunes; dependents must NOT chain onto one."""
    import uuid
    from unittest.mock import AsyncMock

    from app.models.job import Job
    from app.services.inside_sales_boundary import find_or_enqueue_ondemand_sync

    tenant = uuid.uuid4()
    user = uuid.uuid4()
    scheduled = Job(
        id=uuid.uuid4(),
        tenant_id=tenant,
        user_id=user,
        app_id="inside-sales",
        job_type="sync-external-source",
        status="queued",
        params={
            "source_family": "calls",
            "date_from": "2026-04-01 00:00:00",
            "date_to": "2026-04-10 00:00:00",
            "is_scheduled_run": True,
        },
    )

    class _Result:
        def scalars(self):
            class _Scalars:
                def all(_self):
                    return [scheduled]
            return _Scalars()

    db = AsyncMock()
    db.execute = AsyncMock(return_value=_Result())
    db.flush = AsyncMock()

    added: list = []
    def _add(item):
        added.append(item)
    db.add = _add

    result = await find_or_enqueue_ondemand_sync(
        db,
        tenant_id=tenant,
        app_id="inside-sales",
        source_family="calls",
        date_from="2026-04-02 00:00:00",
        date_to="2026-04-09 00:00:00",
        user_id=user,
    )
    assert result is not scheduled
    assert len(added) == 1
    assert result.params["is_scheduled_run"] is False
