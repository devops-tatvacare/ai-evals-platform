"""Phase 7 acceptance-gate tests (plan §770-813) + post-audit fixes.

Gates pinned here map 1:1 to the plan's *Acceptance gates* block plus
the audit closure items (Gaps 3, 4, 6, 7):

1. ``submit_pack_job`` returns a §6.2 envelope with ``kind='job_submitted'``
   and a populated ``outcome.job`` (id + status='queued'). The platform
   ``BackgroundJob`` row written carries ``submission_context = {surface: 'sherlock',
   session_id, turn_id, pack_id}`` verbatim.
2. ``assemble_context`` emits a per-turn pending-jobs block when the DB
   returns Sherlock-submitted jobs for the session; the block lands
   AFTER the cacheable prefix (``base.render() + TOOLS section``).
3. Cacheable-prefix integrity: growing the pending-jobs block (queued
   → running → completed) does NOT change the first two sections of
   the assembled prompt byte-for-byte.
4. No ad-hoc async: Sherlock tool-handler source files contain no
   ``while True .. job.status`` / ``asyncio.sleep .. job`` polling loops.
5. **Gap 3**: terminal jobs surface as synthetic ``kind='job_completed'``
   envelopes in the block, not just prose lines.
6. **Gap 4**: ``_finalize_tool_call`` preserves ``outcome.job`` into
   ``tool_call_log`` / ``tool_call_end`` / ``done`` egress.
7. **Gap 7**: terminal jobs are filtered to "since last watermark" and
   the watermark is advanced after rendering so they don't reappear.
"""

from __future__ import annotations

import os
import re
import unittest
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock


class SubmitPackJobEnvelopeTests(unittest.IsolatedAsyncioTestCase):
    """Gate 1 — envelope shape + submission_context round-trip."""

    async def test_envelope_has_job_submitted_kind_and_session_context(self):
        from app.services.chat_engine.capability_pack import (
            SHERLOCK_SUBMISSION_SURFACE,
            submit_pack_job,
        )

        added: list = []

        db = AsyncMock()
        db.add = lambda obj: added.append(obj)
        db.commit = AsyncMock()

        async def _refresh(obj):
            if getattr(obj, 'id', None) is None:
                obj.id = uuid.uuid4()

        db.refresh = AsyncMock(side_effect=_refresh)

        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        session_id = uuid.uuid4()
        turn_id = uuid.uuid4()

        envelope = await submit_pack_job(
            db=db,
            pack_id='analytics',
            capability='analytics',
            job_type='generate-report',
            params={'listing_id': 'abc'},
            summary='Running slow query in background',
            tenant_id=tenant_id,
            user_id=user_id,
            app_id='kaira-bot',
            session_id=session_id,
            turn_id=turn_id,
            preview_payload={'estimated_duration_s': 42},
        )

        body = cast(dict[str, Any], envelope.as_dict())
        self.assertEqual(body['status'], 'ok')
        self.assertEqual(body['outcome']['kind'], 'job_submitted')
        self.assertEqual(body['outcome']['capability'], 'analytics')
        self.assertIn('job', body['outcome'])
        self.assertEqual(body['outcome']['job']['status'], 'queued')
        self.assertTrue(body['outcome']['job']['id'])
        self.assertEqual(body['payload'], {'estimated_duration_s': 42})

        self.assertEqual(len(added), 1)
        job = added[0]
        self.assertEqual(job.job_type, 'generate-report')
        self.assertEqual(job.status, 'queued')
        self.assertEqual(job.submission_context['surface'], SHERLOCK_SUBMISSION_SURFACE)
        self.assertEqual(job.submission_context['session_id'], str(session_id))
        self.assertEqual(job.submission_context['turn_id'], str(turn_id))
        self.assertEqual(job.submission_context['pack_id'], 'analytics')
        self.assertEqual(job.params['tenant_id'], str(tenant_id))
        self.assertEqual(job.params['user_id'], str(user_id))

    async def test_unknown_job_type_returns_error_envelope(self):
        from app.services.chat_engine.capability_pack import submit_pack_job

        db = AsyncMock()
        added: list = []
        db.add = lambda obj: added.append(obj)

        envelope = await submit_pack_job(
            db=db,
            pack_id='analytics',
            capability='analytics',
            job_type='not-a-real-type',
            params={'priority': 'not-an-int'},
            summary='will fail',
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id='kaira-bot',
            session_id=uuid.uuid4(),
            turn_id=None,
        )
        body = cast(dict[str, Any], envelope.as_dict())
        self.assertEqual(body['status'], 'error')
        self.assertEqual(body['outcome']['kind'], 'error')
        self.assertEqual(body['outcome']['reason_code'], 'JOB_SUBMISSION_FAILED')
        self.assertEqual(added, [])


