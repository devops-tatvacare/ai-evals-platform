"""Coverage for /api/llm/auth-status — must read from tenant_llm_credentials."""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app
from app.models.tenant import Tenant
from app.models.tenant_llm_credential import TenantLlmCredential
from app.services.llm_credentials.crypto import encrypt_json


@pytest.fixture(autouse=True)
def _llm_credential_key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.LLM_CREDENTIAL_KEY",
        Fernet.generate_key().decode(),
    )


@pytest.fixture
def patched_async_session(db_session, monkeypatch):
    """Force ``app.database.async_session()`` to yield the test session.

    The discover helpers in routes/llm.py open their own session via
    ``async with async_session() as db: ...``; without this patch they hit
    a fresh connection that doesn't see the test's flushed rows (the
    outer-transaction + savepoint isolation in conftest). Pattern mirrors
    `_patch_async_session` in test_sherlock_azure_client.py.
    """

    @asynccontextmanager
    async def _cm():
        yield db_session

    monkeypatch.setattr("app.database.async_session", _cm)
    return _cm


def _override_db(db_session):
    async def _g():
        yield db_session

    fastapi_app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]


def _override_auth(tenant_id: uuid.UUID) -> AuthContext:
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=tenant_id,
        email="admin@test.local",
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
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
            name=f"llm-routes-{tid.hex[:8]}",
            slug=f"llm-routes-{tid.hex[:8]}",
            is_active=True,
        )
    )
    await db_session.flush()
    return tid


@pytest_asyncio.fixture
async def client(db_session, route_tenant_id):
    _override_db(db_session)
    _override_auth(route_tenant_id)
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
async def test_auth_status_reports_no_providers_when_table_empty(client):
    resp = await client.get("/api/llm/auth-status")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["providers"] == {
        "gemini": False,
        "openai": False,
        "azure_openai": False,
        "anthropic": False,
        "vertex": False,
        "bedrock": False,
    }


@pytest.mark.asyncio
async def test_auth_status_reflects_enabled_tenant_provider_row(
    client, db_session, route_tenant_id
):
    db_session.add(
        TenantLlmCredential(
            tenant_id=route_tenant_id,
            provider="openai",
            name="default",
            is_enabled=True,
            secret_blob_encrypted=encrypt_json({"api_key": "sk-x"}),
            extra_config={},
        )
    )
    await db_session.flush()

    resp = await client.get("/api/llm/auth-status")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["providers"]["openai"] is True
    assert body["providers"]["anthropic"] is False


# Tests for /api/llm/discover-models removed in Phase 3 — admin-side discovery
# coverage lives in test_admin_ai_settings_routes.py against the per-credential
# /api/admin/ai-settings/credentials/{id}/discover-models route.


@pytest.mark.asyncio
async def test_auth_status_ignores_disabled_rows(
    client, db_session, route_tenant_id
):
    db_session.add(
        TenantLlmCredential(
            tenant_id=route_tenant_id,
            provider="anthropic",
            name="default",
            is_enabled=False,
            secret_blob_encrypted=encrypt_json({"api_key": "ak-x"}),
            extra_config={},
        )
    )
    await db_session.flush()

    resp = await client.get("/api/llm/auth-status")
    assert resp.status_code == 200
    assert resp.json()["providers"]["anthropic"] is False
