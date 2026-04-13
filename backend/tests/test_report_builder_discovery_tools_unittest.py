from __future__ import annotations

import os
import sys
import unittest
import uuid
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.auth import AuthContext
from app.services.report_builder import tool_handlers


class _Result:
    def __init__(self, *, rows=None, scalar_value=None, first_row=None):
        self._rows = rows or []
        self._scalar_value = scalar_value
        self._first_row = first_row

    def all(self):
        return list(self._rows)

    def scalar(self):
        return self._scalar_value

    def first(self):
        return self._first_row


class ReportBuilderDiscoveryToolTests(unittest.IsolatedAsyncioTestCase):
    def _auth(self) -> AuthContext:
        return AuthContext(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email='user@example.com',
            role_id=uuid.uuid4(),
            is_owner=True,
            permissions=frozenset(),
            app_access=frozenset({'inside-sales'}),
        )

    async def test_handle_discover_uses_session_cache(self):
        cached = {
            'status': 'ok',
            'app_id': 'inside-sales',
            'dimensions': [{'name': 'agent', 'values': []}],
            'metrics': [{'name': 'pass_rate', 'description': 'Pass rate'}],
            'time_range': {},
            'volume': {},
        }

        result = await tool_handlers.handle_discover(
            db=AsyncMock(),
            auth=self._auth(),
            app_id='inside-sales',
            session={'scratchpad': {'discovery': cached}},
        )

        self.assertEqual(result['app_id'], 'inside-sales')
        self.assertTrue(result['cache_hit'])

    async def test_handle_lookup_resolves_dimension_values(self):
        db = AsyncMock()
        db.execute.return_value = _Result(rows=[('Pareekshith Bompally', 12), ('Vicky Yadav', 9)])
        semantic_model = {
            'tables': {
                'analytics_eval_facts': {
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
            },
            'dimensions': [
                {
                    'name': 'agent',
                    'table': 'analytics_eval_facts',
                    'expression': "context->>'agent'",
                },
            ],
        }

        with patch(
            'app.services.report_builder.tool_handlers._load_active_semantic_model',
            new=AsyncMock(return_value=semantic_model),
        ):
            result = await tool_handlers.handle_lookup(
                dimension='agent',
                search='pareek',
                db=db,
                auth=self._auth(),
                app_id='inside-sales',
            )

        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['dimension'], 'agent')
        self.assertEqual(result['values'][0]['value'], 'Pareekshith Bompally')

    async def test_handle_discover_builds_dimension_metric_and_volume_payload(self):
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(rows=[('inbound', 7), ('outbound', 3)]),
            _Result(scalar_value=4),
            _Result(scalar_value=10),
            _Result(first_row=('2026-01-01', '2026-04-01')),
        ]
        semantic_model = {
            'tables': {
                'analytics_run_facts': {
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
                'analytics_eval_facts': {
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
            },
            'dimensions': [
                {
                    'name': 'direction',
                    'table': 'analytics_eval_facts',
                    'expression': "context->>'direction'",
                    'description': 'Inbound or outbound',
                },
            ],
            'metrics': {
                'pass_rate': {
                    'description': 'Pass rate',
                },
            },
        }

        with patch(
            'app.services.report_builder.tool_handlers._load_active_semantic_model',
            new=AsyncMock(return_value=semantic_model),
        ):
            result = await tool_handlers.handle_discover(
                db=db,
                auth=self._auth(),
                app_id='inside-sales',
                session={'scratchpad': {}},
            )

        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['dimensions'][0]['name'], 'direction')
        self.assertEqual(result['metrics'][0]['name'], 'pass_rate')
        self.assertEqual(result['volume']['runs'], 4)
        self.assertEqual(result['volume']['evaluations'], 10)
        self.assertEqual(result['time_range']['earliest'], '2026-01-01')


if __name__ == '__main__':
    unittest.main()