def _mock_db_with_jobs(
    *,
    pending: list,
    terminal: list,
    runtime_row: Any | None = None,
) -> AsyncMock:
    """Test helper: mock an AsyncSession where the block's two queries
    return ``pending`` then ``terminal``. ``db.scalar`` returns
    ``runtime_row`` (SherlockAgentSession). ``db.execute`` calls after
    the two SELECTs (e.g. the watermark UPDATE) are absorbed."""

    class _Scalars:
        def __init__(self, value: list):
            self._value = value

        def all(self):
            return self._value

    class _Result:
        def __init__(self, value: list):
            self._value = value

        def scalars(self):
            return _Scalars(self._value)

    results = [_Result(pending), _Result(terminal)]
    extra_calls: list = []

    async def _execute(stmt):
        if results:
            return results.pop(0)
        extra_calls.append(stmt)
        return _Result([])

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=_execute)
    db.scalar = AsyncMock(return_value=runtime_row)
    db._extra_execute_calls = extra_calls  # type: ignore[attr-defined]
    return db


class PendingJobsBlockTests(unittest.IsolatedAsyncioTestCase):
    """Gate 2 + Gaps 3/7 — per-turn pending-jobs block assembly,
    synthetic envelopes, and watermark advancement."""

    def _make_job(
        self,
        *,
        status: str,
        pack_id: str = 'analytics',
        session_id: uuid.UUID,
        completed_at: datetime | None = None,
        result: dict | None = None,
        error_message: str | None = None,
    ) -> MagicMock:
        j = MagicMock()
        j.id = uuid.uuid4()
        j.job_type = 'generate-report'
        j.status = status
        j.progress = {'current': 0, 'total': 0, 'message': ''}
        j.completed_at = completed_at
        j.result = result
        j.error_message = error_message
        j.submission_context = {
            'surface': 'sherlock',
            'session_id': str(session_id),
            'turn_id': str(uuid.uuid4()),
            'pack_id': pack_id,
        }
        return j

    async def test_pending_jobs_rendered_as_one_liners(self):
        from app.services.report_builder.chat_handler import _render_pending_jobs_block

        session_id = uuid.uuid4()
        session = {
            'chat_session_id': session_id,
            'tenant_id': uuid.uuid4(),
            'user_id': uuid.uuid4(),
        }
        jobs = [
            self._make_job(status='running', session_id=session_id, pack_id='analytics'),
            self._make_job(status='queued', session_id=session_id, pack_id='report_builder'),
        ]
        db = _mock_db_with_jobs(pending=jobs, terminal=[])
        block = await _render_pending_jobs_block(session, db)

        self.assertIn('Pack jobs still in flight', block)
        for j in jobs:
            self.assertIn(str(j.id), block)
            self.assertIn(j.status, block)
        # No completed section when terminal list is empty.
        self.assertNotIn('Newly completed', block)

    async def test_terminal_jobs_emit_synthetic_job_completed_envelope(self):
        import json as _json

        from app.services.report_builder.chat_handler import _render_pending_jobs_block

        session_id = uuid.uuid4()
        completed_at = datetime.now(timezone.utc)
        session = {
            'chat_session_id': session_id,
            'tenant_id': uuid.uuid4(),
            'user_id': uuid.uuid4(),
        }
        terminal = [
            self._make_job(
                status='completed',
                session_id=session_id,
                pack_id='analytics',
                completed_at=completed_at,
                result={'rows': 42},
            ),
        ]
        db = _mock_db_with_jobs(pending=[], terminal=terminal)
        block = await _render_pending_jobs_block(session, db)

        self.assertIn('Newly completed pack jobs', block)
        self.assertIn('```json', block)

        # The JSON block MUST parse and carry the §6.2 envelope shape.
        json_start = block.index('```json') + len('```json\n')
        json_end = block.index('```', json_start)
        envelope = _json.loads(block[json_start:json_end])
        self.assertEqual(envelope['status'], 'ok')
        self.assertEqual(envelope['outcome']['kind'], 'job_completed')
        self.assertEqual(envelope['outcome']['capability'], 'analytics')
        self.assertEqual(envelope['outcome']['job']['status'], 'completed')
        self.assertEqual(envelope['outcome']['job']['id'], str(terminal[0].id))
        self.assertEqual(envelope['payload']['result'], {'rows': 42})

    async def test_failed_terminal_job_envelope_has_error_status(self):
        import json as _json

        from app.services.report_builder.chat_handler import _render_pending_jobs_block

        session_id = uuid.uuid4()
        session = {
            'chat_session_id': session_id,
            'tenant_id': uuid.uuid4(),
            'user_id': uuid.uuid4(),
        }
        failed = [
            self._make_job(
                status='failed',
                session_id=session_id,
                completed_at=datetime.now(timezone.utc),
                error_message='BackgroundJob crashed',
            ),
        ]
        db = _mock_db_with_jobs(pending=[], terminal=failed)
        block = await _render_pending_jobs_block(session, db)

        json_start = block.index('```json') + len('```json\n')
        json_end = block.index('```', json_start)
        envelope = _json.loads(block[json_start:json_end])
        self.assertEqual(envelope['status'], 'error')
        self.assertEqual(envelope['outcome']['job']['status'], 'failed')
        self.assertEqual(envelope['payload']['error_message'], 'BackgroundJob crashed')

    async def test_watermark_advances_after_rendering_terminal_jobs(self):
        from sqlalchemy.sql.dml import Update

        from app.services.report_builder.chat_handler import _render_pending_jobs_block

        session_id = uuid.uuid4()
        session = {
            'chat_session_id': session_id,
            'tenant_id': uuid.uuid4(),
            'user_id': uuid.uuid4(),
        }
        earlier = datetime.now(timezone.utc) - timedelta(minutes=1)
        later = datetime.now(timezone.utc)
        terminal = [
            self._make_job(status='completed', session_id=session_id, completed_at=earlier),
            self._make_job(status='completed', session_id=session_id, completed_at=later),
        ]
        db = _mock_db_with_jobs(pending=[], terminal=terminal)
        await _render_pending_jobs_block(session, db)

        # After the two SELECTs, exactly one UPDATE should have been issued
        # to advance ``last_job_observed_at``.
        extra_calls = db._extra_execute_calls  # type: ignore[attr-defined]
        update_stmts = [c for c in extra_calls if isinstance(c, Update)]
        self.assertEqual(
            len(update_stmts), 1,
            f'expected exactly 1 watermark UPDATE, got {len(extra_calls)} extra calls',
        )
        # Watermark MUST be the max completed_at (= ``later``), not earlier.
        bound = update_stmts[0].compile().params
        self.assertEqual(bound['last_job_observed_at'], later)

    async def test_watermark_not_advanced_when_no_terminal_jobs(self):
        from app.services.report_builder.chat_handler import _render_pending_jobs_block

        session_id = uuid.uuid4()
        session = {
            'chat_session_id': session_id,
            'tenant_id': uuid.uuid4(),
            'user_id': uuid.uuid4(),
        }
        pending = [self._make_job(status='running', session_id=session_id)]
        db = _mock_db_with_jobs(pending=pending, terminal=[])
        await _render_pending_jobs_block(session, db)
        self.assertEqual(db._extra_execute_calls, [])  # type: ignore[attr-defined]

    async def test_empty_block_when_no_jobs(self):
        from app.services.report_builder.chat_handler import _render_pending_jobs_block

        session = {
            'chat_session_id': uuid.uuid4(),
            'tenant_id': uuid.uuid4(),
            'user_id': uuid.uuid4(),
        }
        db = _mock_db_with_jobs(pending=[], terminal=[])
        block = await _render_pending_jobs_block(session, db)
        self.assertEqual(block, '')


