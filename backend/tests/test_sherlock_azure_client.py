"""Sherlock requires an OpenAI-family provider; it is not a managed island.

Post-Phase-1 (2026-05-18): credentials carry a ``secret`` dict and an
``extra_config`` blob — Azure endpoint moved from ``creds.base_url`` to
``creds.extra_config["base_url"]``.
"""
import uuid
from contextlib import asynccontextmanager

import openai
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "LLM_CREDENTIAL_KEY", Fernet.generate_key().decode(), raising=False)


@pytest.fixture
def _patch_async_session(monkeypatch, db_session):
    """Reroute azure_client.async_session() to yield the live db_session.

    The conftest db_session wraps everything in a savepoint that other
    connections cannot see — the production code's own async_session() opens
    a separate connection, so the seeded row would be invisible. Patch the
    factory so the same transactional view is shared.
    """
    @asynccontextmanager
    async def _yield_test_session():
        yield db_session

    monkeypatch.setattr(
        "app.services.sherlock_v3.azure_client.async_session",
        _yield_test_session,
    )


@pytest.fixture(autouse=True)
def _clear_resolver_cache():
    from app.services.llm_credentials.resolver import _CACHE
    _CACHE.clear()
    yield
    _CACHE.clear()


@pytest_asyncio.fixture
async def seeded_tenant(db_session):
    from app.models.tenant import Tenant
    tenant = Tenant(
        id=uuid.uuid4(),
        name="sherlock-test-tenant",
        slug=f"sherlock-test-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(tenant)
    await db_session.commit()
    return tenant


async def _seed(db, tenant_id, provider, api_key, extra=None):
    from app.models.tenant_llm_credential import TenantLlmCredential
    from app.services.llm_credentials.crypto import encrypt_json
    db.add(TenantLlmCredential(
        tenant_id=tenant_id, provider=provider, name="default", is_enabled=True,
        secret_blob_encrypted=encrypt_json({"api_key": api_key}),
        extra_config=extra or {},
    ))
    await db.commit()


@pytest.mark.asyncio
async def test_azure_provider_yields_azure_client(db_session, seeded_tenant, _patch_async_session):
    from app.services.sherlock_v3.azure_client import get_sherlock_azure_client
    await _seed(
        db_session, seeded_tenant.id, "azure_openai", "az-key",
        extra={"base_url": "https://x.openai.azure.com", "api_version": "2025-04-01-preview"},
    )
    client = await get_sherlock_azure_client(tenant_id=seeded_tenant.id)
    assert isinstance(client, openai.AsyncAzureOpenAI)


@pytest.mark.asyncio
async def test_openai_provider_yields_plain_client(db_session, seeded_tenant, _patch_async_session):
    from app.services.sherlock_v3.azure_client import get_sherlock_azure_client
    await _seed(db_session, seeded_tenant.id, "openai", "sk-key")
    client = await get_sherlock_azure_client(tenant_id=seeded_tenant.id)
    assert isinstance(client, openai.AsyncOpenAI) and not isinstance(client, openai.AsyncAzureOpenAI)


@pytest.mark.asyncio
async def test_no_openai_family_provider_raises(db_session, seeded_tenant, _patch_async_session):
    from app.services.llm_credentials import ProviderNotConfiguredError
    from app.services.sherlock_v3.azure_client import get_sherlock_azure_client
    await _seed(db_session, seeded_tenant.id, "anthropic", "ak-key")
    with pytest.raises(ProviderNotConfiguredError):
        await get_sherlock_azure_client(tenant_id=seeded_tenant.id)
