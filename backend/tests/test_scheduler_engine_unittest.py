"""Scheduler engine unit tests (fake-session based, no live DB)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.models.job import Job
from app.models.scheduled_job import ScheduledJob
from app.services.scheduler import engine
from app.services.scheduler import predicates as predicate_registry


class _FakeScalarResult:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)


class _FakeResult:
    def __init__(self, items):
        self._items = list(items)

    def scalars(self):
        return _FakeScalarResult(self._items)


class _FakeSession:
    """Minimal async session: responds to the engine's single SELECT."""

    def __init__(self, due_schedules: list[ScheduledJob]):
        self._due = due_schedules
        self.added: list[Any] = []
        self.commits = 0
        self.flushes = 0

    async def execute(self, _stmt):
        return _FakeResult(self._due)

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flushes += 1

    async def commit(self):
        self.commits += 1


def _make_schedule(**overrides) -> ScheduledJob:
    base: dict[str, Any] = dict(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        job_type="sync-external-source",
        schedule_key="inside-sales-calls-sync",
        name="Inside Sales CRM sync",
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
    )
    base.update(overrides)
    schedule = ScheduledJob(**base)
    return schedule


@pytest.mark.asyncio
async def test_tick_fires_job_when_no_predicate_blocks():
    schedule = _make_schedule(override={"skip_criteria": []})
    session = _FakeSession([schedule])
    now = datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc)

    with patch.object(engine, "_resolve_platform_user_id", AsyncMock(return_value=uuid.uuid4())):
        fired = await engine.tick_once(session, now=now)

    assert len(fired) == 1
    assert schedule.last_fire_at == now
    assert schedule.last_fire_job_id is not None
    assert schedule.last_skip_reason is None
    assert schedule.current_cycle_attempts == 0
    assert schedule.current_cycle_started_at is None
    # Next check advances to the next cron boundary strictly after `now`.
    assert schedule.next_check_at is not None and schedule.next_check_at > now
    # One Job row was added.
    queued_job = next(item for item in session.added if isinstance(item, Job))
    assert queued_job.tenant_id == schedule.tenant_id
    assert queued_job.app_id == schedule.app_id
    assert queued_job.job_type == schedule.job_type
    assert queued_job.status == "queued"
    assert queued_job.scheduled_job_id == schedule.id
    # app_id is injected into params even if absent.
    assert queued_job.params["app_id"] == "inside-sales"
    assert session.commits == 1


@pytest.mark.asyncio
async def test_tick_backs_off_when_predicate_blocks():
    schedule = _make_schedule(
        override={
            "skip_criteria": [{"type": "eval_running"}],
            "retry_count": 2,
            "retry_interval_minutes": 5,
        }
    )
    session = _FakeSession([schedule])
    now = datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc)

    blocked = predicate_registry.PredicateResult(blocked=True, reason="eval_running:abc")
    with patch.object(
        predicate_registry, "evaluate_skip_criteria", AsyncMock(return_value=blocked)
    ):
        fired = await engine.tick_once(session, now=now)

    assert fired == []
    # No Job added, no last_fire.
    assert not any(isinstance(item, Job) for item in session.added)
    assert schedule.last_fire_at is None
    # Cycle state advances: attempt=1, started=now, next_check=+5m.
    assert schedule.current_cycle_attempts == 1
    assert schedule.current_cycle_started_at == now
    assert schedule.next_check_at == now + timedelta(minutes=5)
    assert schedule.last_skip_reason == "eval_running:abc"


@pytest.mark.asyncio
async def test_tick_exhausts_retries_and_waits_for_next_cron():
    schedule = _make_schedule(
        override={
            "skip_criteria": [{"type": "eval_running"}],
            "retry_count": 1,
            "retry_interval_minutes": 5,
        },
        current_cycle_attempts=1,  # 1 retry already spent
        current_cycle_started_at=datetime(2026, 4, 22, 11, 55, tzinfo=timezone.utc),
    )
    session = _FakeSession([schedule])
    now = datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc)

    blocked = predicate_registry.PredicateResult(blocked=True, reason="eval_running:xyz")
    with patch.object(
        predicate_registry, "evaluate_skip_criteria", AsyncMock(return_value=blocked)
    ):
        await engine.tick_once(session, now=now)

    # retry budget exhausted → cycle resets + waits for next cron boundary.
    assert schedule.current_cycle_attempts == 0
    assert schedule.current_cycle_started_at is None
    assert schedule.last_skip_reason is not None
    assert "skipped after 1 retries" in schedule.last_skip_reason
    # next_check_at pushed to the cron boundary strictly after now.
    assert schedule.next_check_at is not None and schedule.next_check_at > now


@pytest.mark.asyncio
async def test_fire_now_respects_predicates_by_default():
    schedule = _make_schedule(override={"skip_criteria": [{"type": "eval_running"}]})
    # fire_now runs outside the FOR UPDATE select — any session suffices.
    session = _FakeSession([])
    now = datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc)

    blocked = predicate_registry.PredicateResult(blocked=True, reason="eval_running:abc")
    with patch.object(
        predicate_registry, "evaluate_skip_criteria", AsyncMock(return_value=blocked)
    ):
        job, reason = await engine.fire_now(session, schedule, now=now)

    assert job is None
    assert reason == "eval_running:abc"
    assert schedule.last_skip_reason is not None
    assert session.commits == 1


def test_next_cron_tick_advances_strictly():
    now = datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc)
    nxt = engine.next_cron_tick("0 */6 * * *", now)
    assert nxt > now
    assert nxt.tzinfo is not None


def test_validate_cron_expression_rejects_garbage():
    with pytest.raises(ValueError):
        engine.validate_cron_expression("not a cron expression")
    with pytest.raises(ValueError):
        engine.validate_cron_expression("")


def test_validate_cron_expression_accepts_standard_forms():
    assert engine.validate_cron_expression("* * * * *") == "* * * * *"
    assert engine.validate_cron_expression("0 */6 * * *") == "0 */6 * * *"