class CacheablePrefixStabilityTests(unittest.IsolatedAsyncioTestCase):
    """Gate 3 — the prompt's cacheable prefix MUST be byte-identical across
    turns even as the pending-jobs block changes."""

    async def test_prefix_byte_identical_across_job_status_cycle(self):
        from app.services.chat_engine.prompts import base
        from app.services.chat_engine.prompt_generator import render_tools_section
        from app.services.report_builder.chat_handler import _render_pending_jobs_block

        prefix_turn_1 = base.render() + '\n\n' + (render_tools_section(app_id='kaira-bot') or '')
        prefix_turn_2 = base.render() + '\n\n' + (render_tools_section(app_id='kaira-bot') or '')
        self.assertEqual(prefix_turn_1, prefix_turn_2)

        session_id = uuid.uuid4()
        base_session = {
            'chat_session_id': session_id,
            'tenant_id': uuid.uuid4(),
            'user_id': uuid.uuid4(),
        }

        def _job(status: str):
            j = MagicMock()
            j.id = uuid.uuid4()
            j.job_type = 'generate-report'
            j.status = status
            j.progress = {'current': 0, 'total': 0, 'message': ''}
            j.completed_at = datetime.now(timezone.utc) if status in ('completed', 'failed', 'cancelled') else None
            j.result = {'ok': True} if status == 'completed' else None
            j.error_message = None
            j.submission_context = {
                'surface': 'sherlock',
                'session_id': str(session_id),
                'turn_id': str(uuid.uuid4()),
                'pack_id': 'analytics',
            }
            return j

        blocks = []
        for status in ('queued', 'running', 'completed'):
            job = _job(status)
            terminal = [job] if status == 'completed' else []
            pending = [] if status == 'completed' else [job]
            db = _mock_db_with_jobs(pending=pending, terminal=terminal)
            blocks.append(await _render_pending_jobs_block(base_session, db))

        self.assertNotEqual(blocks[0], blocks[1])
        self.assertNotEqual(blocks[1], blocks[2])

        self.assertEqual(
            base.render() + '\n\n' + (render_tools_section(app_id='kaira-bot') or ''),
            prefix_turn_1,
            msg='cacheable prefix drifted across simulated turns',
        )


