"""Verify data_specialist emits typed ToolPart + returns SpecialistResult JSON across success/error paths."""
from __future__ import annotations

import unittest
from typing import Any

from app.services.sherlock_v3.contracts import (
    Attempt,
    SpecialistResult,
    ToolStateCompleted,
    ToolStateError,
    ToolStatePending,
    Verdict,
)
from app.services.sherlock_v3.data_specialist import (
    _emit_tool_part_pending,
    _finalize_tool_part_completed,
    _finalize_tool_part_error,
    _invalid_arg_verdict,
    _result_json_from_attempt,
)


class _FakeEmitter:
    def __init__(self) -> None:
        self.emitted: list[Any] = []
        self.updated: list[Any] = []

    async def emit(self, part):  # noqa: D401
        self.emitted.append(part)
        return part

    async def update(self, part):
        self.updated.append(part)
        return part


class ToolPartLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_pending_emit_carries_raw_args_and_call_id(self) -> None:
        emitter = _FakeEmitter()
        part = await _emit_tool_part_pending(
            emitter=emitter,
            call_id='call_test123',
            started=1.0,
            raw_args='{"sql":"SELECT 1"}',
            parsed_args={'sql': 'SELECT 1'},
        )
        self.assertIsNotNone(part)
        assert part is not None
        self.assertEqual(part.call_id, 'call_test123')
        self.assertEqual(part.tool, 'submit_sql')
        self.assertIsInstance(part.state, ToolStatePending)
        self.assertEqual(part.state.input, {'sql': 'SELECT 1'})
        self.assertEqual(len(emitter.emitted), 1)
        self.assertEqual(emitter.emitted[0].call_id, 'call_test123')

    async def test_completed_transition_carries_metadata(self) -> None:
        emitter = _FakeEmitter()
        pending = await _emit_tool_part_pending(
            emitter=emitter, call_id='call_x', started=1.0,
            raw_args='{}', parsed_args={},
        )
        await _finalize_tool_part_completed(
            emitter=emitter, tool_part=pending, started=1.0,
            title='top 10', output='chart: 10 rows', metadata={'row_count': 10},
        )
        self.assertEqual(len(emitter.updated), 1)
        updated = emitter.updated[0]
        self.assertIsInstance(updated.state, ToolStateCompleted)
        self.assertEqual(updated.state.metadata['row_count'], 10)
        self.assertEqual(updated.state.output, 'chart: 10 rows')

    async def test_error_transition_carries_message(self) -> None:
        emitter = _FakeEmitter()
        pending = await _emit_tool_part_pending(
            emitter=emitter, call_id='call_y', started=1.0,
            raw_args='{}', parsed_args={},
        )
        await _finalize_tool_part_error(
            emitter=emitter, tool_part=pending, started=1.0,
            error_message='Rule 4 — Allowed columns: ...',
        )
        self.assertEqual(len(emitter.updated), 1)
        errored = emitter.updated[0]
        self.assertIsInstance(errored.state, ToolStateError)
        self.assertTrue(errored.state.error.startswith('Rule 4'))

    async def test_emitter_none_is_noop(self) -> None:
        self.assertIsNone(
            await _emit_tool_part_pending(
                emitter=None, call_id='call_x', started=1.0,
                raw_args='{}', parsed_args={},
            ),
        )
        await _finalize_tool_part_completed(
            emitter=None, tool_part=None, started=1.0,
            title='t', output='o', metadata={},
        )
        await _finalize_tool_part_error(
            emitter=None, tool_part=None, started=1.0,
            error_message='ignored',
        )


class SpecialistResultJsonTests(unittest.TestCase):
    def test_result_json_round_trips_through_specialist_result(self) -> None:
        attempt = Attempt(
            sql='SELECT 1',
            verdict=_invalid_arg_verdict(),
            status='tool_args_invalid',
            error_message='bad input',
        )
        out = _result_json_from_attempt(
            attempt=attempt, app_id='inside-sales', started=1.0, summary='bad input',
        )
        parsed = SpecialistResult.model_validate_json(out)
        self.assertEqual(parsed.status, 'error')
        self.assertEqual(parsed.kind, 'data')
        self.assertEqual(len(parsed.attempts), 1)
        self.assertEqual(parsed.attempts[0].status, 'tool_args_invalid')
        self.assertEqual(parsed.attempts[0].error_message, 'bad input')

    def test_invalid_arg_verdict_is_pydantic_verdict(self) -> None:
        verdict = _invalid_arg_verdict()
        self.assertIsInstance(verdict, Verdict)
        self.assertEqual(verdict.status, 'invalid')
        diag = verdict.diagnostic
        self.assertIsNotNone(diag)
        assert diag is not None
        self.assertEqual(diag.rule_id, 'ARG')
        self.assertEqual(diag.rule_number, 0)


if __name__ == '__main__':
    unittest.main()
