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
from unittest.mock import AsyncMock, patch

from app.services.sherlock_v3.data_specialist import _make_submit_sql_handler
from app.services.sherlock_v3.manifest_projection import GroundingContext


def _grounding(question: str = 'Pass rate trend by week') -> GroundingContext:
    return GroundingContext(
        app_id='voice-rx',
        user_message=question,
        intent_class='aggregate',
        allowed_layers=frozenset({'analytics_aggregate', 'identity'}),
        projected_tables=('agg_evaluation_run',),
        projected_schema={'tables': {}, 'available_tables': ['agg_evaluation_run']},
        projected_role_hints=(),
        allowed_tables_hint=('agg_evaluation_run',),
        original_table_count=3,
        projected_table_count=1,
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
        with _LogCapture() as cap, \
             patch('app.services.chat_engine.sql_agent.validate_sql',
                   side_effect=__import__(
                       'app.services.chat_engine.sql_agent', fromlist=['SQLValidationError'],
                   ).SQLValidationError('not a SELECT')), \
             patch('app.services.chat_engine.sql_agent.load_app_config', new=AsyncMock(return_value=None)):
            result = await handler(_tool_ctx(), json.dumps({
                'sql': 'DROP TABLE foo;',
                'chart_title': 'attack',
                'output_columns': [],
            }))
        body = json.loads(result)
        self.assertEqual(body['status'], 'error')
        self.assertIn('routing', body['meta'])
        self.assertEqual(body['meta']['routing']['execution_status'], 'error')
        self.assertTrue(body['meta']['routing']['validation_result'].startswith('failed:'))
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
        self.assertEqual(body['meta']['routing']['validation_result'], 'empty_sql')
        self.assertEqual(len(cap.records), 1)

    async def test_telemetry_includes_grounding_block(self) -> None:
        # Verifies the grounding telemetry appears in the routing
        # payload — projected_tables + intent_class + allowed_layers.
        handler = _make_submit_sql_handler(_grounding())
        result = await handler(_tool_ctx(), json.dumps({
            'sql': '',
            'chart_title': '',
            'output_columns': [],
        }))
        routing = json.loads(result)['meta']['routing']
        self.assertIn('grounding', routing)
        self.assertEqual(routing['grounding']['intent_class'], 'aggregate')
        self.assertEqual(routing['grounding']['projected_tables'], ['agg_evaluation_run'])
        self.assertIn('analytics_aggregate', routing['grounding']['allowed_layers'])

    async def test_telemetry_when_grounding_is_none(self) -> None:
        # Legacy-callers / tests build the agent without grounding;
        # telemetry must still fire (without the grounding block) so
        # the audit can detect missing-projection runs.
        handler = _make_submit_sql_handler(None)
        result = await handler(_tool_ctx(), json.dumps({
            'sql': '',
            'chart_title': '',
            'output_columns': [],
        }))
        routing = json.loads(result)['meta']['routing']
        self.assertNotIn('grounding', routing)
        self.assertEqual(routing['execution_status'], 'error')


if __name__ == '__main__':
    unittest.main()
