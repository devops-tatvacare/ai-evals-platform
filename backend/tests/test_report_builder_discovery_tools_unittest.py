from __future__ import annotations

import unittest
import uuid
from unittest.mock import AsyncMock, patch

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

        # Phase 2: envelope shape — cached body sits under ``envelope.payload``.
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['payload']['app_id'], 'inside-sales')
        self.assertTrue(result['payload']['cache_hit'])

    async def test_handle_lookup_resolves_dimension_values(self):
        db = AsyncMock()
        db.execute.return_value = _Result(rows=[('Pareekshith Bompally', 12), ('Vicky Yadav', 9)])
        semantic_model = {
            'tables': {
                'fact_evaluation': {
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
            },
            'dimensions': [
                {
                    'name': 'agent',
                    'table': 'fact_evaluation',
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
        self.assertEqual(result['payload']['dimension'], 'agent')
        self.assertEqual(result['payload']['values'][0]['value'], 'Pareekshith Bompally')

    async def test_handle_lookup_accepts_none_search(self):
        db = AsyncMock()
        db.execute.return_value = _Result(rows=[('Pareekshith Bompally', 12)])
        semantic_model = {
            'tables': {
                'fact_evaluation': {
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
            },
            'dimensions': [
                {
                    'name': 'agent',
                    'table': 'fact_evaluation',
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
                search=None,
                db=db,
                auth=self._auth(),
                app_id='inside-sales',
            )

        self.assertEqual(result['status'], 'ok')
        self.assertIsNone(result['payload']['search'])

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
                'agg_evaluation_run': {
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
                'fact_evaluation': {
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
            },
            'dimensions': [
                {
                    'name': 'direction',
                    'table': 'fact_evaluation',
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

        # M2: resolver config now travels on the bundle attached to the
        # working session; ``handle_discover`` projects the bundle's
        # resolver entity_types into its discovery payload.
        import uuid as _uuid

        from app.services.sherlock.bundle_types import (
            ResolverRecord,
            ScopedBundle,
            ScopeContext,
        )

        scope = ScopeContext(
            tenant_id=_uuid.uuid4(),
            user_id=_uuid.uuid4(),
            allowed_app_ids=('inside-sales',),
            requested_app_ids=('inside-sales',),
            effective_app_id='inside-sales',
            effective_pack_ids=('analytics', 'report_builder'),
        )
        bundle = ScopedBundle(
            scope=scope,
            ontology_classes=(),
            entity_types=(),
            resolvers=(
                ResolverRecord(
                    id=_uuid.uuid4(),
                    tenant_id=None,
                    app_id=None,
                    key='thread-id',
                    entity_type='thread_id',
                    description='Resolve thread IDs',
                    source='evaluation_run_api_call_logs',
                    config={'source': 'evaluation_run_api_call_logs', 'field': 'thread_id', 'match': 'prefix', 'limit': 10},
                    safety='safe_first_pass',
                ),
            ),
            pack_projections=(),
            tool_specs=(),
            tool_schema_enums={},
            question_hints='',
            cache_key=(str(scope.tenant_id), 'inside-sales', 0, frozenset()),
            ontology_version=0,
        )

        surfaces_fixture = [
            {
                'key': 'logs',
                'description': 'Raw logs',
                'source': 'evaluation_run_api_call_logs',
                'entity_types': ['thread_id'],
                'fields': ['thread_id', 'response'],
                'default_limit': 10,
            },
        ]
        with patch(
            'app.services.report_builder.tool_handlers._load_active_semantic_model',
            new=AsyncMock(return_value=semantic_model),
        ), patch(
            'app.services.chat_engine.sql_agent.load_app_config',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.data_surfaces.build_surface_catalog',
            return_value=surfaces_fixture,
        ):
            result = await tool_handlers.handle_discover(
                db=db,
                auth=self._auth(),
                app_id='inside-sales',
                session={'scratchpad': {}, '_bundle': bundle},
            )

        # M2 envelope — discovery data lives under ``envelope.payload``.
        # Surfaces are sourced from the app manifest (canonical); entity
        # resolver types come from the scoped bundle.
        self.assertEqual(result['status'], 'ok')
        body = result['payload']
        self.assertEqual(body['dimensions'][0]['name'], 'direction')
        self.assertEqual(body['metrics'][0]['name'], 'pass_rate')
        self.assertEqual(body['volume']['runs'], 4)
        self.assertEqual(body['volume']['evaluations'], 10)
        self.assertEqual(body['time_range']['earliest'], '2026-01-01')
        # Manifest is the source of truth for data surfaces (see CLAUDE.md).
        surface_keys = [s['key'] for s in body['surfaces']]
        self.assertIn('logs', surface_keys)
        self.assertEqual(body['entity_types'], ['thread_id'])


if __name__ == '__main__':
    unittest.main()
