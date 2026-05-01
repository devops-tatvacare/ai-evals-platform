"""End-to-end /api/orchestration/connections route tests.

Asserts the safe-secret semantics from phase-10 §1.1:

- GET responses NEVER include plaintext secret values.
- PATCH preserves omitted secret keys (does not force re-entry of every credential).
- Blank-string secret overwrites are rejected (cannot wipe a stored credential).
"""
from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app


@pytest.fixture(autouse=True)
def fernet_key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_CONNECTION_KEY",
        Fernet.generate_key().decode(),
    )


def _override_db(db_session):
    async def _g():
        yield db_session
    fastapi_app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]


def _override_auth(tenant_id=SYSTEM_TENANT_ID):
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=tenant_id,
        email="test@orchestration.local",
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({"voice-rx", "kaira-bot", "inside-sales"}),
    )
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth
    return auth


@pytest_asyncio.fixture
async def client(db_session):
    _override_db(db_session)
    _override_auth()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test",
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


def _bolna_create_body(name: str | None = None) -> dict[str, Any]:
    return {
        "appId": "inside-sales",
        "provider": "bolna",
        "name": name or f"bolna-{uuid.uuid4().hex[:8]}",
        "config": {
            "api_key": "secret-original",
            "base_url": "https://api.bolna.ai",
            "from_phone": "+911234567890",
        },
        "active": True,
    }


def _webhook_create_body(name: str | None = None) -> dict[str, Any]:
    return {
        "appId": "inside-sales",
        "provider": "webhook",
        "name": name or f"webhook-{uuid.uuid4().hex[:8]}",
        "config": {
            "base_url": "https://hooks.example.com",
            "auth_header_name": "Authorization",
            "auth_header_value": "Bearer top-secret",
        },
        "active": True,
    }


@pytest.mark.asyncio
async def test_create_then_get_never_returns_secret_value(client):
    body = _bolna_create_body()
    r = await client.post("/api/orchestration/connections", json=body)
    assert r.status_code == 201, r.text
    payload = r.json()
    cid = payload["id"]

    # GET — secret stripped from configRedacted, base_url visible.
    g = await client.get(f"/api/orchestration/connections/{cid}")
    assert g.status_code == 200, g.text
    redacted = g.json()["configRedacted"]
    assert "api_key" not in redacted
    assert redacted.get("base_url") == "https://api.bolna.ai"
    assert redacted.get("from_phone") == "+911234567890"
    # webhook URL composed for inbound providers.
    assert g.json()["webhookUrl"] is not None


@pytest.mark.asyncio
async def test_webhook_connection_redacts_secret_and_has_no_webhook_url(client):
    r = await client.post("/api/orchestration/connections", json=_webhook_create_body())
    assert r.status_code == 201, r.text
    cid = r.json()["id"]

    g = await client.get(f"/api/orchestration/connections/{cid}")
    assert g.status_code == 200, g.text
    redacted = g.json()["configRedacted"]
    assert redacted["base_url"] == "https://hooks.example.com"
    assert redacted["auth_header_name"] == "Authorization"
    assert "auth_header_value" not in redacted
    assert g.json()["webhookUrl"] is None


@pytest.mark.asyncio
async def test_patch_preserves_omitted_secret(client, monkeypatch):
    """Phase-10 §1.1: edit form may omit secret keys; the stored value is preserved.

    Verification: stub ``health.probe`` to capture the decrypted plaintext
    config the test endpoint would dispatch with. After PATCHing a
    non-secret field with the api_key key omitted, the captured plaintext
    must still carry the original ``api_key`` — proving the stored secret
    survived the edit.
    """
    captured: dict = {}

    async def _spy_probe(provider, config):
        captured["provider"] = provider
        captured["config"] = config
        return {"ok": True, "detail": "stubbed"}

    monkeypatch.setattr(
        "app.services.orchestration.api.connections.health.probe", _spy_probe,
    )

    create = await client.post("/api/orchestration/connections", json=_bolna_create_body())
    cid = create.json()["id"]

    # PATCH only base_url — api_key omitted.
    r = await client.patch(
        f"/api/orchestration/connections/{cid}",
        json={"config": {"base_url": "https://staging.bolna.ai"}},
    )
    assert r.status_code == 200, r.text
    redacted = r.json()["configRedacted"]
    assert redacted["base_url"] == "https://staging.bolna.ai"
    assert "api_key" not in redacted

    # /test exercises the decrypt path with the stored row.
    t = await client.post(f"/api/orchestration/connections/{cid}/test")
    assert t.status_code == 200, t.text
    assert captured["provider"] == "bolna"
    assert captured["config"]["api_key"] == "secret-original"
    assert captured["config"]["base_url"] == "https://staging.bolna.ai"


