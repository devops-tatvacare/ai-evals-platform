"""Tests for the ``recover_stale_source_sync_runs`` reconciler.

Kept separate from inside-sales sync tests because the reconciler is a
platform-level concern — it operates on any ``log_crm_source_sync`` row
regardless of which app populated it.

Uses in-memory fake sessions instead of an SQLite backend because the
real models carry ``JSONB`` columns that SQLite can't render.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _make_sync_run_row(
    *,
    status: str,
    started_at: datetime,
    job_id: uuid.UUID | None,
    error_message: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        status=status,
        started_at=started_at,
        completed_at=None,
        error_message=error_message,
        job_id=job_id,
    )


def _make_job(
    *,
    job_id: uuid.UUID,
    status: str,
    error_message: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(id=job_id, status=status, error_message=error_message)


class _FakeResult:
    def __init__(self, rows: list):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _FakeSession:
    """Minimal fake that feeds the reconciler's two SELECTs + BackgroundJob lookups."""

    def __init__(
        self,
        *,
        linked_terminal_rows: list,
        unlinked_stale_rows: list,
        jobs_by_id: dict[uuid.UUID, SimpleNamespace],
    ):
        self._linked_terminal_rows = linked_terminal_rows
        self._unlinked_stale_rows = unlinked_stale_rows
        self._jobs_by_id = jobs_by_id
        self._exec_calls = 0
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, _stmt):
        # The reconciler issues two SELECTs in order:
        #   1) linked-terminal
        #   2) unlinked-stale
        # We dispatch by call index; we don't parse the SQL AST here.
        self._exec_calls += 1
        if self._exec_calls == 1:
            return _FakeResult(self._linked_terminal_rows)
        return _FakeResult(self._unlinked_stale_rows)

    async def get(self, _model, job_id):
        return self._jobs_by_id.get(job_id)

    async def commit(self):
        self.commits += 1


class RecoverStaleSourceSyncRunsTests(IsolatedAsyncioTestCase):
    async def _run(
        self,
        *,
        linked_terminal_rows: list,
        unlinked_stale_rows: list,
        jobs_by_id: dict[uuid.UUID, SimpleNamespace],
        stale_minutes: int = 30,
    ) -> _FakeSession:
        session = _FakeSession(
            linked_terminal_rows=linked_terminal_rows,
            unlinked_stale_rows=unlinked_stale_rows,
            jobs_by_id=jobs_by_id,
        )
        from app.services import job_worker

        def _factory():
            return session

        with patch.object(job_worker, "async_session", _factory):
            await job_worker.recover_stale_source_sync_runs(stale_minutes=stale_minutes)
        return session

    async def test_linked_failed_job_marks_sync_run_failed_with_job_error(self):
        job_id = uuid.uuid4()
        job = _make_job(
            job_id=job_id,
            status="failed",
            error_message="A transaction is already begun on this Session.",
        )
        sync_row = _make_sync_run_row(
            status="running",
            started_at=_utc_now() - timedelta(minutes=1),
            job_id=job_id,
        )

        await self._run(
            linked_terminal_rows=[sync_row],
            unlinked_stale_rows=[],
            jobs_by_id={job_id: job},
        )

        self.assertEqual(sync_row.status, "failed")
        self.assertEqual(
            sync_row.error_message,
            "A transaction is already begun on this Session.",
        )
        self.assertIsNotNone(sync_row.completed_at)

    async def test_linked_cancelled_job_marks_sync_run_cancelled(self):
        job_id = uuid.uuid4()
        job = _make_job(job_id=job_id, status="cancelled", error_message=None)
        sync_row = _make_sync_run_row(
            status="running",
            started_at=_utc_now() - timedelta(minutes=1),
            job_id=job_id,
        )

        await self._run(
            linked_terminal_rows=[sync_row],
            unlinked_stale_rows=[],
            jobs_by_id={job_id: job},
        )

        self.assertEqual(sync_row.status, "cancelled")
        self.assertIsNotNone(sync_row.completed_at)

    async def test_linked_terminal_without_job_error_uses_fallback_message(self):
        job_id = uuid.uuid4()
        job = _make_job(job_id=job_id, status="failed", error_message=None)
        sync_row = _make_sync_run_row(
            status="running",
            started_at=_utc_now() - timedelta(minutes=1),
            job_id=job_id,
        )

        await self._run(
            linked_terminal_rows=[sync_row],
            unlinked_stale_rows=[],
            jobs_by_id={job_id: job},
        )

        self.assertEqual(sync_row.status, "failed")
        self.assertIn("Reconciled", sync_row.error_message or "")

    async def test_unlinked_old_row_marked_failed_with_age_message(self):
        sync_row = _make_sync_run_row(
            status="running",
            started_at=_utc_now() - timedelta(minutes=120),
            job_id=None,
        )

        await self._run(
            linked_terminal_rows=[],
            unlinked_stale_rows=[sync_row],
            jobs_by_id={},
            stale_minutes=30,
        )

        self.assertEqual(sync_row.status, "failed")
        self.assertIn("30 minutes", sync_row.error_message or "")
        self.assertIsNotNone(sync_row.completed_at)

    async def test_commit_is_skipped_when_nothing_to_reconcile(self):
        session = await self._run(
            linked_terminal_rows=[],
            unlinked_stale_rows=[],
            jobs_by_id={},
        )
        self.assertEqual(session.commits, 0)

    async def test_commit_runs_once_when_rows_were_reconciled(self):
        job_id = uuid.uuid4()
        job = _make_job(job_id=job_id, status="failed", error_message="boom")
        sync_row = _make_sync_run_row(
            status="running",
            started_at=_utc_now() - timedelta(minutes=1),
            job_id=job_id,
        )

        session = await self._run(
            linked_terminal_rows=[sync_row],
            unlinked_stale_rows=[],
            jobs_by_id={job_id: job},
        )
        self.assertEqual(session.commits, 1)
