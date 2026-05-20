"""Bolna cancel endpoints — httpx.MockTransport fixtures, zero live calls."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest

from app.services.orchestration.adapters.bolna import BolnaAdapter
from app.services.orchestration.adapters.canonical import CancelDispatchOutcome


def _connection(api_key: str = "tok", base_url: str = "https://api.bolna.ai"):
    return {"api_key": api_key, "base_url": base_url}


def _action(execution_id: str | None = "exec-1", batch_id: str | None = None):
    return SimpleNamespace(
        id=uuid4(),
        bolna_execution_id=execution_id,
        bolna_batch_id=batch_id,
    )


def _patched(handler):
    transport = httpx.MockTransport(handler)
    return patch(
        "app.services.orchestration.adapters.bolna._make_client",
        return_value=httpx.AsyncClient(transport=transport),
    )


@pytest.mark.asyncio
async def test_cancel_dispatch_200_stopped():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/call/exec-1/stop"
        assert request.headers["Authorization"] == "Bearer tok"
        return httpx.Response(200, json={"status": "stopped", "execution_id": "exec-1"})

    with _patched(handler):
        result = await BolnaAdapter().cancel_dispatch(
            connection=_connection(), action=_action(),
        )
    assert result.outcome == CancelDispatchOutcome.stopped
    assert result.provider_status_code == 200


@pytest.mark.asyncio
async def test_cancel_dispatch_404_already_delivered():
    def handler(request):
        return httpx.Response(404, json={"error": 404, "message": "not queued"})

    with _patched(handler):
        result = await BolnaAdapter().cancel_dispatch(
            connection=_connection(), action=_action(),
        )
    assert result.outcome == CancelDispatchOutcome.noop_already_delivered


@pytest.mark.asyncio
async def test_cancel_dispatch_no_execution_id_is_noop():
    calls: list = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200)

    with _patched(handler):
        result = await BolnaAdapter().cancel_dispatch(
            connection=_connection(), action=_action(execution_id=None),
        )
    assert result.outcome == CancelDispatchOutcome.noop_already_terminal
    assert calls == []


@pytest.mark.asyncio
async def test_cancel_batch_200_cancelled():
    def handler(request):
        assert request.url.path == "/batches/batch-1/stop"
        return httpx.Response(200, json={"message": "success", "state": "stopped"})

    with _patched(handler):
        result = await BolnaAdapter().cancel_batch(
            connection=_connection(), batch_id="batch-1",
        )
    assert result.outcome == CancelDispatchOutcome.cancelled


@pytest.mark.asyncio
async def test_cancel_batch_404_already_terminal():
    def handler(request):
        return httpx.Response(404, json={"error": 404, "message": "Batch is not queued"})

    with _patched(handler):
        result = await BolnaAdapter().cancel_batch(
            connection=_connection(), batch_id="batch-1",
        )
    assert result.outcome == CancelDispatchOutcome.noop_already_terminal


@pytest.mark.asyncio
async def test_cancel_dispatch_500_provider_error():
    def handler(request):
        return httpx.Response(500, json={"error": 500, "message": "boom"})

    with _patched(handler):
        result = await BolnaAdapter().cancel_dispatch(
            connection=_connection(), action=_action(),
        )
    assert result.outcome == CancelDispatchOutcome.provider_error
    assert result.provider_status_code == 500


@pytest.mark.asyncio
async def test_cancel_run_actions_rolls_batch_up_once():
    """Two actions sharing a batch_id → one batch cancel, no per-call stops."""
    paths: list[str] = []

    def handler(request):
        paths.append(request.url.path)
        return httpx.Response(200, json={"state": "stopped"})

    actions = [
        _action(execution_id="e1", batch_id="batch-9"),
        _action(execution_id="e2", batch_id="batch-9"),
    ]
    with _patched(handler):
        results = await BolnaAdapter().cancel_run_actions(
            connection=_connection(), actions=actions,
        )
    assert paths == ["/batches/batch-9/stop"]
    assert len(results) == 1
    assert results[0].outcome == CancelDispatchOutcome.cancelled
