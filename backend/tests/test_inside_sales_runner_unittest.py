import os
import sys
import uuid
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

fake_database = ModuleType('app.database')
fake_database.async_session = lambda: None
sys.modules.setdefault('app.database', fake_database)

from app.services.evaluators import inside_sales_runner as runner  # noqa: E402


class _FakeSession:
    def __init__(self, *, scalar_results=None):
        self.scalar_results = list(scalar_results or [])
        self.added = []
        self.executed = []
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def scalar(self, _statement):
        if not self.scalar_results:
            return None
        return self.scalar_results.pop(0)

    async def execute(self, statement):
        self.executed.append(statement)
        return None

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.commits += 1


class _FakeAsyncSessionFactory:
    def __init__(self, sessions):
        self.sessions = list(sessions)

    def __call__(self):
        if not self.sessions:
            raise AssertionError("No fake sessions remaining")
        return self.sessions.pop(0)


class _FakeHttpResponse:
    content = b'audio-bytes'

    def raise_for_status(self):
        return None


class _FakeHttpClient:
    def __init__(self, *args, **kwargs):
        del args, kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, _url):
        return _FakeHttpResponse()


class _FakeLLM:
    def __init__(self, _provider, log_callback=None):
        self.log_callback = log_callback
        self.context = None

    def set_context(self, context, thread_id=None):
        self.context = (context, thread_id)

    def clone_for_thread(self, _thread_id):
        return self

    async def generate_with_audio(self, **_kwargs):
        return "transcript"

    async def generate_json(self, **_kwargs):
        return {"overall_score": 92}


async def _run_parallel_inline(*, items, worker, **_kwargs):
    results = []
    for index, item in enumerate(items):
        results.append(await worker(index, item))
    return results


class InsideSalesRunnerSnapshotTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_inside_sales_evaluation_persists_run_and_thread_source_snapshots(self):
        evaluator_id = str(uuid.uuid4())
        fake_evaluator = SimpleNamespace(
            id=uuid.uuid4(),
            name="Quality Rubric",
            prompt="{{transcript}}",
            output_schema={"type": "object"},
        )
        load_evaluators_session = _FakeSession(scalar_results=[fake_evaluator])
        update_run_session = _FakeSession()
        persist_thread_session = _FakeSession()
        fake_session_factory = _FakeAsyncSessionFactory([
            load_evaluators_session,
            _FakeSession(),
            update_run_session,
            persist_thread_session,
        ])

        create_eval_run = AsyncMock()
        finalize_eval_run = AsyncMock()
        update_job_progress = AsyncMock()

        with patch.object(runner, '_async_session', fake_session_factory), patch.object(
            runner, 'create_eval_run', create_eval_run
        ), patch.object(
            runner, 'finalize_eval_run', finalize_eval_run
        ), patch.object(
            runner, 'update_job_progress', update_job_progress
        ), patch.object(
            runner, 'get_llm_settings_from_db', new=AsyncMock(return_value={
                "provider": "gemini",
                "api_key": "test-key",
                "selected_model": "gemini-2.5-pro",
                "service_account_path": "",
            })
        ), patch.object(
            runner, 'create_llm_provider', return_value=object()
        ), patch.object(
            runner, 'LoggingLLMWrapper', _FakeLLM
        ), patch.object(
            runner, 'resolve_call_selection', new=AsyncMock(return_value=SimpleNamespace(
                records=[{
                    "activityId": "activity-1",
                    "prospectId": "prospect-1",
                    "agentName": "Agent Amy",
                    "direction": "inbound",
                    "status": "Answered",
                    "durationSeconds": 180,
                    "recordingUrl": "https://example.com/recording.mp3",
                    "createdOn": "2026-04-08 09:00:00",
                }],
                skipped_evaluated=0,
                skipped_no_recording=0,
            ))
        ), patch.object(
            runner, 'run_parallel', new=_run_parallel_inline
        ), patch.object(
            runner.httpx, 'AsyncClient', _FakeHttpClient
        ), patch(
            'app.services.lsq_client.fetch_lead_by_id',
            new=AsyncMock(return_value={"firstName": "Lead", "lastName": "One"}),
        ), patch.object(
            runner, 'generate_json_schema', return_value={}
        ), patch.object(
            runner, 'find_primary_field', return_value={"key": "overall_score"}
        ):
            result = await runner.run_inside_sales_evaluation(
                "job-1",
                {
                    "run_name": "Weekly Audit",
                    "run_description": "Calls from today",
                    "call_selection": {
                        "date_from": "2026-04-08 00:00:00",
                        "date_to": "2026-04-08 23:59:59",
                        "selection_mode": "specific",
                        "selected_call_ids": ["activity-1"],
                    },
                    "transcription_config": {"language": "auto"},
                    "evaluator_ids": [evaluator_id],
                    "llm_config": {"provider": "gemini", "model": "gemini-2.5-pro", "temperature": 0.1},
                    "parallel_workers": 1,
                },
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )

        self.assertEqual(result["status"], "completed")
        initial_config = create_eval_run.await_args.kwargs["config"]
        self.assertEqual(initial_config["requested_evaluator_ids"], [evaluator_id])
        self.assertEqual(initial_config["selected_call_snapshots"], [])

        final_config = finalize_eval_run.await_args.kwargs["config"]
        self.assertEqual(final_config["selected_call_ids"], ["activity-1"])
        self.assertEqual(final_config["selected_call_snapshots"][0]["activityId"], "activity-1")
        self.assertEqual(final_config["resolved_evaluators"][0]["name"], "Quality Rubric")

        self.assertEqual(len(update_run_session.executed), 1)
        self.assertEqual(len(persist_thread_session.added), 1)
        persisted_thread = persist_thread_session.added[0]
        self.assertEqual(persisted_thread.thread_id, "activity-1")
        self.assertEqual(
            persisted_thread.result["source_snapshot"]["recordingUrl"],
            "https://example.com/recording.mp3",
        )


if __name__ == '__main__':
    unittest.main()
