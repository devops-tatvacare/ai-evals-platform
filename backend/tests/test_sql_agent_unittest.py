from __future__ import annotations

import os
import sys
import uuid
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

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
    def test_load_semantic_model_prefers_app_specific_yaml(self):
        model = sql_agent.load_semantic_model('inside-sales')

        dimension_names = {dimension['name'] for dimension in sql_agent._normalize_dimensions(model)}
        self.assertIn('agent', dimension_names)
        self.assertIn('direction', dimension_names)

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
            return 'SELECT rf.run_id::text FROM analytics_run_facts rf WHERE rf.run_id = :run_id'

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
            await sql_agent.analyze(
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
            'SELECT * FROM analytics_criterion_facts cf WHERE cf.run_id = \'ca540908\'',
            'SELECT * FROM analytics_criterion_facts cf WHERE cf.run_id = \'ca540908-1111-2222-3333-444444444444\'',
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
            result = await sql_agent.analyze(
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


if __name__ == '__main__':
    unittest.main()
