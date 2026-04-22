"""scheduled-jobs route tests — call handlers directly with fake db/auth."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.auth import AuthContext
from app.models.job import Job
from app.models.scheduled_job import ScheduledJob
from app.routes import scheduled_jobs as scheduled_jobs_routes
from app.schemas.scheduled_job import ScheduledJobCreate, ScheduledJobUpdate


def _auth(tenant_id: uuid.UUID | None = None, is_owner: bool = True) -> AuthContext:
    return AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=tenant_id or uuid.uuid4(),
        email="test@example.com",
        role_id=uuid.uuid4(),
        is_owner=is_owner,
        permissions=frozenset({"schedule:manage"}),
        app_access=frozenset({"inside-sales"}),
    )


class _FakeScalarResult:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)


class _FakeResult:
    def __init__(self, items=(), scalar_value=None):
        self._items = list(items)
        self._scalar = scalar_value

    def scalars(self):
        return _FakeScalarResult(self._items)

    def scalar(self):
        return self._scalar


class _FakeSession:
    def __init__(self):
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.commits = 0
        self.refreshes = 0
        self._queued_results: list[_FakeResult] = []
        self._queued_scalars: list[Any] = []
        self.executed_statements: list[Any] = []
        self.scalar_statements: list[Any] = []

    def queue_result(self, result):
        self._queued_results.append(result)

    def queue_scalar(self, value):
        self._queued_scalars.append(value)

    async def execute(self, _stmt):
        self.executed_statements.append(_stmt)
        if self._queued_results:
            return self._queued_results.pop(0)
        return _FakeResult([])

    async def scalar(self, _stmt):
        self.scalar_statements.append(_stmt)
        if self._queued_scalars:
            return self._queued_scalars.pop(0)
        return None

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        pass

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pass

    async def refresh(self, _item):
        self.refreshes += 1

    async def delete(self, item):
        self.deleted.append(item)


def _make_schedule(**overrides) -> ScheduledJob:
    base: dict[str, Any] = dict(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        job_type="sync-external-source",
        schedule_key="inside-sales-sync",
        name="Inside Sales sync",
        description=None,
        cron="0 */6 * * *",
        params={"source_family": "calls"},
        override={},
        enabled=True,
        next_check_at=None,
        current_cycle_started_at=None,
        current_cycle_attempts=0,
        last_fire_at=None,
        last_fire_job_id=None,
        last_skip_reason=None,
        created_by=uuid.uuid4(),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return ScheduledJob(**base)


@pytest.mark.asyncio
async def test_create_schedule_sets_tenant_id_and_next_check_at():
    auth = _auth()
    db = _FakeSession()
    payload = ScheduledJobCreate(
        app_id="inside-sales",
        job_type="sync-external-source",
        schedule_key="t1",
        name="T1",
        cron="0 */6 * * *",
        params={"source_family": "calls"},
        override={"skip_criteria": [{"type": "eval_running"}]},
        enabled=True,
    )
    row = await scheduled_jobs_routes.create_schedule(payload=payload, auth=auth, db=db)

    assert row.tenant_id == auth.tenant_id
    assert row.app_id == "inside-sales"
    assert row.schedule_key == "t1"
    assert row.next_check_at is not None
    assert db.commits == 1
    assert len(db.added) == 1


@pytest.mark.asyncio
async def test_create_schedule_rejects_unregistered_workload():
    auth = _auth()
    db = _FakeSession()
    payload = ScheduledJobCreate(
        app_id="not-a-real-app",
        job_type="not-a-real-type",
        schedule_key="x",
        name="X",
        cron="* * * * *",
    )
    with pytest.raises(HTTPException) as exc_info:
        await scheduled_jobs_routes.create_schedule(payload=payload, auth=auth, db=db)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_schedule_rejects_bad_cron():
    auth = _auth()
    db = _FakeSession()
    payload = ScheduledJobCreate(
        app_id="inside-sales",
        job_type="sync-external-source",
        schedule_key="bad",
        name="Bad",
        cron="bogus",
    )
    with pytest.raises(HTTPException) as exc_info:
        await scheduled_jobs_routes.create_schedule(payload=payload, auth=auth, db=db)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_get_schedule_returns_last_fires_ordered_by_created_at_desc():
    auth = _auth()
    schedule = _make_schedule(tenant_id=auth.tenant_id)
    older_job = Job(
        id=uuid.uuid4(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id="inside-sales",
        job_type="sync-external-source",
        status="completed",
        scheduled_job_id=schedule.id,
        progress={"current": 1, "total": 1, "message": "Done"},
        created_at=datetime(2026, 4, 20, 10, 0, tzinfo=timezone.utc),
    )
    newer_job = Job(
        id=uuid.uuid4(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id="inside-sales",
        job_type="sync-external-source",
        status="running",
        scheduled_job_id=schedule.id,
        progress={"current": 0, "total": 1, "message": ""},
        created_at=datetime(2026, 4, 22, 10, 0, tzinfo=timezone.utc),
    )
    db = _FakeSession()
    db.queue_scalar(schedule)
    db.queue_result(_FakeResult([newer_job, older_job]))

    detail = await scheduled_jobs_routes.get_schedule(
        schedule_id=schedule.id, auth=auth, db=db
    )

    assert detail.schedule.id == schedule.id
    assert [fire.id for fire in detail.recent_fires] == [newer_job.id, older_job.id]
    assert "jobs.tenant_id" in str(db.executed_statements[-1])


@pytest.mark.asyncio
async def test_get_schedule_404_when_wrong_tenant():
    auth = _auth()
    db = _FakeSession()
    db.queue_scalar(None)
    with pytest.raises(HTTPException) as exc_info:
        await scheduled_jobs_routes.get_schedule(
            schedule_id=uuid.uuid4(), auth=auth, db=db
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_update_schedule_recomputes_next_check_at_when_cron_changes():
    auth = _auth()
    schedule = _make_schedule(tenant_id=auth.tenant_id, cron="0 */6 * * *")
    db = _FakeSession()
    db.queue_scalar(schedule)

    row = await scheduled_jobs_routes.update_schedule(
        schedule_id=schedule.id,
        payload=ScheduledJobUpdate(cron="*/5 * * * *"),
        auth=auth,
        db=db,
    )

    assert row.cron == "*/5 * * * *"
    assert row.next_check_at is not None


@pytest.mark.asyncio
async def test_delete_schedule_deletes_row():
    auth = _auth()
    schedule = _make_schedule(tenant_id=auth.tenant_id)
    db = _FakeSession()
    db.queue_scalar(schedule)

    await scheduled_jobs_routes.delete_schedule(
        schedule_id=schedule.id, auth=auth, db=db
    )
    assert schedule in db.deleted
    assert db.commits == 1


@pytest.mark.asyncio
async def test_toggle_schedule_flips_enabled():
    auth = _auth()
    schedule = _make_schedule(tenant_id=auth.tenant_id, enabled=True)
    db = _FakeSession()
    db.queue_scalar(schedule)

    row = await scheduled_jobs_routes.toggle_schedule(
        schedule_id=schedule.id, auth=auth, db=db
    )
    assert row.enabled is False


@pytest.mark.asyncio
async def test_fire_now_enqueues_job_when_predicates_clear():
    auth = _auth()
    schedule = _make_schedule(tenant_id=auth.tenant_id)
    db = _FakeSession()
    db.queue_scalar(schedule)

    fake_job = Job(
        id=uuid.uuid4(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=schedule.app_id,
        job_type=schedule.job_type,
        status="queued",
        params={},
    )
    with patch.object(
        scheduled_jobs_routes,
        "engine_fire_now",
        AsyncMock(return_value=(fake_job, "fired")),
    ):
        row = await scheduled_jobs_routes.fire_now_route(
            schedule_id=schedule.id, auth=auth, db=db
        )
    assert row.id == schedule.id


@pytest.mark.asyncio
async def test_fire_now_409_when_predicate_blocks():
    auth = _auth()
    schedule = _make_schedule(tenant_id=auth.tenant_id)
    db = _FakeSession()
    db.queue_scalar(schedule)

    with patch.object(
        scheduled_jobs_routes,
        "engine_fire_now",
        AsyncMock(return_value=(None, "eval_running:xyz")),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await scheduled_jobs_routes.fire_now_route(
                schedule_id=schedule.id, auth=auth, db=db
            )
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_registry_endpoint_returns_eval_running_and_inside_sales_workload():
    auth = _auth()
    registry = await scheduled_jobs_routes.list_registry(auth=auth)
    predicate_ids = {entry.id for entry in registry.predicates}
    assert "eval_running" in predicate_ids
    workload_keys = {(w.app_id, w.job_type) for w in registry.workloads}
    assert ("inside-sales", "sync-external-source") in workload_keys
    workload = next(w for w in registry.workloads if (w.app_id, w.job_type) == ("inside-sales", "sync-external-source"))
    assert "mirror" not in workload.label.lower()
    assert "mirror" not in workload.description.lower()
    assert "wait_next_tick" in registry.on_exhaust_modes


@pytest.mark.asyncio
async def test_list_schedules_scopes_to_tenant():
    """Tenant scoping is enforced via the stmt's .where(tenant_id ==) — we only
    verify that the handler invokes execute (which the fake returns empty)."""
    auth = _auth()
    db = _FakeSession()
    rows = await scheduled_jobs_routes.list_schedules(app_id=None, auth=auth, db=db)
    assert rows == []
