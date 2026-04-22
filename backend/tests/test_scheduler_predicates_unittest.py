"""Predicate registry tests (eval_running + unknown-type + global fallback)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.models.scheduled_job import ScheduledJob
from app.services.scheduler import predicates as predicate_registry


class _FakeExecuteResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    """Captures the SQL compiled predicate produces — we assert behavior on the returned row."""

    def __init__(self, running_job_id=None):
        self.running_job_id = running_job_id
        self.executed: list[Any] = []

    async def execute(self, stmt):
        self.executed.append(stmt)
        return _FakeExecuteResult(self.running_job_id)


def _schedule() -> ScheduledJob:
    return ScheduledJob(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        job_type="sync-external-source",
        schedule_key="k",
        name="t",
        cron="* * * * *",
        params={},
        override={},
        enabled=True,
        current_cycle_attempts=0,
    )


@pytest.mark.asyncio
async def test_eval_running_tenant_app_scope_blocks_when_match():
    schedule = _schedule()
    session = _FakeSession(running_job_id=uuid.uuid4())
    ctx = predicate_registry.PredicateContext(
        tenant_id=schedule.tenant_id,
        app_id=schedule.app_id,
        schedule=schedule,
        now=datetime.now(timezone.utc),
        db=session,
    )
    result = await predicate_registry.eval_running(ctx, {"scope": "tenant_app"})
    assert result.blocked is True
    assert result.reason.startswith("eval_running:")


@pytest.mark.asyncio
async def test_eval_running_tenant_app_scope_clears_when_no_match():
    schedule = _schedule()
    session = _FakeSession(running_job_id=None)
    ctx = predicate_registry.PredicateContext(
        tenant_id=schedule.tenant_id,
        app_id=schedule.app_id,
        schedule=schedule,
        now=datetime.now(timezone.utc),
        db=session,
    )
    result = await predicate_registry.eval_running(ctx, {"scope": "tenant_app"})
    assert result.blocked is False
    assert result.reason == "clear"


@pytest.mark.asyncio
async def test_eval_running_global_scope_is_not_implemented_and_clears():
    schedule = _schedule()
    # Global scope must NOT actually query; we use a session that would blow up
    # if called, to prove the predicate short-circuits.
    session = AsyncMock()
    session.execute.side_effect = AssertionError("global scope should not query")
    ctx = predicate_registry.PredicateContext(
        tenant_id=schedule.tenant_id,
        app_id=schedule.app_id,
        schedule=schedule,
        now=datetime.now(timezone.utc),
        db=session,
    )
    result = await predicate_registry.eval_running(ctx, {"scope": "global"})
    assert result.blocked is False
    assert result.reason == "clear"


@pytest.mark.asyncio
async def test_evaluate_skip_criteria_unknown_predicate_type_is_logged_not_blocked():
    schedule = _schedule()
    session = _FakeSession()
    ctx = predicate_registry.PredicateContext(
        tenant_id=schedule.tenant_id,
        app_id=schedule.app_id,
        schedule=schedule,
        now=datetime.now(timezone.utc),
        db=session,
    )
    result = await predicate_registry.evaluate_skip_criteria(
        ctx,
        [{"type": "not_a_real_predicate"}],
    )
    assert result.blocked is False


@pytest.mark.asyncio
async def test_evaluate_skip_criteria_or_composition_first_block_wins():
    schedule = _schedule()
    session = _FakeSession(running_job_id=uuid.uuid4())
    ctx = predicate_registry.PredicateContext(
        tenant_id=schedule.tenant_id,
        app_id=schedule.app_id,
        schedule=schedule,
        now=datetime.now(timezone.utc),
        db=session,
    )
    result = await predicate_registry.evaluate_skip_criteria(
        ctx,
        [{"type": "eval_running", "scope": "tenant_app"}],
    )
    assert result.blocked is True


def test_get_registered_predicates_includes_eval_running():
    entries = predicate_registry.get_registered_predicates()
    ids = {entry["id"] for entry in entries}
    assert "eval_running" in ids
