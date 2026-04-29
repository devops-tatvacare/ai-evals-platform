"""BackgroundJob dependency — cascade-fail + placeholder EvaluationRun cleanup.

Tests the `cascade_dependency_failures` helper directly with a fake async
session; the claim-path dependency gate is covered at the SQL level by the
engine tests.
"""

from __future__ import annotations

import sys
import uuid
from types import ModuleType
from typing import Any

import pytest

# Match the isolation pattern used by test_job_worker_unittest.py
fake_database = ModuleType("app.database")
fake_database.async_session = None
sys.modules.setdefault("app.database", fake_database)

import app.services.job_worker as job_worker  # noqa: E402
from app.models.eval_run import EvaluationRun  # noqa: E402
from app.models.job import BackgroundJob  # noqa: E402


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
    """Queue of `_FakeResult` objects to return from successive `execute()` calls."""

    def __init__(self, queued_results: list[_FakeResult]):
        self._queued = queued_results
        self.commits = 0

    async def execute(self, _stmt):
        return self._queued.pop(0) if self._queued else _FakeResult([])

    async def commit(self):
        self.commits += 1


def _job(**overrides) -> BackgroundJob:
    base: dict[str, Any] = dict(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        app_id="inside-sales",
        job_type="evaluate-inside-sales",
        status="queued",
        priority=100,
        queue_class="standard",
        attempt_count=0,
        max_attempts=1,
        params={},
        progress={"current": 0, "total": 1, "message": ""},
    )
    base.update(overrides)
    return BackgroundJob(**base)


def _eval_run(**overrides) -> EvaluationRun:
    base: dict[str, Any] = dict(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        app_id="inside-sales",
        eval_type="custom",
        status="pending",
        config={},
        summary={},
    )
    base.update(overrides)
    return EvaluationRun(**base)


@pytest.mark.asyncio
async def test_dependency_failure_cascades_dependent_to_failed_and_fails_pending_eval_run():
    parent = _job(status="failed")
    dependent = _job(
        status="queued",
        depends_on_job_id=parent.id,
        progress={"current": 0, "total": 1, "message": "waiting"},
    )
    eval_run = _eval_run(job_id=dependent.id, status="pending")

    session = _FakeSession([
        _FakeResult([dependent]),  # first SELECT → dependents
        _FakeResult([eval_run]),   # second SELECT → evaluation_runs for that dependent
    ])

    cascaded = await job_worker.cascade_dependency_failures(db=session)

    assert cascaded == 1
    assert dependent.status == "failed"
    assert dependent.error_message == "dependency_failed"
    assert dependent.completed_at is not None
    assert "dependency" in (dependent.progress or {}).get("message", "").lower()
    # Placeholder eval_run marked failed so the Runs UI doesn't strand in pending.
    assert eval_run.status == "failed"
    assert eval_run.error_message == "dependency_failed"
    assert session.commits == 1


@pytest.mark.asyncio
async def test_dependency_failure_handles_cancelled_parent_same_as_failed():
    parent = _job(status="cancelled")
    dependent = _job(status="retryable_failed", depends_on_job_id=parent.id)

    session = _FakeSession([
        _FakeResult([dependent]),
        _FakeResult([]),  # no evaluation_runs for this dependent
    ])

    cascaded = await job_worker.cascade_dependency_failures(db=session)
    assert cascaded == 1
    assert dependent.status == "failed"
    assert dependent.error_message == "dependency_failed"


@pytest.mark.asyncio
async def test_dependency_failure_no_dependents_is_noop():
    session = _FakeSession([_FakeResult([])])
    cascaded = await job_worker.cascade_dependency_failures(db=session)
    assert cascaded == 0
    # No commit because nothing transitioned.
    assert session.commits == 0


@pytest.mark.asyncio
async def test_dependency_failure_uses_progress_run_id_when_no_job_fk():
    """Legacy rows where EvaluationRun.job_id isn't set but progress.run_id is."""
    parent = _job(status="failed")
    run_id = uuid.uuid4()
    dependent = _job(
        status="queued",
        depends_on_job_id=parent.id,
        progress={"current": 0, "total": 1, "message": "queued", "run_id": str(run_id)},
    )
    legacy_eval_run = _eval_run(id=run_id, status="running", job_id=None)

    session = _FakeSession([
        _FakeResult([dependent]),
        _FakeResult([legacy_eval_run]),
    ])

    cascaded = await job_worker.cascade_dependency_failures(db=session)
    assert cascaded == 1
    assert legacy_eval_run.status == "failed"
    assert legacy_eval_run.error_message == "dependency_failed"


@pytest.mark.asyncio
async def test_dependency_failure_can_skip_commit_for_caller_transaction():
    parent = _job(status="failed")
    dependent = _job(status="queued", depends_on_job_id=parent.id)
    session = _FakeSession([
        _FakeResult([dependent]),
        _FakeResult([]),
    ])

    cascaded = await job_worker.cascade_dependency_failures(db=session, commit=False)

    assert cascaded == 1
    assert dependent.status == "failed"
    assert session.commits == 0
