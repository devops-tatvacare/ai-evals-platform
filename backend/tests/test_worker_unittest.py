import sys
from contextlib import asynccontextmanager
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch


@asynccontextmanager
async def _fake_session():
    yield MagicMock()


def _fake_session_factory():
    return _fake_session()


@asynccontextmanager
async def _fake_engine_begin():
    """Fake engine.begin() — yields a connection whose execute returns
    a fake result with a single ``version_num`` row, for the alembic-head
    diagnostic log added in Phase 6 of the Alembic adoption."""
    fake_conn = MagicMock()
    fake_conn.execute = AsyncMock(
        return_value=SimpleNamespace(first=lambda: ('0001_baseline_prod',)),
    )
    yield fake_conn


fake_database = ModuleType('app.database')
fake_database.async_session = _fake_session_factory
fake_database.engine = SimpleNamespace(
    dispose=AsyncMock(),
    begin=_fake_engine_begin,
)
sys.modules['app.database'] = fake_database

import app.worker as worker_entry  # noqa: E402


class WorkerStartupTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_worker_validates_manifest_before_recovery(self):
        # Phase 6 removed bootstrap_database_schema(); Alembic owns DDL via
        # entrypoint.sh's `alembic upgrade head`. Worker boot now goes
        # straight from config validation to manifest validation, then
        # recovery loops.
        calls: list[str] = []

        async def fake_validate_manifests(_db):
            calls.append('validate_manifests')

        async def fake_recover_stale_jobs():
            calls.append('recover_jobs')

        async def fake_recover_stale_eval_runs():
            calls.append('recover_runs')

        async def fake_recover_stale_source_sync_runs():
            calls.append('recover_source_sync_runs')

        async def fake_recover_stale_workflow_runs():
            calls.append('recover_workflow_runs')

        async def fake_worker_loop():
            calls.append('worker_loop')

        async def fake_recovery_loop():
            calls.append('recovery_loop')

        with (
            patch('app.services.chat_engine.manifest_validator.run_manifest_validator', side_effect=fake_validate_manifests),
            patch.object(worker_entry, 'recover_stale_jobs', side_effect=fake_recover_stale_jobs),
            patch.object(worker_entry, 'recover_stale_eval_runs', side_effect=fake_recover_stale_eval_runs),
            patch.object(worker_entry, 'recover_stale_source_sync_runs', side_effect=fake_recover_stale_source_sync_runs),
            patch.object(worker_entry, 'recover_stale_workflow_runs', side_effect=fake_recover_stale_workflow_runs),
            patch.object(worker_entry, 'worker_loop', side_effect=fake_worker_loop),
            patch.object(worker_entry, 'recovery_loop', side_effect=fake_recovery_loop),
            patch.object(worker_entry.settings, 'SCHEDULER_TICK_INTERVAL_SECONDS', 0),
            patch.object(worker_entry.engine, 'dispose', new=AsyncMock()),
        ):
            await worker_entry.run_worker()

        self.assertEqual(calls[0], 'validate_manifests')
        self.assertLess(calls.index('validate_manifests'), calls.index('recover_jobs'))
        self.assertIn('recover_jobs', calls)
        self.assertIn('recover_runs', calls)
        self.assertIn('recover_source_sync_runs', calls)
        self.assertIn('recover_workflow_runs', calls)
        self.assertIn('worker_loop', calls)
        self.assertIn('recovery_loop', calls)
