"""resolve_credentials: name-aware lookup, single-credential auto-fallback,
system-tenant SA fallback, and cascading cache invalidation."""
import uuid

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "LLM_CREDENTIAL_KEY", Fernet.generate_key().decode(), raising=False)


@pytest_asyncio.fixture
async def seeded_tenant(db_session):
    """Create a fresh tenant row so tenant_llm_credentials FK targets exist."""
    from app.models.tenant import Tenant
    tenant = Tenant(
        id=uuid.uuid4(),
        name="llm-byok-test-tenant",
        slug=f"llm-byok-test-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(tenant)
    await db_session.commit()
    return tenant


@pytest.fixture(autouse=True)
def _clear_resolver_cache():
    from app.services.llm_credentials.resolver import _CACHE
    _CACHE.clear()
    yield
    _CACHE.clear()


async def _seed(db, tenant_id, provider, secret, *, name="default", is_enabled=True, extra_config=None):
    from app.models.tenant_llm_credential import TenantLlmCredential
    from app.services.llm_credentials.crypto import encrypt_json
    db.add(TenantLlmCredential(
        tenant_id=tenant_id,
        provider=provider,
        name=name,
        is_enabled=is_enabled,
        secret_blob_encrypted=encrypt_json(secret),
        extra_config=extra_config or {},
    ))
    await db.commit()


@pytest.mark.asyncio
async def test_resolves_enabled_tenant_row(db_session, seeded_tenant):
    from app.services.llm_credentials import resolve_credentials
    await _seed(db_session, seeded_tenant.id, "openai", {"api_key": "sk-live-xyz"})
    creds = await resolve_credentials(db_session, seeded_tenant.id, "openai")
    assert creds.provider == "openai"
    assert creds.name == "default"
    assert creds.secret == {"api_key": "sk-live-xyz"}
    assert creds.service_account_path is None


@pytest.mark.asyncio
async def test_explicit_name_lookup_with_multiple_credentials(db_session, seeded_tenant):
    """Two Azure credentials, named lookup returns the right one."""
    from app.services.llm_credentials import resolve_credentials
    await _seed(
        db_session, seeded_tenant.id, "azure_openai",
        {"api_key": "az-eu"}, name="eu-resource",
        extra_config={"base_url": "https://eu.openai.azure.com"},
    )
    await _seed(
        db_session, seeded_tenant.id, "azure_openai",
        {"api_key": "az-us"}, name="us-resource",
        extra_config={"base_url": "https://us.openai.azure.com"},
    )
    eu = await resolve_credentials(db_session, seeded_tenant.id, "azure_openai", name="eu-resource")
    us = await resolve_credentials(db_session, seeded_tenant.id, "azure_openai", name="us-resource")
    assert eu.secret == {"api_key": "az-eu"}
    assert eu.extra_config["base_url"] == "https://eu.openai.azure.com"
    assert us.secret == {"api_key": "az-us"}
    assert us.extra_config["base_url"] == "https://us.openai.azure.com"


@pytest.mark.asyncio
async def test_single_credential_auto_fallback_when_default_missing(db_session, seeded_tenant):
    """If the only enabled row is named 'prod' and caller asks for 'default', auto-resolve to 'prod'."""
    from app.services.llm_credentials import resolve_credentials
    await _seed(
        db_session, seeded_tenant.id, "openai",
        {"api_key": "sk-only"}, name="prod",
    )
    creds = await resolve_credentials(db_session, seeded_tenant.id, "openai")
    assert creds.name == "prod"
    assert creds.secret == {"api_key": "sk-only"}


@pytest.mark.asyncio
async def test_default_lookup_with_two_named_credentials_raises(db_session, seeded_tenant):
    """Auto-fallback only kicks in when there's exactly one credential. Two = ambiguous."""
    from app.services.llm_credentials import ProviderNotConfiguredError, resolve_credentials
    await _seed(db_session, seeded_tenant.id, "openai", {"api_key": "sk-1"}, name="a")
    await _seed(db_session, seeded_tenant.id, "openai", {"api_key": "sk-2"}, name="b")
    with pytest.raises(ProviderNotConfiguredError):
        await resolve_credentials(db_session, seeded_tenant.id, "openai")


@pytest.mark.asyncio
async def test_disabled_row_is_not_resolved(db_session, seeded_tenant):
    from app.services.llm_credentials import ProviderNotConfiguredError, resolve_credentials
    await _seed(db_session, seeded_tenant.id, "openai", {"api_key": "sk-x"}, is_enabled=False)
    with pytest.raises(ProviderNotConfiguredError):
        await resolve_credentials(db_session, seeded_tenant.id, "openai")


@pytest.mark.asyncio
async def test_unconfigured_provider_raises(db_session, seeded_tenant):
    from app.services.llm_credentials import ProviderNotConfiguredError, resolve_credentials
    with pytest.raises(ProviderNotConfiguredError):
        await resolve_credentials(db_session, seeded_tenant.id, "anthropic")


@pytest.mark.asyncio
async def test_invalidate_cache_levels(db_session, seeded_tenant):
    """Cascading invalidation: tenant > tenant+provider > tenant+provider+name."""
    from app.services.llm_credentials import invalidate_cache, resolve_credentials
    from app.services.llm_credentials.resolver import _CACHE
    await _seed(db_session, seeded_tenant.id, "openai", {"api_key": "sk-x"})
    await _seed(db_session, seeded_tenant.id, "anthropic", {"api_key": "ak-x"})
    await resolve_credentials(db_session, seeded_tenant.id, "openai")
    await resolve_credentials(db_session, seeded_tenant.id, "anthropic")
    assert len(_CACHE) == 2

    invalidate_cache(seeded_tenant.id, "openai", "default")
    assert (str(seeded_tenant.id), "openai", "default") not in _CACHE
    assert (str(seeded_tenant.id), "anthropic", "default") in _CACHE

    await resolve_credentials(db_session, seeded_tenant.id, "openai")
    invalidate_cache(seeded_tenant.id, "openai")
    assert (str(seeded_tenant.id), "openai", "default") not in _CACHE

    await resolve_credentials(db_session, seeded_tenant.id, "openai")
    invalidate_cache(seeded_tenant.id)
    assert _CACHE == {}


@pytest.mark.asyncio
async def test_system_tenant_gemini_falls_back_to_env_sa(db_session, monkeypatch, tmp_path):
    from app.constants import SYSTEM_TENANT_ID
    from app.config import settings
    sa = tmp_path / "sa.json"
    sa.write_text("{}")
    monkeypatch.setattr(settings, "GEMINI_SERVICE_ACCOUNT_PATH", str(sa))
    from app.services.llm_credentials import resolve_credentials
    creds = await resolve_credentials(db_session, SYSTEM_TENANT_ID, "gemini")
    assert creds.service_account_path == str(sa)
    assert creds.secret == {}


@pytest.mark.asyncio
async def test_real_tenant_gemini_never_uses_env_sa(db_session, seeded_tenant, monkeypatch, tmp_path):
    from app.config import settings
    from app.services.llm_credentials import ProviderNotConfiguredError, resolve_credentials
    sa = tmp_path / "sa.json"
    sa.write_text("{}")
    monkeypatch.setattr(settings, "GEMINI_SERVICE_ACCOUNT_PATH", str(sa))
    with pytest.raises(ProviderNotConfiguredError):
        await resolve_credentials(db_session, seeded_tenant.id, "gemini")
