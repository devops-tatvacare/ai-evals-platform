"""``resolve_llm_call`` resolution flow.

Covers:
- registry validation (unknown call site raises)
- tenant default wins over platform default
- platform default fires when tenant has no row
- ``CallSiteNotConfiguredError`` when neither tenant nor platform default exists
- explicit override path (provider+credential_name+model) skips both lookups
- legacy bridge override (provider+model only) auto-fills credential_name
- Azure path resolves deployment + canonical model + api_version override
- capability mismatch raises
- 4-level cache invalidation
"""
import uuid

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from sqlalchemy import text as sa_text


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "LLM_CREDENTIAL_KEY", Fernet.generate_key().decode(), raising=False)


@pytest.fixture(autouse=True)
def _clear_caches():
    from app.services.llm_credentials.call_site_resolver import _CACHE as cc
    from app.services.llm_credentials.resolver import _CACHE as creds_cache
    cc.clear()
    creds_cache.clear()
    yield
    cc.clear()
    creds_cache.clear()


@pytest_asyncio.fixture
async def seeded_tenant(db_session):
    from app.models.tenant import Tenant
    t = Tenant(
        id=uuid.uuid4(),
        name=f"call-site-{uuid.uuid4().hex[:8]}",
        slug=f"call-site-{uuid.uuid4().hex[:8]}",
        is_active=True,
    )
    db_session.add(t)
    await db_session.commit()
    return t


