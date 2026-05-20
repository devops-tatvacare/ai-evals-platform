"""End-to-end /api/llm/assist route tests.

The actual provider calls are stubbed via ``monkeypatch`` — what we care about
here is route auth, credential resolution, and the request/response contract.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

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
from app.services.llm_credentials import invalidate_cache
from app.services.llm_credentials.crypto import encrypt_json


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


def _override_auth(tenant_id: uuid.UUID) -> AuthContext:
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=tenant_id,
        email="test@assist.local",
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({"voice-rx", "kaira-bot", "inside-sales"}),
    )
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth
    return auth


def _override_non_owner_auth(
    tenant_id: uuid.UUID,
    *,
    permissions: frozenset[str] = frozenset(),
) -> AuthContext:
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=tenant_id,
        email="member@assist.local",
        role_id=uuid.uuid4(),
        is_owner=False,
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
            name=f"assist-{tid.hex[:8]}",
            slug=f"assist-{tid.hex[:8]}",
            is_active=True,
        )
    )
    await db_session.flush()
    return tid


@pytest_asyncio.fixture
async def seeded_provider_openai(db_session, route_tenant_id):
    db_session.add(
        TenantLlmCredential(
            tenant_id=route_tenant_id,
            provider="openai",
            name="default",
            is_enabled=True,
            secret_blob_encrypted=encrypt_json({"api_key": "sk-test"}),
            extra_config={},
        )
    )
    await db_session.flush()
    invalidate_cache(route_tenant_id)
    return "openai"


@pytest_asyncio.fixture
async def client(db_session, route_tenant_id):
    _override_db(db_session)
    _override_auth(route_tenant_id)
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


@pytest.mark.asyncio
async def test_generate_prompt_uses_resolved_credentials(
    client, seeded_provider_openai, monkeypatch
):
    from app.services import llm_assist_service

    captured: dict = {}

    async def _fake(**kwargs):
        captured.update(kwargs)
        return "You are a transcription evaluator..."

    monkeypatch.setattr(llm_assist_service, "run_generate_prompt", _fake)
    resp = await client.post(
        "/api/llm/assist/generate-prompt",
        json={
            "provider": "openai",
            "model": "gpt-5.4",
            "promptType": "evaluation",
            "userIdea": "check tone",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["prompt"].startswith("You are")
    resolved = captured["resolved"]
    assert resolved.model == "gpt-5.4"
    assert captured["prompt_type"] == "evaluation"
    assert captured["user_idea"] == "check tone"
    assert resolved.provider == "openai"
    assert resolved.credentials.secret["api_key"] == "sk-test"


@pytest.mark.asyncio
async def test_generate_schema_returns_object(
    client, seeded_provider_openai, monkeypatch
):
    from app.services import llm_assist_service

    monkeypatch.setattr(
        llm_assist_service,
        "run_generate_schema",
        AsyncMock(return_value={"type": "object", "properties": {}}),
    )
    resp = await client.post(
        "/api/llm/assist/generate-schema",
        json={
            "provider": "openai",
            "model": "gpt-5.4",
            "promptType": "extraction",
            "userIdea": "extract name and age",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["schema"]["type"] == "object"


@pytest.mark.asyncio
async def test_assist_unconfigured_provider_returns_409(client):
    resp = await client.post(
        "/api/llm/assist/generate-prompt",
        json={
            "provider": "anthropic",
            "model": "claude",
            "promptType": "evaluation",
            "userIdea": "x",
        },
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_extract_structured_freeform_text_only(
    client, seeded_provider_openai, monkeypatch
):
    from app.services import llm_assist_service
    from app.schemas.llm_assist import ExtractStructuredResponse

    monkeypatch.setattr(
        llm_assist_service,
        "run_extract_structured",
        AsyncMock(
            return_value=ExtractStructuredResponse(
                result={"text": "extracted"},
                status="completed",
                error=None,
            )
        ),
    )
    resp = await client.post(
        "/api/llm/assist/extract-structured",
        json={
            "provider": "openai",
            "model": "gpt-5.4",
            "prompt": "Extract fields",
            "promptType": "freeform",
            "inputSource": "transcript",
            "transcript": "hello",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "completed"
    assert body["result"]["text"] == "extracted"


@pytest.mark.asyncio
async def test_assist_requires_authentication(db_session, route_tenant_id):
    """Without an auth override, request hits the real auth chain and 401s."""
    _override_db(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as c:
            resp = await c.post(
                "/api/llm/assist/generate-prompt",
                json={
                    "provider": "openai",
                    "model": "gpt-5.4",
                    "promptType": "evaluation",
                    "userIdea": "x",
                },
            )
        assert resp.status_code in (401, 403)
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_assist_requires_asset_create_permission(
    db_session, route_tenant_id, seeded_provider_openai
):
    _override_db(db_session)
    _override_non_owner_auth(route_tenant_id)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as c:
            resp = await c.post(
                "/api/llm/assist/generate-prompt",
                json={
                    "provider": "openai",
                    "model": "gpt-5.4",
                    "promptType": "evaluation",
                    "userIdea": "x",
                },
            )
        assert resp.status_code == 403
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


@pytest.mark.asyncio
async def test_assist_allows_non_owner_with_asset_create_permission(
    db_session, route_tenant_id, seeded_provider_openai, monkeypatch
):
    from app.services import llm_assist_service

    _override_db(db_session)
    _override_non_owner_auth(route_tenant_id, permissions=frozenset({"asset:create"}))
    monkeypatch.setattr(
        llm_assist_service,
        "run_generate_prompt",
        AsyncMock(return_value="generated"),
    )
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as c:
            resp = await c.post(
                "/api/llm/assist/generate-prompt",
                json={
                    "provider": "openai",
                    "model": "gpt-5.4",
                    "promptType": "evaluation",
                    "userIdea": "x",
                },
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["prompt"] == "generated"
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)