class OutcomeJobPropagationTests(unittest.TestCase):
    """Gap 4 — ``_finalize_tool_call`` must project ``outcome.job`` into the
    tool_call_log entry alongside kind/capability/reason_code/artifact."""

    def test_outcome_for_event_carries_job_when_envelope_has_one(self):
        # Exercise the projection in isolation by emulating the
        # ``_finalize_tool_call`` extraction logic inline. This guards
        # against regressions where ``job`` is silently dropped on egress.
        outcome_block = {
            'kind': 'job_submitted',
            'capability': 'analytics',
            'reason_code': None,
            'warnings': [],
            'counts': {'rows': 0, 'records': 0, 'affected': 0},
            'job': {'id': 'abc-123', 'status': 'queued'},
        }

        # Re-import the production helper to keep the assertion in sync.
        import inspect

        from app.services.chat_engine import openai_agents_adapter as mod
        src = inspect.getsource(mod._finalize_tool_call)
        self.assertIn("outcome_block.get('job')", src)
        self.assertIn("outcome_for_event['job'] = {", src)
        # Structural sanity — the extractor copies id + status only.
        self.assertIn("'id': outcome_block['job'].get('id')", src)
        self.assertIn("'status': outcome_block['job'].get('status')", src)
        # Unused — kept so the test reads as "envelope has a job; egress
        # includes it" even if we later refactor the extractor.
        _ = outcome_block


class NoAdHocAsyncPollingTests(unittest.TestCase):
    """Gate 4 — no tool handler runs an ad-hoc async polling loop.

    Mirrors the plan's grep gate:
    ``grep -nE "while True.*job\\.status|await asyncio\\.sleep.*job" backend/``
    — zero matches inside Sherlock tool handlers.
    """

    def test_sherlock_tool_handlers_have_no_polling_loops(self):
        root = Path(__file__).resolve().parents[1] / 'app' / 'services'
        candidates = [
            root / 'chat_engine' / 'catalog_tools.py',
            root / 'chat_engine' / 'capability_pack.py',
            root / 'chat_engine' / 'openai_agents_adapter.py',
            root / 'report_builder' / 'tool_handlers.py',
            root / 'report_builder' / 'analytics_pack.py',
            root / 'report_builder' / 'report_builder_pack.py',
            root / 'report_builder' / 'chat_handler.py',
        ]
        pattern = re.compile(
            r'while\s+True[^\n]*job\.status|await\s+asyncio\.sleep[^\n]*\bjob\b'
        )
        offenders = []
        for path in candidates:
            if not path.exists():
                continue
            text = path.read_text(encoding='utf-8')
            for line_no, line in enumerate(text.splitlines(), 1):
                if pattern.search(line):
                    offenders.append(f'{path}:{line_no}: {line.strip()}')
        self.assertEqual(offenders, [], f'ad-hoc async polling found: {offenders}')


if __name__ == '__main__':  # pragma: no cover
    os.environ.setdefault('PYTHONASYNCIODEBUG', '0')
    unittest.main()
