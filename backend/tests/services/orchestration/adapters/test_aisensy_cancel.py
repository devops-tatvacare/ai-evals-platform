"""AiSensy cancel — noop_unsupported with zero HTTP calls (no public recall API)."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest

from app.services.orchestration.adapters.aisensy import AiSensyAdapter
from app.services.orchestration.adapters.canonical import CancelDispatchOutcome


@pytest.mark.asyncio
async def test_aisensy_cancel_dispatch_unsupported_no_http_call():
    calls: list = []

    def handler(request):
        calls.append(request)
        return httpx.Response(500)

    transport = httpx.MockTransport(handler)
    with patch(
        "app.services.orchestration.adapters.aisensy._make_client",
        return_value=httpx.AsyncClient(transport=transport),
    ):
        result = await AiSensyAdapter().cancel_dispatch(
            connection={}, action=SimpleNamespace(id=uuid4()),
        )
    assert result.outcome == CancelDispatchOutcome.noop_unsupported
    assert calls == []


@pytest.mark.asyncio
async def test_aisensy_cancel_run_actions_all_unsupported():
    actions = [SimpleNamespace(id=uuid4()) for _ in range(2)]
    results = await AiSensyAdapter().cancel_run_actions(connection={}, actions=actions)
    assert len(results) == 2
    assert all(r.outcome == CancelDispatchOutcome.noop_unsupported for r in results)
