import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

fake_database = ModuleType('app.database')
fake_database.async_session = None
sys.modules.setdefault('app.database', fake_database)

import app.services.job_worker as job_worker  # noqa: E402


class _FakeScalarResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _FakeSelectResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return _FakeScalarResult(self._items)


class _FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeSession:
    def __init__(self, items):
        self._items = items
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def begin(self):
        return _FakeTransaction()

    async def execute(self, _stmt):
        return _FakeSelectResult(self._items)

    async def commit(self):
        self.commits += 1


def _job(**overrides):
    defaults = {
        'id': uuid.uuid4(),
        'tenant_id': 'tenant-default',
        'user_id': 'user-default',
        'app_id': '',
        'job_type': 'generate-report',
        'status': 'queued',
        'priority': 10,
        'queue_class': 'interactive',
        'attempt_count': 0,
        'max_attempts': 1,
        'lease_owner': None,
        'lease_expires_at': None,
        'heartbeat_at': None,
        'started_at': None,
        'completed_at': None,
        'error_message': None,
        'last_error_at': None,
        'created_at': datetime(2026, 1, 1, tzinfo=timezone.utc),
        'params': {'app_id': 'voice-rx'},
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class JobWorkerMetadataTests(unittest.TestCase):
    def test_get_job_submission_metadata_uses_job_defaults(self):
        metadata = job_worker.get_job_submission_metadata('evaluate-batch', {})

        self.assertEqual(metadata['app_id'], 'kaira-bot')
        self.assertEqual(metadata['queue_class'], 'bulk')
        self.assertEqual(metadata['priority'], 200)
        self.assertEqual(metadata['max_attempts'], 3)

    def test_get_job_submission_metadata_validates_inputs(self):
        with self.assertRaisesRegex(ValueError, 'queue_class must be one of'):
            job_worker.get_job_submission_metadata('generate-report', {'queue_class': 'unknown'})

        with self.assertRaisesRegex(ValueError, 'priority must be between 0 and 1000'):
            job_worker.get_job_submission_metadata('generate-report', {'priority': -1})


class JobWorkerClaimTests(unittest.IsolatedAsyncioTestCase):
    async def test_claim_next_jobs_sets_running_lease_and_attempt(self):
        now = datetime(2026, 4, 3, 6, 0, tzinfo=timezone.utc)
        fake_job = _job(priority=100, queue_class='standard')
        fake_session = _FakeSession([fake_job])

        with patch.object(job_worker, 'async_session', return_value=fake_session):
            claimed = await job_worker.claim_next_jobs(1, now=now, worker_id='worker-test')

        self.assertEqual(claimed, [(str(fake_job.id), fake_job.job_type, fake_job.params)])
        self.assertEqual(fake_job.app_id, 'voice-rx')
        self.assertEqual(fake_job.status, 'running')
        self.assertEqual(fake_job.priority, 10)
        self.assertEqual(fake_job.queue_class, 'interactive')
        self.assertEqual(fake_job.started_at, now)
        self.assertEqual(fake_job.attempt_count, 1)
        self.assertEqual(fake_job.heartbeat_at, now)
        self.assertEqual(fake_job.lease_owner, 'worker-test')
        self.assertEqual(
            fake_job.lease_expires_at,
            now + timedelta(seconds=job_worker.settings.JOB_LEASE_SECONDS),
        )

    async def test_recover_stale_jobs_marks_expired_leases_failed(self):
        now = datetime(2026, 4, 3, 6, 0, tzinfo=timezone.utc)
        stale_job = _job(
            job_type='evaluate-batch',
            app_id='kaira-bot',
            params={'app_id': 'kaira-bot'},
            status='running',
            lease_owner='worker-a',
            lease_expires_at=now - timedelta(seconds=1),
            started_at=now - timedelta(minutes=1),
        )
        fake_session = _FakeSession([stale_job])

        with patch.object(job_worker, 'async_session', return_value=fake_session):
            await job_worker.recover_stale_jobs(now=now)

        self.assertEqual(stale_job.status, 'failed')
        self.assertEqual(stale_job.completed_at, now)
        self.assertEqual(stale_job.last_error_at, now)
        self.assertIsNone(stale_job.lease_owner)
        self.assertIsNone(stale_job.lease_expires_at)
        self.assertIn('worker lease expired', stale_job.error_message)
        self.assertEqual(fake_session.commits, 1)

    def test_select_jobs_for_claim_round_robins_across_apps(self):
        jobs = [
            _job(
                tenant_id='tenant-a',
                user_id='user-a1',
                app_id='voice-rx',
                created_at=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
            ),
            _job(
                tenant_id='tenant-a',
                user_id='user-a2',
                app_id='voice-rx',
                created_at=datetime(2026, 1, 1, 0, 1, tzinfo=timezone.utc),
            ),
            _job(
                tenant_id='tenant-b',
                user_id='user-b1',
                app_id='kaira-bot',
                created_at=datetime(2026, 1, 1, 0, 2, tzinfo=timezone.utc),
            ),
        ]

        selected = job_worker._select_jobs_for_claim(jobs, 3, job_worker._running_quota_counts([]))

        self.assertEqual(
            [(job.tenant_id, job.app_id, job.user_id) for job in selected],
            [
                ('tenant-a', 'voice-rx', 'user-a1'),
                ('tenant-b', 'kaira-bot', 'user-b1'),
                ('tenant-a', 'voice-rx', 'user-a2'),
            ],
        )

    def test_select_jobs_for_claim_respects_bulk_cap(self):
        jobs = [
            _job(
                tenant_id='tenant-a',
                user_id='user-a1',
                app_id='kaira-bot',
                job_type='evaluate-batch',
                queue_class='bulk',
                priority=200,
                params={'app_id': 'kaira-bot'},
            ),
            _job(
                tenant_id='tenant-b',
                user_id='user-b1',
                app_id='kaira-bot',
                job_type='evaluate-adversarial',
                queue_class='bulk',
                priority=220,
                params={'app_id': 'kaira-bot'},
            ),
            _job(
                tenant_id='tenant-c',
                user_id='user-c1',
                app_id='voice-rx',
                job_type='generate-report',
                queue_class='interactive',
                priority=10,
                params={'app_id': 'voice-rx'},
            ),
        ]

        counts = job_worker._running_quota_counts([])
        selected = job_worker._select_jobs_for_claim(jobs, 3, counts)

        self.assertEqual(len([job for job in selected if job.queue_class == 'bulk']), 2)
        self.assertEqual(len([job for job in selected if job.queue_class == 'interactive']), 1)

    def test_failure_transition_schedules_retry_for_retry_safe_jobs(self):
        now = datetime(2026, 4, 3, 6, 0, tzinfo=timezone.utc)
        job = _job(job_type='generate-report', attempt_count=1, max_attempts=3)

        transition = job_worker._failure_transition(job, TimeoutError('Request timed out'), now)

        self.assertEqual(transition['status'], 'retryable_failed')
        self.assertEqual(transition['event'], 'retry_scheduled')
        self.assertEqual(transition['retry_delay_seconds'], job_worker.settings.JOB_RETRY_BASE_DELAY_SECONDS)
        self.assertEqual(
            transition['next_retry_at'],
            now + timedelta(seconds=job_worker.settings.JOB_RETRY_BASE_DELAY_SECONDS),
        )

    def test_failure_transition_dead_letters_after_retry_budget(self):
        now = datetime(2026, 4, 3, 6, 0, tzinfo=timezone.utc)
        job = _job(job_type='generate-report', attempt_count=3, max_attempts=3)

        transition = job_worker._failure_transition(job, TimeoutError('Request timed out'), now)

        self.assertEqual(transition['status'], 'failed')
        self.assertEqual(transition['event'], 'dead_lettered')
        self.assertEqual(transition['dead_letter_reason'], 'retry_budget_exhausted')

    async def test_handle_generate_report_delegates_to_generic_report_generation(self):
        fake_result = {
            'report_run_id': str(uuid.uuid4()),
            'report_artifact_id': str(uuid.uuid4()),
            'run_id': 'run-123',
            'report_id': 'default-single-run',
            'duration_seconds': 1.2,
            'has_narrative': True,
        }

        with patch(
            'app.services.reports.report_generation_service.generate_single_run_report_artifact',
            new=unittest.mock.AsyncMock(return_value=fake_result),
        ), patch.object(
            job_worker,
            'update_job_progress',
            new=unittest.mock.AsyncMock(),
        ):
            result = await job_worker.handle_generate_report(
                'job-123',
                {
                    'run_id': 'run-123',
                    'app_id': 'inside-sales',
                    'report_id': 'default-single-run',
                    'visibility': 'shared',
                    'provider': 'openai',
                    'model': 'gpt-5.4',
                },
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )

        self.assertEqual(result['report_run_id'], fake_result['report_run_id'])
        self.assertEqual(result['report_artifact_id'], fake_result['report_artifact_id'])
        self.assertEqual(result['report_id'], 'default-single-run')


class JobWorkerHandlerTests(unittest.IsolatedAsyncioTestCase):
    async def test_batch_handler_forwards_selected_rule_ids(self):
        params = {
            'selected_rule_ids': ['rule-a', 'rule-b'],
        }

        with patch(
            'app.services.evaluators.batch_runner.run_batch_evaluation',
            return_value={'ok': True},
        ) as mock_runner:
            result = await job_worker.handle_evaluate_batch(
                'job-1',
                params,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )

        self.assertEqual(result, {'ok': True})
        self.assertEqual(
            mock_runner.await_args.kwargs['selected_rule_ids'],
            ['rule-a', 'rule-b'],
        )

    async def test_adversarial_handler_forwards_selected_traits_and_rules(self):
        params = {
            'selected_traits': ['trait-a'],
            'selected_rule_ids': ['rule-a', 'rule-b'],
            'selected_personas': ['easy', 'crack'],
            'persona_mixing_mode': 'mixed',
            'max_turns': 14,
        }

        with patch(
            'app.services.evaluators.adversarial_runner.run_adversarial_evaluation',
            return_value={'ok': True},
        ) as mock_runner:
            result = await job_worker.handle_evaluate_adversarial(
                'job-2',
                params,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )

        self.assertEqual(result, {'ok': True})
        self.assertEqual(
            mock_runner.await_args.kwargs['selected_traits'],
            ['trait-a'],
        )
        self.assertEqual(
            mock_runner.await_args.kwargs['selected_rule_ids'],
            ['rule-a', 'rule-b'],
        )
        self.assertEqual(
            mock_runner.await_args.kwargs['selected_personas'],
            ['easy', 'crack'],
        )
        self.assertEqual(
            mock_runner.await_args.kwargs['persona_mixing_mode'],
            'mixed',
        )
        self.assertEqual(
            mock_runner.await_args.kwargs['max_turns'],
            14,
        )