@pytest.mark.asyncio
async def test_patch_rejects_blank_secret_overwrite(client):
    create = await client.post("/api/orchestration/connections", json=_bolna_create_body())
    cid = create.json()["id"]
    r = await client.patch(
        f"/api/orchestration/connections/{cid}",
        json={"config": {"api_key": ""}},
    )
    assert r.status_code == 400, r.text
    assert "blank" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_patch_overwrites_secret_when_explicit(client, monkeypatch):
    captured: dict = {}

    async def _spy_probe(provider, config):
        captured["config"] = config
        return {"ok": True, "detail": "stubbed"}

    monkeypatch.setattr(
        "app.services.orchestration.api.connections.health.probe", _spy_probe,
    )

    create = await client.post("/api/orchestration/connections", json=_bolna_create_body())
    cid = create.json()["id"]
    r = await client.patch(
        f"/api/orchestration/connections/{cid}",
        json={"config": {"api_key": "rotated-key"}},
    )
    assert r.status_code == 200, r.text

    t = await client.post(f"/api/orchestration/connections/{cid}/test")
    assert t.status_code == 200, t.text
    assert captured["config"]["api_key"] == "rotated-key"


@pytest.mark.asyncio
async def test_create_with_unknown_provider_returns_400(client):
    body = _bolna_create_body()
    body["provider"] = "ghost-provider"
    r = await client.post("/api/orchestration/connections", json=body)
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_duplicate_name_returns_409(client):
    name = f"dup-{uuid.uuid4().hex[:8]}"
    a = await client.post("/api/orchestration/connections", json=_bolna_create_body(name))
    assert a.status_code == 201, a.text
    b = await client.post("/api/orchestration/connections", json=_bolna_create_body(name))
    assert b.status_code == 409


@pytest.mark.asyncio
async def test_get_schema_returns_x_secret_metadata(client):
    r = await client.get("/api/orchestration/connections/schema?provider=bolna")
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["provider"] == "bolna"
    properties = payload["jsonSchema"]["properties"]
    assert properties["api_key"]["x-secret"] is True
    assert properties["base_url"].get("x-secret") is None
    secret_field = next(f for f in payload["fields"] if f["name"] == "api_key")
    assert secret_field["secret"] is True


@pytest.mark.asyncio
async def test_webhook_schema_returns_secret_metadata(client):
    r = await client.get("/api/orchestration/connections/schema?provider=webhook")
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["provider"] == "webhook"
    assert payload["supportsWebhook"] is False
    properties = payload["jsonSchema"]["properties"]
    assert properties["auth_header_value"]["x-secret"] is True
    assert properties["base_url"].get("x-secret") is None


@pytest.mark.asyncio
async def test_webhook_connection_rejects_half_auth_pair(client):
    body = _webhook_create_body()
    body["config"].pop("auth_header_value")
    r = await client.post("/api/orchestration/connections", json=body)
    assert r.status_code == 400, r.text
    assert "provided together" in r.json()["detail"]


@pytest.mark.asyncio
async def test_archive_sets_active_false(client):
    create = await client.post("/api/orchestration/connections", json=_bolna_create_body())
    cid = create.json()["id"]
    d = await client.delete(f"/api/orchestration/connections/{cid}")
    assert d.status_code == 204
    # listing without includeInactive: archived row is hidden.
    listing = await client.get("/api/orchestration/connections?appId=inside-sales")
    assert all(r["id"] != cid for r in listing.json())
    # listing with includeInactive: archived row is visible.
    listing_all = await client.get(
        "/api/orchestration/connections?appId=inside-sales&includeInactive=true",
    )
    assert any(r["id"] == cid and r["active"] is False for r in listing_all.json())


@pytest.mark.asyncio
async def test_rotate_token_changes_webhook_url(client):
    create = await client.post("/api/orchestration/connections", json=_bolna_create_body())
    cid = create.json()["id"]
    original_url = create.json()["webhookUrl"]
    rot = await client.post(f"/api/orchestration/connections/{cid}/rotate-token")
    assert rot.status_code == 200, rot.text
    assert rot.json()["webhookUrl"] != original_url


@pytest.mark.asyncio
async def test_agent_variables_route_uses_live_provider_lookup(client, monkeypatch):
    async def _fake_get_agent(self, *, agent_id):
        assert agent_id == "agent-7"
        return {
            "agent": {
                "prompt_variables": [
                    {"name": "user_name"},
                    {"name": "preferred_time"},
                ]
            }
        }

    monkeypatch.setattr(
        "app.services.orchestration.api.connections.BolnaService.get_agent",
        _fake_get_agent,
    )

    create = await client.post("/api/orchestration/connections", json=_bolna_create_body())
    cid = create.json()["id"]
    r = await client.get(
        f"/api/orchestration/connections/{cid}/agent-variables?agentId=agent-7"
    )
    assert r.status_code == 200, r.text
    assert r.json()["provider"] == "bolna"
    assert r.json()["variables"] == ["user_name", "preferred_time"]


@pytest.mark.asyncio
async def test_get_unknown_id_returns_404(client):
    r = await client.get(f"/api/orchestration/connections/{uuid.uuid4()}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_validation_error_on_missing_required(client):
    body = _bolna_create_body()
    body["config"].pop("api_key")
    r = await client.post("/api/orchestration/connections", json=body)
    assert r.status_code == 400
