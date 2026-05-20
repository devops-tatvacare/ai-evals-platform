"""WATI cancel — noop_unsupported with zero HTTP calls (no public recall API)."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest

from app.services.orchestration.adapters.canonical import CancelDispatchOutcome
from app.services.orchestration.adapters.wati import WatiAdapter


@pytest.mark.asyncio
async def test_wati_cancel_dispatch_unsupported_no_http_call():
    calls: list = []

    def handler(request):
        calls.append(request)
        return httpx.Response(500)

    transport = httpx.MockTransport(handler)
    with patch(
        "app.services.orchestration.adapters.wati._make_client",
        return_value=httpx.AsyncClient(transport=transport),
    ):
        result = await WatiAdapter().cancel_dispatch(
            connection={}, action=SimpleNamespace(id=uuid4()),
        )
    assert result.outcome == CancelDispatchOutcome.noop_unsupported
    assert calls == []


@pytest.mark.asyncio
async def test_wati_cancel_run_actions_all_unsupported():
    actions = [SimpleNamespace(id=uuid4()) for _ in range(3)]
    results = await WatiAdapter().cancel_run_actions(connection={}, actions=actions)
    assert len(results) == 3
    assert all(r.outcome == CancelDispatchOutcome.noop_unsupported for r in results)
