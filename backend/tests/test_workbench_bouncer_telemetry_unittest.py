"""Phase 5 — bouncer telemetry reaches the SpecialistResult on every
``submit_sql`` call through the workbench pipeline.

These tests drive the workbench pipeline directly (no Agents-SDK
runner) and assert that the SpecialistResult JSON returned to the
supervisor carries the full set of bouncer fields the Logs page /
detail surface render: ``rule_id``, ``diagnostic``, ``declared_grain``,
``expected_row_bound``, ``more_rows_exist``, ``displayed_row_count``,
``limit_applied``.
"""
from __future__ import annotations

import json
import unittest
import uuid
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.sherlock_v3.data_specialist import _make_submit_sql_handler


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
            app_id='inside-sales',
            chat_session_id=uuid.uuid4(),
            scratch={},
        )
    )


def _args(**overrides: Any) -> str:
    payload: dict[str, Any] = {
        'sql': (
            'SELECT agent, AVG(result_score) AS avg_score '
            'FROM analytics.fact_evaluation '
            "WHERE tenant_id = :tenant_id AND app_id = :app_id "
            'GROUP BY agent'
        ),
        'declared_grain': ['agent'],
        'expected_row_bound': 'small',
        'chart_title': 'Avg score by agent',
        'output_columns': [
            {'alias': 'agent', 'role_hint': 'dimension', 'type_hint': 'nominal'},
            {'alias': 'avg_score', 'role_hint': 'measure', 'type_hint': 'quantitative'},
        ],
    }
    payload.update(overrides)
    return json.dumps(payload)


class BouncerTelemetryOnRejection(unittest.IsolatedAsyncioTestCase):
    """When the bouncer rejects pre-execution, the SpecialistResult must
    carry the rule_id + diagnostic, even though no rows were ever read.
    """

    async def test_pre_reject_dml_carries_rule_id(self) -> None:
        handler = _make_submit_sql_handler(None)
        # Hardcoded DML — bouncer R1 must reject it.
        out_str = await handler(
            _tool_ctx(),  # type: ignore[arg-type]
            _args(sql='DELETE FROM analytics.fact_evaluation'),
        )
        out = json.loads(out_str)
        routing = out.get('meta', {}).get('routing', {})
        self.assertIn('bouncer', routing)
        bouncer = routing['bouncer']
        self.assertEqual(bouncer.get('status'), 'invalid')
        self.assertTrue(str(bouncer.get('rule_id', '')).startswith('R1'))
        for required in (
            'rule_id',
            'diagnostic',
            'declared_grain',
            'expected_row_bound',
            'row_cap',
            'limit_applied',
        ):
            self.assertIn(required, bouncer, msg=f'missing telemetry field: {required}')

    async def test_empty_sql_routes_through_bouncer(self) -> None:
        handler = _make_submit_sql_handler(None)
        out_str = await handler(
            _tool_ctx(),  # type: ignore[arg-type]
            _args(sql=''),
        )
        out = json.loads(out_str)
        routing = out.get('meta', {}).get('routing', {})
        self.assertIn('bouncer', routing)
        bouncer = routing['bouncer']
        self.assertEqual(bouncer.get('status'), 'invalid')
        self.assertEqual(bouncer.get('rule_id'), 'R1.read_only')

    async def test_wrong_declared_join_columns_rejected_with_r3(self) -> None:
        handler = _make_submit_sql_handler(None)
        out_str = await handler(
            _tool_ctx(),  # type: ignore[arg-type]
            _args(sql=(
                'SELECT fe.agent, COUNT(*) AS n '
                'FROM analytics.fact_evaluation fe '
                'JOIN analytics.agg_evaluation_run ar ON ar.run_id = fe.item_id '
                'WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id '
                'AND ar.tenant_id = :tenant_id AND ar.app_id = :app_id '
                'GROUP BY fe.agent'
            )),
        )
        bouncer = json.loads(out_str)['meta']['routing']['bouncer']
        self.assertEqual(bouncer['status'], 'invalid')
        self.assertEqual(bouncer['rule_id'], 'R3.declared_join_columns')

    async def test_or_tenant_app_bypass_rejected_with_r7s(self) -> None:
        handler = _make_submit_sql_handler(None)
        out_str = await handler(
            _tool_ctx(),  # type: ignore[arg-type]
            _args(sql=(
                'SELECT agent FROM analytics.fact_evaluation '
                "WHERE (tenant_id = :tenant_id AND app_id = :app_id) OR agent = 'A'"
            )),
        )
        bouncer = json.loads(out_str)['meta']['routing']['bouncer']
        self.assertEqual(bouncer['status'], 'invalid')
        self.assertEqual(bouncer['rule_id'], 'R7s.tenant_app_scope')


