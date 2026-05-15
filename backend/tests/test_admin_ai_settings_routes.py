"""End-to-end /api/admin/ai-settings route tests.

Asserts:
- list returns one entry per supported provider, including empty placeholders
- upsert encrypts the api_key + redacts the response (no apiKey field)
- blank apiKey on a subsequent upsert preserves the stored ciphertext
- mutating routes are gated by configuration:edit
- supported-provider validation rejects unknown providers
"""
from __future__ import annotations

import uuid

import httpx
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app
from app.models.tenant import Tenant
from app.models.tenant_llm_provider import TenantLlmProvider
from app.services.llm_credentials import invalidate_cache


@pytest.fixture(autouse=True)
def _llm_credential_key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.LLM_CREDENTIAL_KEY",
        Fernet.generate_key().decode(),
    )


@pytest.fixture(autouse=True)
def _clear_resolver_cache():
    # Resolver cache is process-global; clear before each route test.
    yield
    from app.services.llm_credentials import resolver as _r
    _r._CACHE.clear()


def _override_db(db_session):
    async def _g():
        yield db_session
    fastapi_app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]


def _override_auth(tenant_id: uuid.UUID, *, is_owner: bool = True, permissions: frozenset[str] = frozenset()):
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=tenant_id,
        email="admin@test.local",
        role_id=uuid.uuid4(),
        is_owner=is_owner,
        permissions=permissions,
        app_access=frozenset({"voice-rx", "kaira-bot", "inside-sales"}),
    )
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth
    return auth


@pytest_asyncio.fixture
async def route_tenant_id(db_session) -> uuid.UUID:
    tid = uuid.uuid4()
    db_session.add(
        Tenant(
            id=tid,
            name=f"ai-set-{tid.hex[:8]}",
            slug=f"ai-set-{tid.hex[:8]}",
            is_active=True,
        )
    )
    await db_session.flush()
    return tid


@pytest_asyncio.fixture
async def admin_client(db_session, route_tenant_id):
    _override_db(db_session)
    _override_auth(route_tenant_id, is_owner=True)
    invalidate_cache(route_tenant_id)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


@pytest_asyncio.fixture
async def non_admin_client(db_session, route_tenant_id):
    _override_db(db_session)
    _override_auth(route_tenant_id, is_owner=False, permissions=frozenset())
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


@pytest.mark.asyncio
async def test_list_returns_all_four_providers(admin_client):
    resp = await admin_client.get("/api/admin/ai-settings/providers")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {p["provider"] for p in body} == {
        "openai",
        "azure_openai",
        "anthropic",
        "gemini",
    }
    for p in body:
        # Placeholder rows: not enabled, no key, never validated.
        assert p["isEnabled"] is False
        assert p["hasApiKey"] is False
        assert p["validationStatus"] == "untested"
        assert "apiKey" not in p
        assert "api_key" not in p
        assert "api_key_encrypted" not in p


@pytest.mark.asyncio
async def test_upsert_stores_encrypted_key_and_redacts_response(
    admin_client, db_session, route_tenant_id
):
    resp = await admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "sk-secret-123",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": ["gpt-5.4"],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["hasApiKey"] is True
    assert body["provider"] == "openai"
    assert body["isEnabled"] is True
    assert body["curatedModels"] == ["gpt-5.4"]
    assert "apiKey" not in body
    assert "api_key" not in body
    assert "api_key_encrypted" not in body
    # Preview surfaces first 4 + last 4 of the stored key — `sk-s••••-123`.
    assert body["apiKeyPreview"] == "sk-s••••-123"
    # The middle of the secret never appears in the mask.
    assert "secret" not in body["apiKeyPreview"]

    row = (
        await db_session.execute(
            select(TenantLlmProvider).where(
                TenantLlmProvider.tenant_id == route_tenant_id,
                TenantLlmProvider.provider == "openai",
            )
        )
    ).scalar_one()
    assert row.api_key_encrypted
    assert "sk-secret-123" not in row.api_key_encrypted
    assert row.is_enabled is True


@pytest.mark.asyncio
async def test_blank_key_preserves_stored_secret(admin_client, db_session, route_tenant_id):
    await admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "sk-first",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": [],
        },
    )
    first = (
        await db_session.execute(
            select(TenantLlmProvider).where(
                TenantLlmProvider.tenant_id == route_tenant_id,
                TenantLlmProvider.provider == "openai",
            )
        )
    ).scalar_one()
    original = first.api_key_encrypted

    resp = await admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": ["gpt-5.4"],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["hasApiKey"] is True
    assert body["curatedModels"] == ["gpt-5.4"]

    await db_session.refresh(first)
    assert first.api_key_encrypted == original


