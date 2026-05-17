"""End-to-end /api/admin/ai-settings route tests — bridge surface.

Asserts:
- list returns one entry per supported provider (6 now), including empty placeholders
- upsert (legacy bridge) creates the ``name='default'`` credential, encrypts
  the api_key as a JSON blob, and redacts the response
- blank apiKey on a subsequent upsert preserves the stored secret blob
- mutating routes are gated by configuration:edit
- unknown-provider rejections still return 400
- Azure ``curatedModels`` from the bridge upsert synchronises into
  ``platform.tenant_llm_deployments`` rows
- the new per-credential CRUD surface (create/list/patch/delete) and
  blank-secret-preserve semantics on PATCH
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
from app.models.tenant_llm_credential import TenantLlmCredential
from app.models.tenant_llm_deployment import TenantLlmDeployment
from app.services.llm_credentials import invalidate_cache
from app.services.llm_credentials.crypto import decrypt_json


@pytest.fixture(autouse=True)
def _llm_credential_key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.LLM_CREDENTIAL_KEY",
        Fernet.generate_key().decode(),
    )


@pytest.fixture(autouse=True)
def _clear_resolver_cache():
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


# ── Bridge surface ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_returns_all_six_providers(admin_client):
    resp = await admin_client.get("/api/admin/ai-settings/providers")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {p["provider"] for p in body} == {
        "openai",
        "azure_openai",
        "anthropic",
        "gemini",
        "vertex",
        "bedrock",
    }
    for p in body:
        # Placeholder rows: not enabled, no key, never validated.
        assert p["isEnabled"] is False
        assert p["hasApiKey"] is False
        assert p["validationStatus"] == "untested"
        assert "apiKey" not in p
        assert "api_key_encrypted" not in p
        assert p["credentialCount"] == 0
        assert p["enabledCredentialCount"] == 0


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
            "curatedModels": [],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["hasApiKey"] is True
    assert body["provider"] == "openai"
    assert body["isEnabled"] is True
    assert body["curatedModels"] == []
    assert "apiKey" not in body
    assert body["apiKeyPreview"] == "sk-s••••-123"

    row = (
        await db_session.execute(
            select(TenantLlmCredential).where(
                TenantLlmCredential.tenant_id == route_tenant_id,
                TenantLlmCredential.provider == "openai",
                TenantLlmCredential.name == "default",
            )
        )
    ).scalar_one()
    payload = decrypt_json(row.secret_blob_encrypted)
    assert payload == {"api_key": "sk-secret-123"}
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
            select(TenantLlmCredential).where(
                TenantLlmCredential.tenant_id == route_tenant_id,
                TenantLlmCredential.provider == "openai",
                TenantLlmCredential.name == "default",
            )
        )
    ).scalar_one()
    original = bytes(first.secret_blob_encrypted)

    resp = await admin_client.put(
        "/api/admin/ai-settings/providers/openai",
        json={
            "isEnabled": True,
            "apiKey": "",
            "baseUrl": None,
            "extraConfig": {},
            "curatedModels": [],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["hasApiKey"] is True

    await db_session.refresh(first)
    assert bytes(first.secret_blob_encrypted) == original


@pytest.mark.asyncio
async def test_bridge_upsert_rejects_vertex_and_bedrock(admin_client):
    """The bridge ``apiKey`` field can't represent the multi-field secrets
    vertex (service_account_json) or bedrock (access_key_id + secret_access_key)
    need. The bridge route returns 400 directing operators to the per-
    credential surface; the multi-credential POST route accepts them."""
    for provider in ("vertex", "bedrock"):
        resp = await admin_client.put(
            f"/api/admin/ai-settings/providers/{provider}",
            json={
                "isEnabled": True,
                "apiKey": "anything",
                "baseUrl": None,
                "extraConfig": {},
                "curatedModels": [],
            },
        )
        assert resp.status_code == 400, resp.text
        assert "credentials" in resp.json()["detail"]


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
async def test_azure_curated_models_sync_into_deployments(
    admin_client, db_session, route_tenant_id
):
    """The bridge form's ``curatedModels`` for Azure becomes
    ``platform.tenant_llm_deployments`` rows (needs_mapping=true until an
    operator maps each to a canonical catalog model)."""
    resp = await admin_client.put(
        "/api/admin/ai-settings/providers/azure_openai",
        json={
            "isEnabled": True,
            "apiKey": "az-key",
            "baseUrl": "https://eu.openai.azure.com",
            "extraConfig": {"api_version": "2025-04-01-preview"},
            "curatedModels": ["prod-gpt5", "prod-mini"],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert sorted(body["curatedModels"]) == ["prod-gpt5", "prod-mini"]

    creds = (
        await db_session.execute(
            select(TenantLlmCredential).where(
                TenantLlmCredential.tenant_id == route_tenant_id,
                TenantLlmCredential.provider == "azure_openai",
            )
        )
    ).scalar_one()
    deployments = (
        await db_session.execute(
            select(TenantLlmDeployment).where(
                TenantLlmDeployment.credential_id == creds.id
            )
        )
    ).scalars().all()
    assert sorted(d.deployment_name for d in deployments) == ["prod-gpt5", "prod-mini"]
    assert all(d.needs_mapping is True for d in deployments)
    assert all(d.canonical_model_id is None for d in deployments)


@pytest.mark.asyncio
async def test_discover_models_filters_by_search(admin_client, monkeypatch):
    from unittest.mock import AsyncMock

    from app.routes import admin_ai_settings as route_mod

    monkeypatch.setattr(
        route_mod,
        "list_models_for_credential",
        AsyncMock(return_value=["gpt-5.4", "gpt-5.4-mini", "o3"]),
    )

    # A default credential must exist before discover can resolve.
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
        "validate_credentials",
        AsyncMock(return_value=None),
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
        "validate_credentials",
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
            select(TenantLlmCredential).where(
                TenantLlmCredential.tenant_id == route_tenant_id,
                TenantLlmCredential.provider == "openai",
            )
        )
    ).scalar_one()
    row.validation_status = "ok"
    await db_session.flush()

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


# ── New per-credential CRUD surface ──────────────────────────────────


@pytest.mark.asyncio
async def test_credential_create_list_patch_delete_roundtrip(
    admin_client, db_session, route_tenant_id
):
    # Create.
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/azure_openai/credentials",
        json={
            "name": "eu-resource",
            "isEnabled": True,
            "secret": {"api_key": "az-eu-secret"},
            "extraConfig": {
                "base_url": "https://eu.openai.azure.com",
                "api_version": "2025-04-01-preview",
            },
        },
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "eu-resource"
    assert created["secretPreview"] == "az-e••••cret"
    assert "secret" not in created

    # List.
    resp = await admin_client.get(
        "/api/admin/ai-settings/providers/azure_openai/credentials"
    )
    assert resp.status_code == 200
    assert any(c["id"] == created["id"] for c in resp.json())

    # Patch with blank secret value → preserves stored blob.
    row = (
        await db_session.execute(
            select(TenantLlmCredential).where(
                TenantLlmCredential.id == uuid.UUID(created["id"])
            )
        )
    ).scalar_one()
    original_blob = bytes(row.secret_blob_encrypted)
    resp = await admin_client.patch(
        f"/api/admin/ai-settings/providers/azure_openai/credentials/{created['id']}",
        json={"secret": {"api_key": ""}, "isEnabled": False},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["isEnabled"] is False
    await db_session.refresh(row)
    assert bytes(row.secret_blob_encrypted) == original_blob

    # Patch with new secret value → rotates blob + flips status to untested.
    row.validation_status = "ok"
    await db_session.flush()
    resp = await admin_client.patch(
        f"/api/admin/ai-settings/providers/azure_openai/credentials/{created['id']}",
        json={"secret": {"api_key": "az-eu-new"}},
    )
    assert resp.status_code == 200, resp.text
    await db_session.refresh(row)
    assert decrypt_json(row.secret_blob_encrypted) == {"api_key": "az-eu-new"}
    assert row.validation_status == "untested"

    # Delete.
    resp = await admin_client.delete(
        f"/api/admin/ai-settings/providers/azure_openai/credentials/{created['id']}",
    )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_credential_create_rejects_missing_secret_keys(admin_client):
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/openai/credentials",
        json={"name": "x", "isEnabled": True, "secret": {}, "extraConfig": {}},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_bedrock_create_requires_both_iam_fields(admin_client):
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/bedrock/credentials",
        json={
            "name": "us-east",
            "isEnabled": True,
            "secret": {"access_key_id": "AKIA..."},
            "extraConfig": {"default_region": "us-east-1"},
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_vertex_create_requires_service_account_json(admin_client):
    resp = await admin_client.post(
        "/api/admin/ai-settings/providers/vertex/credentials",
        json={
            "name": "primary",
            "isEnabled": True,
            "secret": {},
            "extraConfig": {"project_id": "x"},
        },
    )
    assert resp.status_code == 400
