"""Coverage for /api/llm/auth-status — must read from tenant_llm_providers."""
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
from app.models.tenant_llm_provider import TenantLlmProvider
from app.services.llm_credentials.crypto import encrypt_secret


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
async def test_auth_status_reports_no_providers_when_table_empty(client, monkeypatch):
    # Make sure no SA path leaks in.
    monkeypatch.setattr("app.config.settings.GEMINI_SERVICE_ACCOUNT_PATH", "")
    resp = await client.get("/api/llm/auth-status")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["providers"] == {
        "gemini": False,
        "openai": False,
        "azure_openai": False,
        "anthropic": False,
    }
    assert body["serviceAccountConfigured"] is False


@pytest.mark.asyncio
async def test_auth_status_reflects_enabled_tenant_provider_row(
    client, db_session, route_tenant_id, monkeypatch
):
    monkeypatch.setattr("app.config.settings.GEMINI_SERVICE_ACCOUNT_PATH", "")
    db_session.add(
        TenantLlmProvider(
            tenant_id=route_tenant_id,
            provider="openai",
            is_enabled=True,
            api_key_encrypted=encrypt_secret("sk-x"),
            extra_config={},
            curated_models=[],
        )
    )
    await db_session.flush()

    resp = await client.get("/api/llm/auth-status")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["providers"]["openai"] is True
    assert body["providers"]["anthropic"] is False
    assert body["serviceAccountConfigured"] is False


class _AnthropicModelStub:
    def __init__(self, mid):
        self.id = mid


class _AnthropicModelsAPI:
    def __init__(self, mids):
        self._mids = mids

    def list(self):
        return iter(_AnthropicModelStub(m) for m in self._mids)


class _FakeAnthropicClient:
    def __init__(self, api_key, mids):
        self.models = _AnthropicModelsAPI(mids)


def _install_fake_anthropic(monkeypatch, mids):
    """Replace ``anthropic.Anthropic`` with a fake that yields the given
    deployment names. Patching the module-level attribute works because the
    helper does ``import anthropic`` inside its function body — the lookup
    happens at call time, after monkeypatch has swapped the attribute."""
    import anthropic

    monkeypatch.setattr(
        anthropic, "Anthropic", lambda api_key: _FakeAnthropicClient(api_key, mids)
    )


FULL_ANTHROPIC_LIST = [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
]


@pytest.mark.asyncio
async def test_discover_models_filters_by_curated_list(
    client, db_session, route_tenant_id, monkeypatch, patched_async_session
):
    """When the tenant has curated_models set, /api/llm/discover-models must
    only return those names — not the full SDK list. The 7+ legacy call sites
    (LLMConfigSection in evaluator wizards, run overlays, report builder, etc.)
    consume this endpoint, so without the filter, admin curation is a no-op
    until the Phase-3 frontend rewire."""
    db_session.add(
        TenantLlmProvider(
            tenant_id=route_tenant_id,
            provider="anthropic",
            is_enabled=True,
            api_key_encrypted=encrypt_secret("ak-x"),
            extra_config={},
            curated_models=["claude-sonnet-4-6"],
        )
    )
    await db_session.flush()
    _install_fake_anthropic(monkeypatch, FULL_ANTHROPIC_LIST)

    resp = await client.post(
        "/api/llm/discover-models",
        json={"provider": "anthropic"},
    )
    assert resp.status_code == 200, resp.text
    names = [m["name"] for m in resp.json()]
    assert names == ["claude-sonnet-4-6"], names


@pytest.mark.asyncio
async def test_discover_models_override_path_skips_curation(
    client, db_session, route_tenant_id, monkeypatch, patched_async_session
):
    """When the request carries an apiKey override (admin probing during
    setup), we must NOT filter by curated_models — the admin needs the raw
    list to choose what to curate."""
    db_session.add(
        TenantLlmProvider(
            tenant_id=route_tenant_id,
            provider="anthropic",
            is_enabled=True,
            api_key_encrypted=encrypt_secret("ak-x"),
            extra_config={},
            curated_models=["claude-sonnet-4-6"],
        )
    )
    await db_session.flush()
    _install_fake_anthropic(monkeypatch, FULL_ANTHROPIC_LIST)

    resp = await client.post(
        "/api/llm/discover-models",
        json={"provider": "anthropic", "apiKey": "ak-typed-by-admin"},
    )
    assert resp.status_code == 200, resp.text
    names = sorted(m["name"] for m in resp.json())
    assert names == sorted(FULL_ANTHROPIC_LIST)


@pytest.mark.asyncio
async def test_auth_status_ignores_disabled_rows(
    client, db_session, route_tenant_id, monkeypatch
):
    monkeypatch.setattr("app.config.settings.GEMINI_SERVICE_ACCOUNT_PATH", "")
    db_session.add(
        TenantLlmProvider(
            tenant_id=route_tenant_id,
            provider="anthropic",
            is_enabled=False,
            api_key_encrypted=encrypt_secret("ak-x"),
            extra_config={},
            curated_models=[],
        )
    )
    await db_session.flush()

    resp = await client.get("/api/llm/auth-status")
    assert resp.status_code == 200
    assert resp.json()["providers"]["anthropic"] is False