@pytest.mark.asyncio
async def test_upsert_rejects_unknown_provider(admin_client):
    resp = await admin_client.put(
        "/api/admin/ai-settings/providers/mistral",
        json={
            "isEnabled": True,
            "apiKey": "x",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": [],
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_upsert_requires_configuration_edit(non_admin_client):
    resp = await non_admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "x",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": [],
        },
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_requires_configuration_edit(non_admin_client):
    resp = await non_admin_client.get("/api/admin/ai-settings/providers")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_discover_models_filters_by_search(admin_client, monkeypatch):
    from unittest.mock import AsyncMock

    from app.routes import admin_ai_settings as route_mod

    monkeypatch.setattr(
        route_mod,
        "list_models_for_provider",
        AsyncMock(return_value=["gpt-5.4", "gpt-5.4-mini", "o3"]),
    )

    # A provider must exist with creds for discover to resolve credentials.
    await admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "sk-x",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": [],
        },
    )
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/openai/discover-models",
        json={"search": "mini"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["models"] == ["gpt-5.4-mini"]


@pytest.mark.asyncio
async def test_discover_models_unconfigured_returns_409(admin_client):
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/anthropic/discover-models",
        json={"search": ""},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_validate_marks_status_ok(admin_client, monkeypatch):
    from unittest.mock import AsyncMock

    from app.routes import admin_ai_settings as route_mod

    monkeypatch.setattr(
        route_mod,
        "list_models_for_provider",
        AsyncMock(return_value=["gpt-5.4", "gpt-5.4-mini"]),
    )
    await admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "sk-x",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": [],
        },
    )
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/openai/validate"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["validationStatus"] == "ok"
    assert body["detail"] is None


@pytest.mark.asyncio
async def test_validate_marks_status_invalid_on_value_error(admin_client, monkeypatch):
    from unittest.mock import AsyncMock

    from app.routes import admin_ai_settings as route_mod

    monkeypatch.setattr(
        route_mod,
        "list_models_for_provider",
        AsyncMock(side_effect=ValueError("OpenAI authentication failed: bad key")),
    )
    await admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "sk-bad",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": [],
        },
    )
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/openai/validate"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["validationStatus"] == "invalid"
    assert "authentication" in (body["detail"] or "").lower()


@pytest.mark.asyncio
async def test_validate_azure_uses_validate_azure_credentials(admin_client, monkeypatch):
    """Azure has no key-based deployment listing, so validation must hit the
    resource directly via validate_azure_credentials — not the (would-pass-on-
    empty-list) list_models_for_provider path."""
    from unittest.mock import AsyncMock

    from app.routes import admin_ai_settings as route_mod

    azure_validate = AsyncMock(return_value=None)
    list_models = AsyncMock(return_value=["should-not-be-used"])
    monkeypatch.setattr(route_mod, "validate_azure_credentials", azure_validate)
    monkeypatch.setattr(route_mod, "list_models_for_provider", list_models)

    await admin_client.put(
        "/api/admin/ai-settings/providers/azure_openai",
        json={
            "isEnabled": True,
            "apiKey": "az-key",
            "baseUrl": "https://x.openai.azure.com",
            "extraConfig": {"api_version": "2025-04-01-preview", "deployments": []},
            "curatedModels": [],
        },
    )
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/azure_openai/validate"
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["validationStatus"] == "ok"
    assert azure_validate.await_count == 1
    assert list_models.await_count == 0


@pytest.mark.asyncio
async def test_validate_azure_marks_invalid_when_auth_fails(admin_client, monkeypatch):
    from unittest.mock import AsyncMock

    from app.routes import admin_ai_settings as route_mod

    monkeypatch.setattr(
        route_mod,
        "validate_azure_credentials",
        AsyncMock(side_effect=ValueError("Azure OpenAI authentication failed: bad key")),
    )
    await admin_client.put(
        "/api/admin/ai-settings/providers/azure_openai",
        json={
            "isEnabled": True,
            "apiKey": "az-bad",
            "baseUrl": "https://x.openai.azure.com",
            "extraConfig": {"api_version": "2025-04-01-preview", "deployments": []},
            "curatedModels": [],
        },
    )
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/azure_openai/validate"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["validationStatus"] == "invalid"
    assert "authentication" in (body["detail"] or "").lower()


@pytest.mark.asyncio
async def test_validate_requires_provider_row(admin_client):
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/anthropic/validate"
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_validate_requires_configuration_edit(non_admin_client):
    resp = await non_admin_client.post(
        "/api/admin/ai-settings/providers/openai/validate"
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_discover_models_requires_configuration_edit(non_admin_client):
    resp = await non_admin_client.post(
        "/api/admin/ai-settings/providers/openai/discover-models",
        json={"search": ""},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_new_key_resets_validation_status(admin_client, db_session, route_tenant_id):
    # First write — succeeds, lands as untested.
    await admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "sk-x",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": [],
        },
    )
    row = (
        await db_session.execute(
            select(TenantLlmProvider).where(
                TenantLlmProvider.tenant_id == route_tenant_id,
                TenantLlmProvider.provider == "openai",
            )
        )
    ).scalar_one()
    row.validation_status = "ok"
    await db_session.flush()

    # New key submitted — status flips back to untested.
    resp = await admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "sk-new-rotated",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": [],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["validationStatus"] == "untested"
