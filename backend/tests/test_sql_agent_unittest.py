from __future__ import annotations

import uuid
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.auth import AuthContext
from app.services.chat_engine import sql_agent


class _FakeAnalyticsSession:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, exc_type, exc, tb):
        return False


class SqlAgentTests(unittest.IsolatedAsyncioTestCase):
    def _auth_context(self) -> AuthContext:
        return AuthContext(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email='user@example.com',
            role_id=uuid.uuid4(),
            is_owner=True,
            permissions=frozenset(),
            app_access=frozenset({'kaira-bot'}),
        )

    def _semantic_model(self) -> dict[str, object]:
        return {
            'tables': {
                'agg_evaluation_run': {
                    'alias': 'rf',
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                    'columns': {
                        'created_at': {'type': 'timestamp', 'role': 'temporal'},
                        'status': {'type': 'text', 'role': 'dimension'},
                        'run_name': {'type': 'text', 'role': 'dimension'},
                        'pass_rate': {'type': 'numeric', 'role': 'measure', 'pre_aggregated': True},
                    },
                },
                'fact_evaluation': {
                    'alias': 'ef',
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                    'columns': {
                        'run_id': {'type': 'uuid', 'role': 'dimension'},
                        'result_status': {'type': 'text', 'role': 'dimension'},
                    },
                },
            },
        }

    def test_load_semantic_model_prefers_app_specific_yaml(self):
        model = sql_agent.load_semantic_model('inside-sales')

        dimension_names = {dimension['name'] for dimension in sql_agent._normalize_dimensions(model)}
        self.assertIn('agent', dimension_names)
        self.assertIn('direction', dimension_names)

    def test_load_semantic_model_for_kaira_exposes_first_class_semantic_dimensions(self):
        model = sql_agent.load_semantic_model('kaira-bot')

        dimensions = {dimension['name']: dimension for dimension in sql_agent._normalize_dimensions(model)}
        self.assertIn('intent', dimensions)
        self.assertIn('route', dimensions)
        self.assertIn('query_type', dimensions)
        self.assertEqual(dimensions['difficulty']['expression'], 'difficulty')
        self.assertEqual(dimensions['total_turns']['expression'], 'total_turns')

    def test_build_schema_context_preserves_dimension_metadata(self):
        semantic_model = {
            'tables': {
                'fact_evaluation': {
                    'alias': 'ef',
                    'columns': {
                        'query_type': {
                            'type': 'text',
                            'role': 'dimension',
                            'allowed_values': ['logging', 'question'],
                        },
                    },
                },
            },
            'dimensions': [
                {
                    'name': 'query_type',
                    'table': 'fact_evaluation',
                    'expression': 'query_type',
                    'description': 'Intent/query mode',
                    'allowed_values': ['logging', 'question'],
                },
                {
                    'name': 'result_status',
                    'table': 'fact_evaluation',
                    'expression': 'result_status',
                    'description': 'Ordered status',
                    'ordering': ['PASS', 'SOFT FAIL', 'HARD FAIL'],
                },
            ],
            'metrics': {
                'pass_rate': {
                    'description': 'Pass rate',
                    'sql': 'AVG(success)',
                    'applies_to': 'fact_evaluation',
                },
            },
        }

        schema_context = sql_agent._build_schema_context(semantic_model, context=None)
        column_metadata = {
            column.get('alias') or column['name']: column['comment_metadata']
            for column in schema_context['tables']['fact_evaluation']['columns']
        }

        self.assertEqual(column_metadata['query_type']['allowed_values'], ['logging', 'question'])
        self.assertEqual(column_metadata['result_status']['ordering'], ['PASS', 'SOFT FAIL', 'HARD FAIL'])

    def test_validate_sql_uses_active_model_tables(self):
        semantic_model = {
            'tables': {
                'support_ticket_facts': {
                    'alias': 'st',
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
            },
        }

        cleaned = sql_agent.validate_sql(
            'SELECT st.category FROM support_ticket_facts st WHERE st.category IS NOT NULL',
            semantic_model=semantic_model,
        )
        self.assertEqual(cleaned, 'SELECT st.category FROM support_ticket_facts st WHERE st.category IS NOT NULL')

    def test_validate_sql_accepts_read_only_cte(self):
        semantic_model = {
            'tables': {
                'support_ticket_facts': {
                    'alias': 'st',
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
            },
        }

        cleaned = sql_agent.validate_sql(
            'WITH recent AS (SELECT st.category FROM support_ticket_facts st) SELECT * FROM recent',
            semantic_model=semantic_model,
        )
        self.assertEqual(cleaned, 'WITH recent AS (SELECT st.category FROM support_ticket_facts st) SELECT * FROM recent')

    def test_prepare_query_rejects_unbound_placeholders(self):
        semantic_model = {
            'tables': {
                'fact_evaluation': {
                    'alias': 'ef',
                    'access_control': {'tenant_column': 'tenant_id', 'app_column': 'app_id'},
                },
            },
        }

        with self.assertRaises(sql_agent.SQLValidationError):
            sql_agent.prepare_query(
                'SELECT ef.item_id FROM fact_evaluation ef WHERE ef.item_id = :item_id',
                auth=AuthContext(
                    user_id=uuid.uuid4(),
                    tenant_id=uuid.uuid4(),
                    email='user@example.com',
                    role_id=uuid.uuid4(),
                    is_owner=True,
                    permissions=frozenset(),
                    app_access=frozenset({'kaira-bot'}),
                ),
                app_id='kaira-bot',
                semantic_model=semantic_model,
            )

    async def test_analyze_expands_short_run_ids_before_sql_generation(self):
        auth = AuthContext(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email='user@example.com',
            role_id=uuid.uuid4(),
            is_owner=True,
            permissions=frozenset(),
            app_access=frozenset({'kaira-bot'}),
        )
        app_db = AsyncMock()
        analytics_db = Mock()
        analytics_db.commit = AsyncMock()
        analytics_db.rollback = AsyncMock()

        captured_questions: list[str] = []
        full_run_id = 'ca540908-1111-2222-3333-444444444444'

        async def fake_generate_sql(question: str, **_kwargs):
            captured_questions.append(question)
            return {'sql': 'SELECT rf.run_id::text FROM agg_evaluation_run rf WHERE rf.run_id = :run_id'}

        with patch(
            'app.services.chat_engine.sql_agent._match_common_query',
            return_value=None,
        ), patch(
            'app.services.chat_engine.sql_agent.load_app_config',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent._resolve_run_id_prefixes',
            new=AsyncMock(return_value={'ca540908': full_run_id}),
        ), patch(
            'app.services.chat_engine.sql_agent.generate_sql',
            new=AsyncMock(side_effect=fake_generate_sql),
        ), patch(
            'app.services.chat_engine.sql_agent._get_cache',
            new=AsyncMock(return_value=None),
        ), patch(
            'app.services.chat_engine.sql_agent._check_query_cost',
            new=AsyncMock(),
        ), patch(
            'app.services.chat_engine.sql_agent.execute_query',
            new=AsyncMock(return_value=[]),
        ), patch(
            'app.services.chat_engine.sql_agent._set_cache',
            new=AsyncMock(),
        ), patch(
            'app.database.analytics_session',
            return_value=_FakeAnalyticsSession(analytics_db),
        ):
            await sql_agent.data_query(
                question='show violated rules for run ca540908',
                db=app_db,
                auth=auth,
                app_id='kaira-bot',
                provider='gemini',
            )

        self.assertEqual(len(captured_questions), 1)
        # Short prefix expanded, then full UUID replaced with bind parameter
        self.assertIn(':uuid_1', captured_questions[0])
        self.assertNotIn(full_run_id, captured_questions[0])
        self.assertNotIn('ca540908', captured_questions[0])

    async def test_analyze_retries_when_explain_fails(self):
        auth = AuthContext(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email='user@example.com',
            role_id=uuid.uuid4(),
            is_owner=True,
            permissions=frozenset(),
            app_access=frozenset({'kaira-bot'}),
        )
        app_db = AsyncMock()
        analytics_db = Mock()
        analytics_db.commit = AsyncMock()
        analytics_db.rollback = AsyncMock()

        generate_sql = AsyncMock(side_effect=[
            {'sql': 'SELECT * FROM fact_evaluation_criterion cf WHERE cf.run_id = \'ca540908\''},
            {'sql': 'SELECT * FROM fact_evaluation_criterion cf WHERE cf.run_id = \'ca540908-1111-2222-3333-444444444444\''},
        ])
        check_cost = AsyncMock(side_effect=[Exception('bad uuid in explain'), None])
        execute_query = AsyncMock(return_value=[{'criterion_name': 'x'}])

        with patch(
            'app.services.chat_engine.sql_agent._match_common_query',
            return_value=None,
        ), patch(
            'app.services.chat_engine.sql_agent.load_app_config',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent._resolve_run_id_prefixes',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent.generate_sql',
            new=generate_sql,
        ), patch(
            'app.services.chat_engine.sql_agent._get_cache',
            new=AsyncMock(return_value=None),
        ), patch(
            'app.services.chat_engine.sql_agent._check_query_cost',
            new=check_cost,
        ), patch(
            'app.services.chat_engine.sql_agent.execute_query',
            new=execute_query,
        ), patch(
            'app.services.chat_engine.sql_agent._set_cache',
            new=AsyncMock(),
        ), patch(
            'app.database.analytics_session',
            return_value=_FakeAnalyticsSession(analytics_db),
        ):
            result = await sql_agent.data_query(
                question='show violated rules for run ca540908',
                db=app_db,
                auth=auth,
                app_id='kaira-bot',
                provider='gemini',
            )

        self.assertEqual(result['status'], 'ok')
        self.assertEqual(generate_sql.await_count, 2)
        self.assertEqual(check_cost.await_count, 2)
        analytics_db.rollback.assert_awaited_once()
        execute_query.assert_awaited_once()

    async def test_analyze_retry_preserves_explicit_only_columns(self):
        auth = self._auth_context()
        app_db = AsyncMock()
        analytics_db = Mock()
        analytics_db.commit = AsyncMock()
        analytics_db.rollback = AsyncMock()

        bundle = Mock()
        bundle.pack_projections = ()
        bundle.safety_by_entity = Mock(return_value={'run_name': 'explicit_only'})

        generate_sql = AsyncMock(side_effect=[
            {'sql': 'SELECT rf.status FROM agg_evaluation_run rf'},
            {'sql': 'SELECT rf.status FROM agg_evaluation_run rf'},
        ])
        check_cost = AsyncMock(side_effect=[Exception('force retry'), None])

        with patch(
            'app.services.chat_engine.sql_agent._match_common_query',
            return_value=None,
        ), patch(
            'app.services.chat_engine.sql_agent.load_app_config',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent._resolve_run_id_prefixes',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent.generate_sql',
            new=generate_sql,
        ), patch(
            'app.services.chat_engine.sql_agent._get_cache',
            new=AsyncMock(return_value=None),
        ), patch(
            'app.services.chat_engine.sql_agent._check_query_cost',
            new=check_cost,
        ), patch(
            'app.services.chat_engine.sql_agent.execute_query',
            new=AsyncMock(return_value=[]),
        ), patch(
            'app.services.chat_engine.sql_agent._set_cache',
            new=AsyncMock(),
        ), patch(
            'app.database.analytics_session',
            return_value=_FakeAnalyticsSession(analytics_db),
        ):
            result = await sql_agent.data_query(
                question='show statuses',
                db=app_db,
                auth=auth,
                app_id='kaira-bot',
                provider='gemini',
                bundle=bundle,
            )

        self.assertEqual(result['status'], 'ok')
        self.assertEqual(generate_sql.await_count, 2)
        self.assertEqual(
            generate_sql.await_args_list[0].kwargs['explicit_only_columns'],
            {'run_name'},
        )
        self.assertEqual(
            generate_sql.await_args_list[1].kwargs['explicit_only_columns'],
            {'run_name'},
        )

    async def test_data_check_returns_row_count_and_bounds(self):
        from app.models.eval_run import EvaluationRun

        db = AsyncMock()
        result_proxy = Mock()
        result_proxy.first.return_value = (5, '2026-04-01 00:00:00+00:00', '2026-04-14 00:00:00+00:00')
        db.execute.return_value = result_proxy

        with patch(
            'app.services.chat_engine.catalog_tools._load_catalog_context',
            new=AsyncMock(return_value=({}, self._semantic_model())),
        ), patch(
            'app.services.chat_engine.catalog_tools._validate_app_access',
            return_value=None,
        ), patch(
            'app.services.chat_engine.catalog_tools._validate_table_access',
            return_value=None,
        ), patch.dict(
            'app.services.chat_engine.catalog_tools._ORM_REGISTRY_TO_TABLE',
            {'evaluation_runs': EvaluationRun},
            clear=False,
        ):
            payload = await sql_agent.data_check(
                table='evaluation_runs',
                filters=None,
                db=db,
                auth=self._auth_context(),
                app_id='kaira-bot',
            )

        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['table'], 'evaluation_runs')
        self.assertEqual(payload['row_count'], 5)
        self.assertEqual(payload['min_created_at'], '2026-04-01 00:00:00+00:00')
        self.assertEqual(payload['max_created_at'], '2026-04-14 00:00:00+00:00')

    async def test_data_check_resolves_manifest_column_synonym_filters(self):
        from app.models.analytics_facts import FactEvaluation

        db = AsyncMock()
        result_proxy = Mock()
        result_proxy.first.return_value = (3, None, None)
        db.execute.return_value = result_proxy

        with patch(
            'app.services.chat_engine.catalog_tools._load_catalog_context',
            new=AsyncMock(return_value=({}, sql_agent.load_semantic_model('kaira-bot', app_config={}))),
        ), patch(
            'app.services.chat_engine.catalog_tools._validate_app_access',
            return_value=None,
        ), patch(
            'app.services.chat_engine.catalog_tools._validate_table_access',
            return_value=None,
        ), patch.dict(
            'app.services.chat_engine.catalog_tools._ORM_REGISTRY_TO_TABLE',
            {'fact_evaluation': FactEvaluation},
            clear=False,
        ):
            payload = await sql_agent.data_check(
                table='fact_evaluation',
                filters={'verdict': 'PASS'},
                db=db,
                auth=self._auth_context(),
                app_id='kaira-bot',
            )

        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['filters'], {'verdict': 'PASS'})

    async def test_data_query_builds_time_series_metadata_and_chart_suggestion(self):
        auth = self._auth_context()
        app_db = AsyncMock()
        analytics_db = Mock()
        analytics_db.commit = AsyncMock()
        analytics_db.rollback = AsyncMock()

        with patch(
            'app.services.chat_engine.sql_agent.load_app_config',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent.load_semantic_model',
            return_value=self._semantic_model(),
        ), patch(
            'app.services.chat_engine.sql_agent._match_common_query',
            return_value=None,
        ), patch(
            'app.services.chat_engine.sql_agent._expand_run_id_prefixes',
            new=AsyncMock(side_effect=lambda question, **_kwargs: question),
        ), patch(
            'app.services.chat_engine.sql_agent.generate_sql',
            new=AsyncMock(return_value={
                'sql': (
                    "SELECT date_trunc('week', rf.created_at) AS week_start, COUNT(*) AS total_runs "
                    'FROM agg_evaluation_run rf GROUP BY 1 ORDER BY 1'
                ),
                'chart_title': 'Weekly runs',
                'output_columns': [
                    {'alias': 'week_start', 'role_hint': 'temporal',
                     'type_hint': 'temporal'},
                    {'alias': 'total_runs', 'role_hint': 'measure',
                     'type_hint': 'quantitative', 'semantic_type_hint': 'count'},
                ],
            }),
        ), patch(
            'app.services.chat_engine.sql_agent._get_cache',
            new=AsyncMock(return_value=None),
        ), patch(
            'app.services.chat_engine.sql_agent._check_query_cost',
            new=AsyncMock(),
        ), patch(
            'app.services.chat_engine.sql_agent.execute_query',
            new=AsyncMock(return_value=[
                {'week_start': '2026-04-01T00:00:00Z', 'total_runs': 8},
                {'week_start': '2026-04-08T00:00:00Z', 'total_runs': 12},
            ]),
        ), patch(
            'app.services.chat_engine.sql_agent._set_cache',
            new=AsyncMock(),
        ), patch(
            'app.database.analytics_session',
            return_value=_FakeAnalyticsSession(analytics_db),
        ):
            result = await sql_agent.data_query(
                question='Show weekly runs for custom evals',
                context={'active_filters': {'eval_type': 'custom'}},
                db=app_db,
                auth=auth,
                app_id='kaira-bot',
                provider='gemini',
            )

        self.assertEqual(result['status'], 'ok')
        # Phase 2 §2.2 (durable current-turn memory): applied_filters is
        # derived from the generated SQL's actual WHERE predicates, not
        # echoed from the context. The mocked SQL has no user-filter
        # predicates (only scope clauses get added by prepare_query and
        # those are elided). Prior-turn ``active_filters`` from context
        # belong to the scratchpad, not to this turn's applied_filters.
        self.assertEqual(result['applied_filters'], {})
        self.assertEqual(result['columns'][0]['name'], 'week_start')
        self.assertEqual(result['columns'][0]['role'], 'temporal')
        self.assertEqual(result['columns'][1]['name'], 'total_runs')
        self.assertEqual(result['columns'][1]['role'], 'measure')
        # Phase 2: chart_type/x_key/y_keys are gone. Assert the new typed
        # result-set contract instead. Deterministic chart selection moves to
        # the Phase 3 picker + emitter.
        typed_by_name = {c['name']: c for c in result['typed_columns']}
        self.assertEqual(typed_by_name['week_start']['role'], 'temporal')
        self.assertEqual(typed_by_name['week_start']['data_type'], 'temporal')
        self.assertEqual(typed_by_name['total_runs']['role'], 'measure')
        self.assertEqual(typed_by_name['total_runs']['data_type'], 'quantitative')
        # Phase 5: chart_options is removed. The scratchpad derives its
        # summary from ``typed_columns`` via the chartability gate.
        self.assertNotIn('chart_options', result)

    async def test_data_query_handles_joined_breakdowns_without_losing_roles(self):
        auth = self._auth_context()
        app_db = AsyncMock()
        analytics_db = Mock()
        analytics_db.commit = AsyncMock()
        analytics_db.rollback = AsyncMock()

        with patch(
            'app.services.chat_engine.sql_agent.load_app_config',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent.load_semantic_model',
            return_value=self._semantic_model(),
        ), patch(
            'app.services.chat_engine.sql_agent._match_common_query',
            return_value=None,
        ), patch(
            'app.services.chat_engine.sql_agent._expand_run_id_prefixes',
            new=AsyncMock(side_effect=lambda question, **_kwargs: question),
        ), patch(
            'app.services.chat_engine.sql_agent.generate_sql',
            new=AsyncMock(return_value={
                'sql': (
                    'SELECT rf.run_name, ef.result_status, COUNT(*) AS violation_count '
                    'FROM agg_evaluation_run rf '
                    'JOIN fact_evaluation ef ON ef.run_id = rf.run_id '
                    'GROUP BY rf.run_name, ef.result_status'
                ),
            }),
        ), patch(
            'app.services.chat_engine.sql_agent._get_cache',
            new=AsyncMock(return_value=None),
        ), patch(
            'app.services.chat_engine.sql_agent._check_query_cost',
            new=AsyncMock(),
        ), patch(
            'app.services.chat_engine.sql_agent.execute_query',
            new=AsyncMock(return_value=[
                {'run_name': 'Smoke', 'result_status': 'PASS', 'violation_count': 4},
                {'run_name': 'Smoke', 'result_status': 'HARD FAIL', 'violation_count': 2},
            ]),
        ), patch(
            'app.services.chat_engine.sql_agent._set_cache',
            new=AsyncMock(),
        ), patch(
            'app.database.analytics_session',
            return_value=_FakeAnalyticsSession(analytics_db),
        ):
            result = await sql_agent.data_query(
                question='Break down violations by run and rule',
                db=app_db,
                auth=auth,
                app_id='kaira-bot',
            )

        self.assertEqual(result['status'], 'ok')
        self.assertEqual([column['role'] for column in result['columns']], ['dimension', 'dimension', 'measure'])
        self.assertIn('rf.tenant_id = :tenant_id', result['sql_used'])
        self.assertIn('JOIN fact_evaluation ef ON ef.run_id = rf.run_id', result['sql_used'])
        self.assertEqual(result['columns'][1]['name'], 'result_status')

    async def test_data_query_returns_deterministic_warning_codes(self):
        auth = self._auth_context()
        app_db = AsyncMock()
        analytics_db = Mock()
        analytics_db.commit = AsyncMock()
        analytics_db.rollback = AsyncMock()

        with patch(
            'app.services.chat_engine.sql_agent.load_app_config',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent.load_semantic_model',
            return_value=self._semantic_model(),
        ), patch(
            'app.services.chat_engine.sql_agent._match_common_query',
            return_value=None,
        ), patch(
            'app.services.chat_engine.sql_agent._expand_run_id_prefixes',
            new=AsyncMock(side_effect=lambda question, **_kwargs: question),
        ), patch(
            'app.services.chat_engine.sql_agent.generate_sql',
            new=AsyncMock(return_value={
                'sql': 'SELECT rf.status, SUM(rf.pass_rate) AS pass_rate FROM agg_evaluation_run rf GROUP BY rf.status',
            }),
        ), patch(
            'app.services.chat_engine.sql_agent._get_cache',
            new=AsyncMock(return_value=None),
        ), patch(
            'app.services.chat_engine.sql_agent._check_query_cost',
            new=AsyncMock(),
        ), patch(
            'app.services.chat_engine.sql_agent.execute_query',
            new=AsyncMock(return_value=[
                {'status': None, 'pass_rate': None},
            ]),
        ), patch(
            'app.services.chat_engine.sql_agent._set_cache',
            new=AsyncMock(),
        ), patch(
            'app.database.analytics_session',
            return_value=_FakeAnalyticsSession(analytics_db),
        ):
            result = await sql_agent.data_query(
                question='Show breakdown by run status',
                db=app_db,
                auth=auth,
                app_id='kaira-bot',
            )

        self.assertEqual(result['status'], 'ok')
        warning_codes = {warning['code'] for warning in result['warnings']}
        self.assertIn('possible_missing_group_by', warning_codes)
        self.assertIn('all_null_column', warning_codes)

    def test_verify_query_result_warns_on_pre_aggregated_measure(self):
        from app.services.chat_engine.result_verifier import verify_query_result

        warnings = verify_query_result(
            question='Show average pass rate',
            sql='SELECT AVG(rf.pass_rate) AS pass_rate FROM agg_evaluation_run rf',
            rows=[{'pass_rate': 82.5}],
            columns=[
                {
                    'name': 'pass_rate',
                    'role': 'measure',
                    'pre_aggregated': True,
                    'source_column': 'rf.pass_rate',
                },
            ],
        )

        self.assertIn('pre_aggregated_measure', {warning['code'] for warning in warnings})

    async def test_data_query_reports_empty_result_without_chart_suggestion(self):
        auth = self._auth_context()
        app_db = AsyncMock()
        analytics_db = Mock()
        analytics_db.commit = AsyncMock()
        analytics_db.rollback = AsyncMock()

        with patch(
            'app.services.chat_engine.sql_agent.load_app_config',
            new=AsyncMock(return_value={}),
        ), patch(
            'app.services.chat_engine.sql_agent.load_semantic_model',
            return_value=self._semantic_model(),
        ), patch(
            'app.services.chat_engine.sql_agent._match_common_query',
            return_value=None,
        ), patch(
            'app.services.chat_engine.sql_agent._expand_run_id_prefixes',
            new=AsyncMock(side_effect=lambda question, **_kwargs: question),
        ), patch(
            'app.services.chat_engine.sql_agent.generate_sql',
            new=AsyncMock(return_value={'sql': 'SELECT rf.run_name FROM agg_evaluation_run rf WHERE 1 = 0'}),
        ), patch(
            'app.services.chat_engine.sql_agent._get_cache',
            new=AsyncMock(return_value=None),
        ), patch(
            'app.services.chat_engine.sql_agent._check_query_cost',
            new=AsyncMock(),
        ), patch(
            'app.services.chat_engine.sql_agent.execute_query',
            new=AsyncMock(return_value=[]),
        ), patch(
            'app.services.chat_engine.sql_agent._set_cache',
            new=AsyncMock(),
        ), patch(
            'app.database.analytics_session',
            return_value=_FakeAnalyticsSession(analytics_db),
        ):
            result = await sql_agent.data_query(
                question='Show runs for missing status',
                db=app_db,
                auth=auth,
                app_id='kaira-bot',
            )

        self.assertEqual(result['status'], 'ok')
        # Phase 2: back-compat shim only. The chartability gate in Phase 3
        # is the authoritative source for "no chart" decisions; empty results
        # will surface as ``kind='chart'`` with ``reason_code='CG_EMPTY'``.
        self.assertNotIn('chart_options', result)
        self.assertEqual(result['typed_columns'], [])
        self.assertEqual([warning['code'] for warning in result['warnings']], ['empty_result'])


if __name__ == '__main__':
    unittest.main()