class BouncerTelemetryOnExecutionSuccess(unittest.IsolatedAsyncioTestCase):
    """When the bouncer passes pre-check and rows return, the
    SpecialistResult must carry ``more_rows_exist`` / ``displayed_row_count``
    / ``limit_applied`` honestly.
    """

    async def test_unbounded_result_reports_more_rows_exist(self) -> None:
        # Stub execute_query to return rows beyond the row_cap so R11
        # propagates more_rows_exist.
        handler = _make_submit_sql_handler(None)
        # 'small' cap is 50; return 51 rows to trip R11.
        fake_rows = [
            {'agent': f'agent_{i}', 'avg_score': float(i)}
            for i in range(51)
        ]
        with patch(
            'app.services.chat_engine.sql_agent.execute_query',
            new=AsyncMock(return_value=fake_rows),
        ), patch(
            'app.services.chat_engine.sql_agent.prepare_query',
            return_value=(
                'SELECT agent, AVG(result_score) AS avg_score '
                'FROM analytics.fact_evaluation '
                "WHERE tenant_id = :tenant_id AND app_id = :app_id "
                'GROUP BY agent',
                {'tenant_id': 'x', 'app_id': 'inside-sales'},
            ),
        ), patch(
            'app.services.sherlock_v3.data_specialist._persist_sql_evidence',
            new=AsyncMock(return_value=[]),
        ):
            out_str = await handler(
                _tool_ctx(),  # type: ignore[arg-type]
                _args(),
            )
        out = json.loads(out_str)
        routing = out.get('meta', {}).get('routing', {})
        self.assertIn('bouncer', routing)
        bouncer = routing['bouncer']
        # The full set of bouncer fields the Logs / detail surfaces render:
        for required in (
            'declared_grain',
            'expected_row_bound',
            'more_rows_exist',
            'displayed_row_count',
            'limit_applied',
            'row_cap',
        ):
            self.assertIn(required, bouncer, msg=f'missing telemetry field: {required}')
        self.assertTrue(bouncer['more_rows_exist'])
        self.assertEqual(bouncer['displayed_row_count'], 50)

    async def test_derived_logical_column_expands_before_prepare(self) -> None:
        handler = _make_submit_sql_handler(None)
        captured_sql: list[str] = []

        def _prepare(sql: str, *_args: Any, **_kwargs: Any) -> tuple[str, dict[str, str]]:
            captured_sql.append(sql)
            return sql, {'tenant_id': 'x', 'app_id': 'inside-sales'}

        with patch(
            'app.services.chat_engine.sql_agent.execute_query',
            new=AsyncMock(return_value=[{'agent': 'A', 'avg_opening': 7.5}]),
        ), patch(
            'app.services.chat_engine.sql_agent.prepare_query',
            side_effect=_prepare,
        ), patch(
            'app.services.sherlock_v3.data_specialist._persist_sql_evidence',
            new=AsyncMock(return_value=[]),
        ):
            out_str = await handler(
                _tool_ctx(),  # type: ignore[arg-type]
                _args(
                    sql=(
                        'SELECT agent, AVG(call_opening_score) AS avg_opening '
                        'FROM analytics.fact_evaluation '
                        'WHERE tenant_id = :tenant_id AND app_id = :app_id '
                        'GROUP BY agent'
                    ),
                    output_columns=[
                        {'alias': 'agent', 'role_hint': 'dimension', 'type_hint': 'nominal'},
                        {'alias': 'avg_opening', 'role_hint': 'measure', 'type_hint': 'quantitative'},
                    ],
                ),
            )

        self.assertEqual(json.loads(out_str)['status'], 'ok')
        self.assertEqual(len(captured_sql), 1)
        self.assertIn('result_detail', captured_sql[0])
        self.assertIn('call_opening', captured_sql[0])
        self.assertNotIn('call_opening_score', captured_sql[0])


if __name__ == '__main__':
    unittest.main()