@pytest_asyncio.fixture
async def text_model_id(db_session):
    """Return the UUID of a text-only catalog row.

    Catalog rows are sourced from models.dev refresh at lifespan boot
    (Phase 2 cleanup removed the in-migration seed). If the test DB already
    has a ``gpt-4o-mini`` row from a previous lifespan/refresh, reuse it
    rather than insert a colliding duplicate. Otherwise insert a minimal
    row for the test to work against.
    """
    from sqlalchemy import select
    from app.models.cost import RefLlmModelsCatalog

    existing = (
        await db_session.execute(
            select(RefLlmModelsCatalog).where(
                RefLlmModelsCatalog.provider == "openai",
                RefLlmModelsCatalog.model == "gpt-4o-mini",
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        # Ensure the flags this test depends on are set even if upstream
        # said otherwise — keeps the test's intent (text + structured) intact.
        existing.modalities_input = ["text"]
        existing.modalities_output = ["text"]
        existing.supports_structured_output = True
        await db_session.commit()
        return existing.id

    cat = RefLlmModelsCatalog(
        provider_key="openai",
        provider="openai",
        model_id="gpt-4o-mini",
        model="gpt-4o-mini",
        display_name="gpt-4o-mini",
        modalities_input=["text"],
        modalities_output=["text"],
        supports_reasoning=False,
        supports_tool_call=False,
        supports_attachment=False,
        supports_structured_output=True,
    )
    db_session.add(cat)
    await db_session.commit()
    return cat.id


async def _seed_credential(db, tenant_id, provider, api_key, *, name="default", extra=None):
    from app.models.tenant_llm_credential import TenantLlmCredential
    from app.services.llm_credentials.crypto import encrypt_json
    cred = TenantLlmCredential(
        tenant_id=tenant_id,
        provider=provider,
        name=name,
        is_enabled=True,
        secret_blob_encrypted=encrypt_json({"api_key": api_key}),
        extra_config=extra or {},
    )
    db.add(cred)
    await db.commit()
    return cred


async def _seed_default(db, *, tenant_id, call_site, provider, model, credential_name="default"):
    """Upsert the (tenant_id, call_site) default.

    Migration 0051 seeds platform-level defaults that may already occupy
    (NULL tenant, call_site) slots; reuse the row in that case so tests
    don't trip on the unique constraint.
    """
    from sqlalchemy import select
    from app.models.tenant_call_site_default import TenantCallSiteDefault
    stmt = select(TenantCallSiteDefault).where(
        TenantCallSiteDefault.call_site == call_site,
    )
    stmt = (
        stmt.where(TenantCallSiteDefault.tenant_id.is_(None))
        if tenant_id is None
        else stmt.where(TenantCallSiteDefault.tenant_id == tenant_id)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        row = TenantCallSiteDefault(
            tenant_id=tenant_id,
            call_site=call_site,
            provider=provider,
            credential_name=credential_name,
            model_or_deployment=model,
        )
        db.add(row)
    else:
        row.provider = provider
        row.credential_name = credential_name
        row.model_or_deployment = model
    await db.commit()
    return row


@pytest.mark.asyncio
async def test_unknown_call_site_raises(db_session, seeded_tenant):
    from app.services.llm_credentials import UnknownCallSiteError, resolve_llm_call
    with pytest.raises(UnknownCallSiteError):
        await resolve_llm_call(db_session, seeded_tenant.id, "not_a_real_site")


@pytest.mark.asyncio
async def test_missing_default_raises_call_site_not_configured(
    db_session, seeded_tenant
):
    from app.services.llm_credentials import (
        CallSiteNotConfiguredError,
        resolve_llm_call,
    )
    with pytest.raises(CallSiteNotConfiguredError):
        await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")


@pytest.mark.asyncio
async def test_platform_default_fires_when_tenant_has_no_row(
    db_session, seeded_tenant, text_model_id
):
    from app.services.llm_credentials import resolve_llm_call
    _ = text_model_id
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-x")
    # Platform-default row (tenant_id IS NULL).
    await _seed_default(
        db_session, tenant_id=None, call_site="chat_text",
        provider="openai", model="gpt-4o-mini",
    )
    result = await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    assert result.provider == "openai"
    assert result.model == "gpt-4o-mini"
    assert result.credential_name == "default"
    assert "text_input" in result.capabilities
    assert "text_output" in result.capabilities


@pytest.mark.asyncio
async def test_tenant_default_wins_over_platform_default(
    db_session, seeded_tenant, text_model_id
):
    """Tenant row uses a non-default credential name to make the precedence
    visible."""
    from app.services.llm_credentials import resolve_llm_call
    _ = text_model_id
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-prod", name="prod")
    await _seed_default(
        db_session, tenant_id=None, call_site="chat_text",
        provider="openai", model="some-other-model",
    )
    await _seed_default(
        db_session, tenant_id=seeded_tenant.id, call_site="chat_text",
        provider="openai", model="gpt-4o-mini", credential_name="prod",
    )
    result = await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    assert result.model == "gpt-4o-mini"  # tenant row wins
    assert result.credential_name == "prod"


@pytest.mark.asyncio
async def test_explicit_override_skips_default_lookup(
    db_session, seeded_tenant, text_model_id
):
    """Override path uses provider+credential_name_override+model without
    touching tenant_call_site_defaults."""
    from app.services.llm_credentials import resolve_llm_call
    _ = text_model_id
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-x")
    # No default row exists; override should still work.
    result = await resolve_llm_call(
        db_session, seeded_tenant.id, "chat_text",
        provider_override="openai",
        credential_name_override="default",
        model_override="gpt-4o-mini",
    )
    assert result.model == "gpt-4o-mini"
    assert result.provider == "openai"


@pytest.mark.asyncio
async def test_bridge_override_with_provider_and_model_only(
    db_session, seeded_tenant, text_model_id
):
    """Legacy bridge passes provider+model only; resolver auto-fills the
    credential name as 'default' (and Phase-1 single-credential auto-fallback
    handles tenants whose only credential is named differently)."""
    from app.services.llm_credentials import resolve_llm_call
    _ = text_model_id
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-x")
    result = await resolve_llm_call(
        db_session, seeded_tenant.id, "chat_text",
        provider_override="openai",
        model_override="gpt-4o-mini",
    )
    assert result.credential_name == "default"


@pytest.mark.asyncio
async def test_single_credential_auto_fallback_when_default_misses(
    db_session, seeded_tenant, text_model_id
):
    """Platform default points at credential_name='default', but tenant has
    only one credential and it's named 'prod' — auto-fallback uses 'prod'."""
    from app.services.llm_credentials import resolve_llm_call
    _ = text_model_id
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-prod-only", name="prod")
    await _seed_default(
        db_session, tenant_id=None, call_site="chat_text",
        provider="openai", model="gpt-4o-mini",
    )
    result = await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    # Phase-1 resolver's single-credential auto-fallback returns the 'prod'
    # row regardless of the name asked for.
    assert result.credential_name == "prod"
    assert result.credentials.secret["api_key"] == "sk-prod-only"


@pytest.mark.asyncio
async def test_capability_mismatch_raises(
    db_session, seeded_tenant
):
    """audio_transcription requires audio_input; pointing it at a text-only
    model triggers CallSiteCapabilityMismatch at runtime."""
    from app.models.cost import RefLlmModelsCatalog
    from app.services.llm_credentials import (
        CallSiteCapabilityMismatch,
        resolve_llm_call,
    )
    cat = RefLlmModelsCatalog(
        provider_key="openai",
        provider="openai",
        model_id="text-only-x",
        model="text-only-x",
        display_name="text-only-x",
        modalities_input=["text"],
        modalities_output=["text"],
    )
    db_session.add(cat)
    await db_session.commit()
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-x")
    await _seed_default(
        db_session, tenant_id=seeded_tenant.id, call_site="audio_transcription",
        provider="openai", model="text-only-x",
    )
    with pytest.raises(CallSiteCapabilityMismatch):
        await resolve_llm_call(db_session, seeded_tenant.id, "audio_transcription")


@pytest.mark.asyncio
async def test_azure_path_resolves_deployment_and_api_version(db_session, seeded_tenant):
    """Azure default carries a deployment name; resolver joins
    tenant_llm_deployments → canonical catalog row + picks api_version_override."""
    from sqlalchemy import select
    from app.models.cost import RefLlmModelsCatalog
    from app.models.tenant_llm_deployment import TenantLlmDeployment
    from app.services.llm_credentials import resolve_llm_call
    # Catalog target (Azure deployments map to provider='openai' canonical rows).
    # Catalog rows come from models.dev at lifespan boot — reuse the row if
    # the test DB already has it (typical after a real boot in dev), else
    # insert a minimal row for the test.
    cat = (
        await db_session.execute(
            select(RefLlmModelsCatalog).where(
                RefLlmModelsCatalog.provider == "openai",
                RefLlmModelsCatalog.model == "gpt-4o",
            )
        )
    ).scalar_one_or_none()
    if cat is None:
        cat = RefLlmModelsCatalog(
            provider_key="openai",
            provider="openai",
            model_id="gpt-4o",
            model="gpt-4o",
            display_name="gpt-4o",
            modalities_input=["text"],
            modalities_output=["text"],
            supports_tool_call=True,
            supports_structured_output=True,
        )
        db_session.add(cat)
    else:
        cat.modalities_input = ["text"]
        cat.modalities_output = ["text"]
        cat.supports_tool_call = True
        cat.supports_structured_output = True
    await db_session.commit()

    cred = await _seed_credential(
        db_session, seeded_tenant.id, "azure_openai", "az-key",
        extra={"base_url": "https://x.openai.azure.com", "api_version": "2025-01-01-preview"},
    )
    db_session.add(
        TenantLlmDeployment(
            credential_id=cred.id,
            deployment_name="my-prod-gpt5",
            canonical_model_id=cat.id,
            api_version_override="2025-04-01-preview",
            needs_mapping=False,
            enabled=True,
        )
    )
    await db_session.commit()

    await _seed_default(
        db_session, tenant_id=seeded_tenant.id, call_site="chat_text",
        provider="azure_openai", model="my-prod-gpt5",
    )
    result = await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    assert result.model == "my-prod-gpt5"
    # api_version_override on the deployment wins over the credential default.
    assert result.api_version == "2025-04-01-preview"
    # api_version from credential extra_config also gets exposed; here override beat it.


@pytest.mark.asyncio
async def test_azure_unmapped_deployment_raises_capability_unknown(
    db_session, seeded_tenant
):
    from app.models.tenant_llm_deployment import TenantLlmDeployment
    from app.services.llm_credentials import (
        CallSiteCapabilityUnknown,
        resolve_llm_call,
    )
    cred = await _seed_credential(
        db_session, seeded_tenant.id, "azure_openai", "az-key",
        extra={"base_url": "https://x.openai.azure.com"},
    )
    db_session.add(
        TenantLlmDeployment(
            credential_id=cred.id,
            deployment_name="prod-unknown",
            canonical_model_id=None,
            needs_mapping=True,
            enabled=True,
        )
    )
    await db_session.commit()
    await _seed_default(
        db_session, tenant_id=seeded_tenant.id, call_site="chat_text",
        provider="azure_openai", model="prod-unknown",
    )
    with pytest.raises(CallSiteCapabilityUnknown):
        await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")


@pytest.mark.asyncio
async def test_cache_returns_same_object(db_session, seeded_tenant, text_model_id):
    from app.services.llm_credentials import resolve_llm_call
    _ = text_model_id
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-x")
    await _seed_default(
        db_session, tenant_id=None, call_site="chat_text",
        provider="openai", model="gpt-4o-mini",
    )
    r1 = await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    r2 = await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    assert r1 is r2


@pytest.mark.asyncio
async def test_ambiguous_multi_credential_raises_call_site_not_configured(
    db_session, seeded_tenant, text_model_id
):
    """Plan Task 3 step 4: when the configured credential name (e.g. 'default')
    doesn't exist AND the tenant has 2+ other credentials, raise — never
    silently pick rows[0]. This is the bridge-override ambiguity case."""
    from app.services.llm_credentials import (
        CallSiteNotConfiguredError,
        resolve_llm_call,
    )
    _ = text_model_id
    # Two named credentials, no 'default'.
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-prod", name="prod")
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-staging", name="staging")
    # Platform default refers to credential_name='default', which doesn't exist
    # for this tenant — resolver MUST fail loud rather than guess.
    await _seed_default(
        db_session, tenant_id=None, call_site="chat_text",
        provider="openai", model="gpt-4o-mini",
    )
    with pytest.raises(CallSiteNotConfiguredError) as excinfo:
        await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    # Both names surface in the error so admins know what they're choosing between.
    msg = str(excinfo.value)
    assert "prod" in msg and "staging" in msg


@pytest.mark.asyncio
async def test_partial_override_provider_only_raises(
    db_session, seeded_tenant, text_model_id
):
    """provider_override without model_override is a partial override and
    must raise instead of falling through to the default path (which would
    silently ignore the override the caller supplied)."""
    from app.services.llm_credentials import (
        CallSiteNotConfiguredError,
        resolve_llm_call,
    )
    _ = text_model_id
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-x")
    await _seed_default(
        db_session, tenant_id=None, call_site="chat_text",
        provider="openai", model="gpt-4o-mini",
    )
    with pytest.raises(CallSiteNotConfiguredError) as excinfo:
        await resolve_llm_call(
            db_session, seeded_tenant.id, "chat_text",
            provider_override="openai",  # model_override missing
        )
    assert "Partial override" in str(excinfo.value)


@pytest.mark.asyncio
async def test_partial_override_model_only_raises(
    db_session, seeded_tenant, text_model_id
):
    """Mirror of the above: model_override without provider_override."""
    from app.services.llm_credentials import (
        CallSiteNotConfiguredError,
        resolve_llm_call,
    )
    _ = text_model_id
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-x")
    await _seed_default(
        db_session, tenant_id=None, call_site="chat_text",
        provider="openai", model="gpt-4o-mini",
    )
    with pytest.raises(CallSiteNotConfiguredError):
        await resolve_llm_call(
            db_session, seeded_tenant.id, "chat_text",
            model_override="gpt-4o-mini",  # provider_override missing
        )


@pytest.mark.asyncio
async def test_invalidate_call_site_cache_4_levels(
    db_session, seeded_tenant, text_model_id
):
    from app.services.llm_credentials import invalidate_call_site_cache, resolve_llm_call
    from app.services.llm_credentials.call_site_resolver import _CACHE
    _ = text_model_id
    await _seed_credential(db_session, seeded_tenant.id, "openai", "sk-x")
    await _seed_default(
        db_session, tenant_id=None, call_site="chat_text",
        provider="openai", model="gpt-4o-mini",
    )
    await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    assert len(_CACHE) == 1

    # Single (tenant, call_site).
    invalidate_call_site_cache(seeded_tenant.id, "chat_text")
    assert _CACHE == {}

    await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    # All entries for tenant.
    invalidate_call_site_cache(seeded_tenant.id)
    assert _CACHE == {}

    await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    # All tenants for that call_site (platform-default change).
    invalidate_call_site_cache(call_site="chat_text")
    assert _CACHE == {}

    await resolve_llm_call(db_session, seeded_tenant.id, "chat_text")
    # Everything.
    invalidate_call_site_cache()
    assert _CACHE == {}
