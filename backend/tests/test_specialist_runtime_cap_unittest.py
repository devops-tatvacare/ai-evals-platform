"""Runtime cap on submit_sql attempts must be enforced regardless of prompt behaviour.

The plan promises a per-turn cap of ``MAX_SPECIALIST_ATTEMPTS`` on
``data_specialist.submit_sql`` invocations so a misbehaving supervisor
LLM cannot loop forever. The supervisor prompt asks nicely; this test
confirms the runtime stops it.
"""
from __future__ import annotations

import json
import unittest
import uuid
from types import SimpleNamespace
from typing import Any

from app.services.sherlock_v3.data_specialist import _make_submit_sql_handler
from app.services.sherlock_v3.limits import MAX_SPECIALIST_ATTEMPTS


class _FakeEmitter:
    def __init__(self) -> None:
        self.emitted: list[Any] = []
        self.updated: list[Any] = []

    async def emit(self, part: Any) -> Any:
        self.emitted.append(part)
        return part

    async def update(self, part: Any) -> Any:
        self.updated.append(part)
        return part


def _build_ctx(*, attempts_so_far: int) -> tuple[SimpleNamespace, _FakeEmitter, dict]:
    emitter = _FakeEmitter()
    scratch: dict = {'_submit_sql_attempts': attempts_so_far}
    sherlock_ctx = SimpleNamespace(
        app_id='inside-sales',
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        chat_session_id=uuid.uuid4(),
        turn_id=uuid.uuid4(),
        auth=None,
        emitter=emitter,
        scratch=scratch,
    )
    tool_ctx = SimpleNamespace(context=sherlock_ctx, tool_call_id='call_cap_test')
    return tool_ctx, emitter, scratch


class SpecialistRuntimeCapTests(unittest.IsolatedAsyncioTestCase):
    async def test_attempt_beyond_cap_short_circuits_with_error_result(self) -> None:
        handler = _make_submit_sql_handler(grounding=None)
        tool_ctx, emitter, scratch = _build_ctx(attempts_so_far=MAX_SPECIALIST_ATTEMPTS)

        raw_result = await handler(tool_ctx, '{}')

        parsed = json.loads(raw_result)
        self.assertEqual(parsed['status'], 'error')
        self.assertIn(str(MAX_SPECIALIST_ATTEMPTS), parsed['summary'])
        self.assertEqual(scratch['_submit_sql_attempts'], MAX_SPECIALIST_ATTEMPTS + 1)

    async def test_attempt_beyond_cap_emits_error_part_with_source_data_specialist(self) -> None:
        handler = _make_submit_sql_handler(grounding=None)
        tool_ctx, emitter, _ = _build_ctx(attempts_so_far=MAX_SPECIALIST_ATTEMPTS)

        await handler(tool_ctx, '{}')

        error_parts = [p for p in emitter.emitted if getattr(p, 'type', None) == 'error']
        self.assertEqual(len(error_parts), 1, 'cap path must emit exactly one ErrorPart')
        self.assertEqual(error_parts[0].source, 'data_specialist')
        self.assertFalse(error_parts[0].recoverable)

    async def test_attempt_beyond_cap_stashes_attempt_for_supervisor_view(self) -> None:
        handler = _make_submit_sql_handler(grounding=None)
        tool_ctx, _, scratch = _build_ctx(attempts_so_far=MAX_SPECIALIST_ATTEMPTS)

        await handler(tool_ctx, '{}')

        stashed = scratch.get('_last_data_specialist_attempt')
        assert stashed is not None
        self.assertEqual(stashed.status, 'execution_error')
        self.assertIn(str(MAX_SPECIALIST_ATTEMPTS), stashed.error_message or '')


if __name__ == '__main__':
    unittest.main()
