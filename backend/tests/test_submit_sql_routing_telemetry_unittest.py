"""Phase 1A — submit_sql emits routing telemetry on every attempt.

Plan §1.3 acceptance gate: telemetry MUST land for every ``submit_sql``
attempt — successful, empty result, validation failure, execution
error — because ``platform.sherlock_evidence`` only records successful,
row-producing executions, so the audit-set bar can't be measured from
evidence alone.

The handler is a closure over ``GroundingContext``. We invoke it
directly (no Agents-SDK runner) and inspect:

  1. The structured INFO line written to the
     ``sherlock_v3.routing`` logger.
  2. The ``meta.routing`` block on the SpecialistResult JSON returned
     to the supervisor.
"""
from __future__ import annotations

import json
import logging
import unittest
import uuid
from dataclasses import dataclass
from typing import Any

from app.services.sherlock_v3.data_specialist import _make_submit_sql_handler
from app.services.sherlock_v3.grounding import GroundingContext


def _grounding(question: str = 'Pass rate trend by week') -> GroundingContext:
    return GroundingContext(
        app_id='voice-rx',
        user_message=question,
    )


@dataclass
class _StubSherlockCtx:
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    app_id: str
    chat_session_id: uuid.UUID
    scratch: dict[str, Any]


@dataclass
class _StubToolCtx:
    context: _StubSherlockCtx


def _tool_ctx() -> _StubToolCtx:
    return _StubToolCtx(
        context=_StubSherlockCtx(
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id='voice-rx',
            chat_session_id=uuid.uuid4(),
            scratch={},
        ),
    )


class _LogCapture:
    """Cheap context manager so we can assert on routing-logger lines."""

    def __init__(self, logger_name: str = 'sherlock_v3.routing') -> None:
        self._logger = logging.getLogger(logger_name)
        self.records: list[logging.LogRecord] = []

    def __enter__(self) -> '_LogCapture':
        self._handler = logging.Handler()
        self._handler.emit = self.records.append  # type: ignore[method-assign]
        self._prior_level = self._logger.level
        self._logger.addHandler(self._handler)
        self._logger.setLevel(logging.INFO)
        return self

    def __exit__(self, *_exc: object) -> None:
        self._logger.removeHandler(self._handler)
        self._logger.setLevel(self._prior_level)


class TelemetryFiresOnEveryPathTests(unittest.IsolatedAsyncioTestCase):
    async def test_telemetry_on_validation_failure(self) -> None:
        handler = _make_submit_sql_handler(_grounding())
        with _LogCapture() as cap:
            result = await handler(_tool_ctx(), json.dumps({
                'sql': 'DROP TABLE foo;',
                'chart_title': 'attack',
                'output_columns': [],
            }))
        body = json.loads(result)
        self.assertEqual(body['status'], 'error')
        self.assertIn('routing', body['meta'])
        routing = body['meta']['routing']
        self.assertEqual(routing['execution_status'], 'bouncer_rejected_before')
        self.assertEqual(routing['bouncer']['rule_id'], 'R1.ddl_not_allowed')
        self.assertTrue(routing['validation_result'].startswith('bouncer_invalid:'))
        # Logger line landed too.
        self.assertEqual(len(cap.records), 1)
        self.assertIn('submit_sql', cap.records[0].getMessage())

    async def test_telemetry_on_empty_sql(self) -> None:
        handler = _make_submit_sql_handler(_grounding())
        with _LogCapture() as cap:
            result = await handler(_tool_ctx(), json.dumps({
                'sql': '',
                'chart_title': 'oops',
                'output_columns': [],
            }))
        body = json.loads(result)
        self.assertEqual(body['status'], 'error')
        routing = body['meta']['routing']
        self.assertEqual(routing['validation_result'], 'bouncer_invalid: R1.read_only')
        self.assertEqual(routing['bouncer']['rule_id'], 'R1.read_only')
        self.assertEqual(len(cap.records), 1)

    async def test_telemetry_on_malformed_tool_arguments(self) -> None:
        handler = _make_submit_sql_handler(_grounding())
        with _LogCapture() as cap:
            result = await handler(_tool_ctx(), '{bad-json')
        body = json.loads(result)
        self.assertEqual(body['status'], 'error')
        routing = body['meta']['routing']
        self.assertEqual(routing['validation_result'], 'tool_args_invalid')
        self.assertEqual(routing['execution_status'], 'error: JSONDecodeError')
        self.assertEqual(len(cap.records), 1)

    async def test_telemetry_includes_grounding_block(self) -> None:
        # Phase 4: grounding telemetry no longer carries projection /
        # intent fields (those legacy modules are gone). The block still ships verified-example
        # ids + instructions metadata so the chip can narrate the
        # specialist's grounding work.
        handler = _make_submit_sql_handler(_grounding())
        result = await handler(_tool_ctx(), json.dumps({
            'sql': '',
            'chart_title': '',
            'output_columns': [],
        }))
        routing = json.loads(result)['meta']['routing']
        self.assertIn('grounding', routing)
        # Phase 4 telemetry dict shape:
        self.assertIn('verified_example_ids', routing['grounding'])
        self.assertIn('instructions_present', routing['grounding'])
        self.assertIn('instructions_chars', routing['grounding'])
        # Dead fields must NOT leak back into telemetry:
        self.assertNotIn('intent_class', routing['grounding'])
        self.assertNotIn('projected_tables', routing['grounding'])
        self.assertNotIn('allowed_layers', routing['grounding'])

    async def test_telemetry_when_grounding_is_none(self) -> None:
        # Tests may build the handler without grounding; telemetry must
        # still fire without the grounding block.
        handler = _make_submit_sql_handler(None)
        result = await handler(_tool_ctx(), json.dumps({
            'sql': '',
            'chart_title': '',
            'output_columns': [],
        }))
        routing = json.loads(result)['meta']['routing']
        self.assertNotIn('grounding', routing)
        self.assertEqual(routing['execution_status'], 'bouncer_rejected_before')


if __name__ == '__main__':
    unittest.main()
