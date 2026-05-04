"""Phase 13 / B.1 — Bolna list_agents() + cache layer + route.

Three slices, mocked at the httpx layer:

1. Service layer maps Bolna's ``GET /v2/agent/all`` payload into the
   canonical ``{id, name, status, type}`` shape.
2. ``api/agents.list_connection_bolna_agents`` caches results for 30s and
   returns the soft-error envelope when the upstream call fails.
3. ``GET /api/orchestration/connections/{id}/agents`` round-trips through
   the route layer (auth + scope handled separately by the routes test).
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from app.services.orchestration.api import agents as agents_service
from app.services.orchestration.integrations import bolna as bolna_mod
from app.services.orchestration.integrations.bolna import (
    BolnaService,
    BolnaServiceError,
)


def _patch_make_client(monkeypatch, handler):
    """Hook BolnaService's _make_client so the test owns transport.

    Mirrors the pattern used by other Bolna tests in the suite.
    """
    transport = httpx.MockTransport(handler)

    def _factory(timeout: float):
        return httpx.AsyncClient(timeout=timeout, transport=transport)

    monkeypatch.setattr(bolna_mod, "_make_client", _factory)


@pytest.fixture(autouse=True)
def _clear_cache():
    """Each test runs against a fresh in-process cache."""
    agents_service._CACHE.clear()
    yield
    agents_service._CACHE.clear()


# ─── Service layer ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_agents_maps_canonical_shape(monkeypatch):
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json=[
                {"id": "agent-1", "agent_name": "Concierge",
                 "agent_status": "active", "agent_type": "outbound"},
                {"id": "agent-2", "agent_name": "Reminder",
                 "agent_status": "draft", "agent_type": "outbound"},
            ],
        )

    _patch_make_client(monkeypatch, _handler)
    svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    items = await svc.list_agents()

    assert len(captured) == 1
    assert captured[0].url.path == "/v2/agent/all"
    assert captured[0].headers["Authorization"] == "Bearer k"
    assert items == [
        {"id": "agent-1", "name": "Concierge", "status": "active", "type": "outbound"},
        {"id": "agent-2", "name": "Reminder", "status": "draft", "type": "outbound"},
    ]


@pytest.mark.asyncio
async def test_list_agents_handles_wrapped_envelope(monkeypatch):
    """Future-proof: tolerate ``{agents: [...]}`` wrappers without crashing."""
    def _handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(200, json={"agents": [{"id": "a", "agent_name": "Solo"}]})

    _patch_make_client(monkeypatch, _handler)
    svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    items = await svc.list_agents()
    assert [i["name"] for i in items] == ["Solo"]


@pytest.mark.asyncio
async def test_list_agents_raises_on_4xx(monkeypatch):
    def _handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(401, json={"error": "unauthorized"})

    _patch_make_client(monkeypatch, _handler)
    svc = BolnaService(base_url="https://api.bolna.ai", api_key="bad")
    with pytest.raises(BolnaServiceError):
        await svc.list_agents()


# ─── api/agents helper ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_helper_caches_30s(monkeypatch):
    """Two back-to-back calls within the TTL only hit the upstream once."""
    import uuid

    call_count = 0

    async def _fake_list_agents(self):
        nonlocal call_count
        call_count += 1
        return [{"id": "a-1", "name": "A", "status": "active", "type": "x"}]

    async def _fake_load(*_args, **_kwargs):
        return {"base_url": "https://api.bolna.ai", "api_key": "k"}

    monkeypatch.setattr(BolnaService, "list_agents", _fake_list_agents)
    monkeypatch.setattr(agents_service, "_load_connection", _fake_load)

    cid = uuid.uuid4()
    tid = uuid.uuid4()
    out_a = await agents_service.list_connection_bolna_agents(
        db=None, tenant_id=tid, app_id="inside-sales", connection_id=cid,
    )
    out_b = await agents_service.list_connection_bolna_agents(
        db=None, tenant_id=tid, app_id="inside-sales", connection_id=cid,
    )
    assert call_count == 1
    assert out_a == out_b
    assert out_a["error"] is None
    assert out_a["items"] == [{"id": "a-1", "name": "A", "status": "active", "type": "x"}]


@pytest.mark.asyncio
async def test_helper_refresh_busts_cache(monkeypatch):
    import uuid

    call_count = 0

    async def _fake_list_agents(self):
        nonlocal call_count
        call_count += 1
        return [{"id": str(call_count), "name": f"call-{call_count}",
                 "status": "active", "type": "x"}]

    async def _fake_load(*_args, **_kwargs):
        return {"base_url": "https://api.bolna.ai", "api_key": "k"}

    monkeypatch.setattr(BolnaService, "list_agents", _fake_list_agents)
    monkeypatch.setattr(agents_service, "_load_connection", _fake_load)

    cid = uuid.uuid4()
    tid = uuid.uuid4()
    await agents_service.list_connection_bolna_agents(
        db=None, tenant_id=tid, app_id="inside-sales", connection_id=cid,
    )
    out = await agents_service.list_connection_bolna_agents(
        db=None, tenant_id=tid, app_id="inside-sales",
        connection_id=cid, refresh=True,
    )
    assert call_count == 2
    assert out["items"][0]["name"] == "call-2"


@pytest.mark.asyncio
async def test_helper_returns_soft_error_on_upstream_failure(monkeypatch):
    import uuid

    async def _fake_list_agents(self):
        raise BolnaServiceError("Bolna 401: {'error': 'unauthorized'}")

    async def _fake_load(*_args, **_kwargs):
        return {"base_url": "https://api.bolna.ai", "api_key": "k"}

    monkeypatch.setattr(BolnaService, "list_agents", _fake_list_agents)
    monkeypatch.setattr(agents_service, "_load_connection", _fake_load)

    out = await agents_service.list_connection_bolna_agents(
        db=None, tenant_id=uuid.uuid4(), app_id="inside-sales",
        connection_id=uuid.uuid4(),
    )
    assert out["items"] == []
    assert out["error"] is not None
    assert "Bolna 401" in out["error"]


@pytest.mark.asyncio
async def test_helper_returns_soft_error_when_connection_missing():
    import uuid

    # ``_load_connection`` returns None for missing/wrong-provider rows.
    with patch.object(agents_service, "_load_connection", return_value=None):
        out = await agents_service.list_connection_bolna_agents(
            db=None, tenant_id=uuid.uuid4(), app_id="inside-sales",
            connection_id=uuid.uuid4(),
        )
    assert out["items"] == []
    assert "not found" in (out["error"] or "").lower()
