from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services.report_builder.tool_handlers import handle_query_eval_runs


@pytest.mark.asyncio
async def test_query_eval_runs_returns_canonical_and_display_ids():
    run_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        eval_type='batch_thread',
        status='completed',
        created_at=datetime(2026, 4, 12, 17, 0, tzinfo=timezone.utc),
        batch_metadata={'name': 'Smoke'},
        summary={'total_evaluated': 12},
    )
    result_proxy = Mock()
    result_proxy.scalars.return_value.all.return_value = [run]
    db = AsyncMock()
    db.execute.return_value = result_proxy
    auth = SimpleNamespace(is_owner=True, app_access=frozenset({'kaira-bot'}))

    with patch('app.services.access_control.readable_scope_clause', return_value=True):
        payload = await handle_query_eval_runs(
            limit=10,
            db=db,
            auth=auth,
            app_id='kaira-bot',
        )

    assert payload['runs'][0]['id'] == str(run_id)
    assert payload['runs'][0]['display_id'] == str(run_id)[:8]
