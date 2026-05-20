"""GET /api/llm/models gates non-Azure providers to curated models (strict):
an empty curated set yields zero options; a curated row surfaces that model."""
from __future__ import annotations

import uuid

import httpx
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app
from app.models.cost import RefLlmModelsCatalog
from app.models.tenant import Tenant
from app.models.tenant_curated_model import TenantCuratedModel
from app.models.tenant_llm_credential import TenantLlmCredential
from app.services.llm_credentials.crypto import encrypt_json


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.LLM_CREDENTIAL_KEY", Fernet.generate_key().decode()
    )


@pytest_asyncio.fixture
async def setup(db_session):
    tid = uuid.uuid4()
    db_session.add(Tenant(id=tid, name="cm", slug=f"cm-{tid.hex[:8]}", is_active=True))
    cred = TenantLlmCredential(
        tenant_id=tid, provider="gemini", name="default", is_enabled=True,
        secret_blob_encrypted=encrypt_json({"api_key": "x"}), extra_config={},
    )
    cat = RefLlmModelsCatalog(
        provider_key="google", provider="gemini", model_id="gemini-test",
        model="gemini-test", status="active",
        modalities_input=["text"], modalities_output=["text"],
    )
    db_session.add_all([cred, cat])
    await db_session.flush()

    async def _g():
        yield db_session

    db_session.commit = db_session.flush  # type: ignore[assignment]
    fastapi_app.dependency_overrides[get_db] = _g
    fastapi_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        user_id=SYSTEM_USER_ID, tenant_id=tid, email="a@t.local",
        role_id=uuid.uuid4(), is_owner=True,
        permissions=frozenset({"configuration:edit"}),
        app_access=frozenset(),
    )
    yield db_session, cred, cat
    fastapi_app.dependency_overrides.pop(get_db, None)
    fastapi_app.dependency_overrides.pop(get_auth_context, None)


@pytest_asyncio.fixture
async def client():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test"
    ) as c:
        yield c


@pytest.mark.asyncio
async def test_no_curated_models_returns_empty(setup, client):
    _, cred, _ = setup
    resp = await client.get(
        f"/api/llm/models?call_site=chat_text&credential_id={cred.id}"
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


@pytest.mark.asyncio
async def test_curated_model_appears(setup, client):
    db, cred, cat = setup
    db.add(TenantCuratedModel(credential_id=cred.id, canonical_model_id=cat.id, enabled=True))
    await db.flush()
    resp = await client.get(
        f"/api/llm/models?call_site=chat_text&credential_id={cred.id}"
    )
    assert resp.status_code == 200, resp.text
    assert [o["modelOrDeployment"] for o in resp.json()] == ["gemini-test"]


@pytest.mark.asyncio
async def test_curated_crud_roundtrip(setup, client):
    _, cred, cat = setup
    base = f"/api/admin/ai-settings/credentials/{cred.id}/curated-models"

    resp = await client.post(base, json={"canonicalModelId": str(cat.id)})
    assert resp.status_code == 201, resp.text
    assert resp.json()["model"] == "gemini-test"
    cm_id = resp.json()["id"]

    resp = await client.get(base)
    assert resp.status_code == 200, resp.text
    assert [r["model"] for r in resp.json()] == ["gemini-test"]

    resp = await client.delete(f"/api/admin/ai-settings/curated-models/{cm_id}")
    assert resp.status_code == 204, resp.text

    resp = await client.get(base)
    assert resp.json() == []


@pytest.mark.asyncio
async def test_add_rejects_cross_provider_model(setup, client, db_session):
    _, cred, _ = setup
    other = RefLlmModelsCatalog(
        provider_key="openai", provider="openai", model_id="gpt-x",
        model="gpt-x", status="active",
        modalities_input=["text"], modalities_output=["text"],
    )
    db_session.add(other)
    await db_session.flush()
    resp = await client.post(
        f"/api/admin/ai-settings/credentials/{cred.id}/curated-models",
        json={"canonicalModelId": str(other.id)},
    )
    assert resp.status_code == 400, resp.text
    assert "provider" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_curated_models_cross_tenant_isolation(setup, client, db_session):
    """A credential owned by another tenant must not be reachable."""
    other_tid = uuid.uuid4()
    db_session.add(
        Tenant(id=other_tid, name="other", slug=f"o-{other_tid.hex[:8]}", is_active=True)
    )
    other_cred = TenantLlmCredential(
        tenant_id=other_tid, provider="gemini", name="default", is_enabled=True,
        secret_blob_encrypted=encrypt_json({"api_key": "z"}), extra_config={},
    )
    db_session.add(other_cred)
    await db_session.flush()
    base = f"/api/admin/ai-settings/credentials/{other_cred.id}/curated-models"
    assert (await client.get(base)).status_code == 404
    resp = await client.post(base, json={"canonicalModelId": str(uuid.uuid4())})
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_tenant_default_rejects_uncurated_model(setup, client):
    """The defaults setter must reject a non-Azure model that isn't curated."""
    resp = await client.put(
        "/api/admin/llm/defaults/chat_text",
        json={
            "provider": "gemini",
            "credentialName": "default",
            "modelOrDeployment": "gemini-test",
        },
    )
    assert resp.status_code == 400, resp.text
    assert "not curated" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_tenant_default_accepts_curated_model(setup, client, db_session):
    _, cred, cat = setup
    db_session.add(
        TenantCuratedModel(credential_id=cred.id, canonical_model_id=cat.id, enabled=True)
    )
    await db_session.flush()
    resp = await client.put(
        "/api/admin/llm/defaults/chat_text",
        json={
            "provider": "gemini",
            "credentialName": "default",
            "modelOrDeployment": "gemini-test",
        },
    )
    assert resp.status_code == 200, resp.text
