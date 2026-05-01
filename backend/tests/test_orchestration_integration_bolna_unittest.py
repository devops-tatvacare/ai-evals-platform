"""BolnaService — POST /call to Bolna AI voice agent."""
from __future__ import annotations

import httpx
import pytest

from app.services.orchestration.integrations import bolna as bolna_mod
from app.services.orchestration.integrations.bolna import BolnaService, BolnaServiceError


def _patch_transport(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        bolna_mod, "_make_client",
        lambda timeout: httpx.AsyncClient(transport=transport, timeout=timeout),
    )


@pytest.mark.asyncio
async def test_place_call_happy_path(monkeypatch):
    captured: dict = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = request.content.decode()
        captured["auth"] = request.headers.get("Authorization")
        return httpx.Response(
            200, json={"message": "queued", "status": "queued", "execution_id": "ex-789"}
        )

    _patch_transport(monkeypatch, _handler)
    svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    out = await svc.place_call(
        agent_id="agent-1",
        recipient_phone="+919999999999",
        user_data={"first_name": "Aarti", "slot": "5pm"},
    )
    assert out["execution_id"] == "ex-789"
    assert "/call" in captured["url"]
    assert "agent-1" in captured["body"]
    assert "+919999999999" in captured["body"]
    assert captured["auth"] == "Bearer k"


@pytest.mark.asyncio
async def test_place_call_with_retry_config(monkeypatch):
    captured: dict = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.content.decode()
        return httpx.Response(200, json={"execution_id": "ex-1", "status": "queued"})

    _patch_transport(monkeypatch, _handler)
    svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    await svc.place_call(
        agent_id="a", recipient_phone="+91", user_data={},
        retry_config={
            "enabled": True, "max_retries": 2,
            "retry_on_statuses": ["no-answer", "busy", "failed"],
            "retry_intervals_minutes": [5, 15, 60],
        },
    )
    assert "max_retries" in captured["body"]
    assert "no-answer" in captured["body"]


@pytest.mark.asyncio
async def test_4xx_raises_service_error(monkeypatch):
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "no agent"})

    _patch_transport(monkeypatch, _handler)
    svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    with pytest.raises(BolnaServiceError):
        await svc.place_call(agent_id="x", recipient_phone="+91", user_data={})


@pytest.mark.asyncio
async def test_5xx_propagates(monkeypatch):
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={})

    _patch_transport(monkeypatch, _handler)
    svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    with pytest.raises(httpx.HTTPError):
        await svc.place_call(agent_id="x", recipient_phone="+91", user_data={})


@pytest.mark.asyncio
async def test_get_agent_happy_path(monkeypatch):
    captured: dict = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("Authorization")
        return httpx.Response(
            200,
            json={"agent": {"prompt_variables": [{"name": "user_name"}]}},
        )

    _patch_transport(monkeypatch, _handler)
    svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    out = await svc.get_agent(agent_id="agent-9")
    assert out["agent"]["prompt_variables"][0]["name"] == "user_name"
    assert "/agents/agent-9" in captured["url"]
    assert captured["auth"] == "Bearer k"


def test_constructor_requires_creds():
    with pytest.raises(ValueError):
        BolnaService(base_url="", api_key="x")
    with pytest.raises(ValueError):
        BolnaService(base_url="x", api_key="")
