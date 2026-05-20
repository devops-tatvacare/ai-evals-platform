"""``resolve_llm_call`` — single read path for "what model / credential should
this call use?".

Sits one level above ``resolve_credentials`` (Phase 1). Callers pass a
``call_site`` (registered in ``call_sites.py``) and the resolver looks up
the active default — tenant row first, platform row second — then resolves
the underlying credential, picks the right Azure deployment when relevant,
and validates capability fit.

No transitional shape. Phase-2 bridge code paths (legacy pickers that pass
``provider_override + model_override`` without a ``credential_name_override``)
route through the same single-credential auto-fallback.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost import RefLlmModelsCatalog
from app.models.tenant_call_site_default import TenantCallSiteDefault
from app.models.tenant_llm_credential import TenantLlmCredential
from app.models.tenant_llm_deployment import TenantLlmDeployment
from app.services.llm_credentials.call_sites import (
    CALL_SITES,
    UnknownCallSiteError,
    get_call_site,
)
from app.services.llm_credentials.capabilities import (
    compute_capabilities,
    unknown_capabilities,
)
from app.services.llm_credentials.crypto import decrypt_json
from app.services.llm_credentials.resolver import (
    ProviderNotConfiguredError,
    ResolvedCredentials,
    resolve_credentials,
)


_DEFAULT_CREDENTIAL_NAME = "default"


class CallSiteNotConfiguredError(RuntimeError):
    """Raised when neither a tenant default nor a platform default exists, OR
    when the configured default points at a credential the tenant doesn't have.

    Carries a stable client-facing message — surface it as the HTTPException
    detail so the UI can route to the relevant admin page.
    """


class CallSiteCapabilityMismatch(RuntimeError):
    """The default points at a model that doesn't satisfy the call site's
    required capabilities. The admin save path validates the same condition,
    so this should never fire in practice — it exists as a runtime safety net
    after schema drift / out-of-band model deprecations."""


class CallSiteCapabilityUnknown(RuntimeError):
    """Azure deployment exists but ``canonical_model_id IS NULL``
    (``needs_mapping=true``) — we cannot compute its capabilities until the
    admin maps it. Same error class as ``CallSiteCapabilityMismatch`` would
    use, but more specific."""


@dataclass(frozen=True)
class ResolvedLlmCall:
    call_site: str
    provider: str
    credential_name: str
    credentials: ResolvedCredentials
    # For Azure: the deployment name. For other providers: the canonical
    # catalog model id.
    model: str
    capabilities: frozenset[str]
    api_version: str | None


# Cache key: (tenant_id_str, call_site, override_signature). 60s TTL.
# Overrides flow through a distinct cache slot so cross-invalidation only
# wipes the per-tenant default slot, not in-flight override resolutions.
_CACHE: dict[tuple[str, str, str], tuple[float, ResolvedLlmCall]] = {}
_CACHE_TTL_SECONDS = 60.0


def _cache_signature(
    provider_override: str | None,
    credential_name_override: str | None,
    model_override: str | None,
) -> str:
    if provider_override is None and credential_name_override is None and model_override is None:
        return ""
    return f"{provider_override or ''}/{credential_name_override or ''}/{model_override or ''}"


def invalidate_call_site_cache(
    tenant_id: uuid.UUID | str | None = None,
    call_site: str | None = None,
) -> None:
    """Drop cached resolutions.

    - ``tenant_id=None, call_site=None``: clear everything
    - ``tenant_id=<x>, call_site=None``: clear all entries for that tenant
      (including the platform-default-slot entries that were resolved for it)
    - ``tenant_id=<x>, call_site=<y>``: clear that single (tenant, call_site) pair
    - ``tenant_id=None, call_site=<y>``: clear every tenant's entries for
      that call_site (used when a platform-default row changes — every
      tenant without an override now resolves differently)
    """
    if tenant_id is None and call_site is None:
        _CACHE.clear()
        return
    if tenant_id is not None and call_site is None:
        tid = str(tenant_id)
        for key in [k for k in _CACHE if k[0] == tid]:
            _CACHE.pop(key, None)
        return
    if tenant_id is None and call_site is not None:
        for key in [k for k in _CACHE if k[1] == call_site]:
            _CACHE.pop(key, None)
        return
    tid = str(tenant_id)
    for key in [k for k in _CACHE if k[0] == tid and k[1] == call_site]:
        _CACHE.pop(key, None)


async def _lookup_default_row(
    db: AsyncSession, tenant_id: uuid.UUID, call_site: str
) -> TenantCallSiteDefault | None:
    """Tenant-specific row first, platform row (``tenant_id IS NULL``) second."""
    row = (
        await db.execute(
            select(TenantCallSiteDefault).where(
                TenantCallSiteDefault.tenant_id == tenant_id,
                TenantCallSiteDefault.call_site == call_site,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        return row
    return (
        await db.execute(
            select(TenantCallSiteDefault).where(
                TenantCallSiteDefault.tenant_id.is_(None),
                TenantCallSiteDefault.call_site == call_site,
            )
        )
    ).scalar_one_or_none()


async def _resolve_credentials_with_single_fallback(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    provider: str,
    credential_name: str,
    *,
    call_site: str,
) -> ResolvedCredentials:
    """Attempt the requested name; if it doesn't exist for this tenant, fall
    back to that tenant's sole credential for the provider (if exactly one
    exists). Otherwise raise ``CallSiteNotConfiguredError`` with an
    actionable message.

    Plan Task 3 step 4: if 2+ credentials exist, **always** raise — the
    fallback is single-credential-only and silently picking one would mask
    the ambiguity the admin needs to resolve.
    """
    try:
        return await resolve_credentials(db, tenant_id, provider, credential_name)
    except ProviderNotConfiguredError:
        # Phase-1 ``resolve_credentials`` already implements single-credential
        # auto-fallback when name='default' is asked for and the tenant has
        # exactly one row. Landing here means the requested name doesn't
        # match any enabled row.
        rows = (
            await db.execute(
                select(TenantLlmCredential).where(
                    TenantLlmCredential.tenant_id == tenant_id,
                    TenantLlmCredential.provider == provider,
                    TenantLlmCredential.is_enabled.is_(True),
                )
            )
        ).scalars().all()
        if len(rows) == 0:
            raise CallSiteNotConfiguredError(
                f"Tenant has no credentials configured for provider '{provider}' "
                f"(required by call site '{call_site}'). "
                f"An admin must add one in AI Settings."
            )
        if len(rows) >= 2:
            names = ", ".join(sorted(r.name for r in rows))
            raise CallSiteNotConfiguredError(
                f"Multiple credentials exist for provider '{provider}' ({names}); "
                f"call site '{call_site}' points at credential name "
                f"'{credential_name}' which doesn't exist for this tenant — "
                f"admin must pick which credential to use in /admin/llm/defaults."
            )
        # Single-credential auto-fallback when the configured name doesn't
        # exist (e.g. platform default named 'default' but tenant only has 'prod').
        row = rows[0]
        secret = decrypt_json(row.secret_blob_encrypted)
        return ResolvedCredentials(
            provider=row.provider,
            name=row.name,
            secret=dict(secret),
            extra_config=dict(row.extra_config or {}),
            service_account_path=None,
        )


async def _resolve_azure_model(
    db: AsyncSession,
    credential_row: TenantLlmCredential,
    deployment_name: str,
    call_site: str,
) -> tuple[RefLlmModelsCatalog, str | None]:
    """Look up the Azure deployment row → its canonical catalog row.

    Returns ``(catalog_row, api_version_override)``. Raises
    ``CallSiteCapabilityUnknown`` if the deployment exists but isn't mapped
    (``needs_mapping=true``); ``CallSiteNotConfiguredError`` if the
    deployment doesn't exist at all.
    """
    dep_row = (
        await db.execute(
            select(TenantLlmDeployment).where(
                TenantLlmDeployment.credential_id == credential_row.id,
                TenantLlmDeployment.deployment_name == deployment_name,
            )
        )
    ).scalar_one_or_none()
    if dep_row is None:
        raise CallSiteNotConfiguredError(
            f"Azure deployment '{deployment_name}' is not declared on this tenant's "
            f"credential (required by call site '{call_site}'). "
            f"Add it in /admin/ai-settings/credentials/{credential_row.id}/deployments."
        )
    if dep_row.canonical_model_id is None:
        raise CallSiteCapabilityUnknown(
            f"Azure deployment '{deployment_name}' is awaiting admin mapping "
            f"(needs_mapping=true). Map it to a canonical catalog model in "
            f"/admin/ai-settings/credentials/{credential_row.id}/deployments "
            f"before using it as a default for call site '{call_site}'."
        )
    catalog_row = (
        await db.execute(
            select(RefLlmModelsCatalog).where(
                RefLlmModelsCatalog.id == dep_row.canonical_model_id
            )
        )
    ).scalar_one_or_none()
    if catalog_row is None:
        # Deployment maps to a catalog row that no longer exists — refuse.
        raise CallSiteNotConfiguredError(
            f"Azure deployment '{deployment_name}' maps to a canonical model "
            f"that is no longer in the catalog. Remap it in "
            f"/admin/ai-settings/credentials/{credential_row.id}/deployments."
        )
    return catalog_row, dep_row.api_version_override


async def _resolve_non_azure_model(
    db: AsyncSession, provider: str, model: str, call_site: str
) -> RefLlmModelsCatalog:
    catalog_row = (
        await db.execute(
            select(RefLlmModelsCatalog).where(
                RefLlmModelsCatalog.provider == provider,
                RefLlmModelsCatalog.model == model,
            )
        )
    ).scalar_one_or_none()
    if catalog_row is None:
        raise CallSiteNotConfiguredError(
            f"Model '{model}' for provider '{provider}' is not in the catalog "
            f"(required by call site '{call_site}'). "
            f"Run the models.dev refresh from /admin/ai-settings/cost or pick a "
            f"different model in /admin/llm/defaults."
        )
    return catalog_row


def _assert_capability_fit(
    call_site: str,
    required: frozenset[str],
    catalog_row: RefLlmModelsCatalog,
) -> None:
    """Raise ``CallSiteCapabilityMismatch`` when the model's confirmed
    capability set doesn't cover the call site's required tags.

    Partitions the missing tags into two buckets so the error message tells
    the operator which fix to apply:

    - ``unknown`` — flag is NULL in the catalog (upstream hasn't been
      consulted for this row). Action: refresh the catalog.
    - ``confirmed_false`` — flag is explicitly false. Action: pick a
      different model.
    """
    available = compute_capabilities(catalog_row)
    missing = required - available
    if not missing:
        return
    unknown = unknown_capabilities(catalog_row) & missing
    confirmed_false = missing - unknown
    parts: list[str] = [
        f"Resolved model '{catalog_row.model}' for call site '{call_site}' "
        f"is missing required capabilities {sorted(missing)}."
    ]
    if unknown:
        parts.append(
            f"Unknown (catalog never refreshed from upstream for these flags): "
            f"{sorted(unknown)} — run POST /api/admin/cost/refresh-models-dev "
            f"or wait for the cost-rollup job to reconcile."
        )
    if confirmed_false:
        parts.append(
            f"Confirmed unsupported by upstream: {sorted(confirmed_false)} — "
            f"pick a different model in /admin/llm/defaults."
        )
    raise CallSiteCapabilityMismatch(" ".join(parts))


async def resolve_llm_call(
    db: AsyncSession,
    tenant_id: uuid.UUID | str,
    call_site: str,
    *,
    provider_override: str | None = None,
    credential_name_override: str | None = None,
    model_override: str | None = None,
) -> ResolvedLlmCall:
    """Resolve credentials + model + capabilities for one call site.

    Resolution order:
      1. Validate ``call_site`` against the registry.
      2. If any override is supplied, use the override path (does NOT write
         the override back to ``tenant_call_site_defaults``). When only
         provider+model are supplied (legacy bridge), credential_name resolves
         to ``'default'`` or the tenant's sole credential for that provider.
      3. Otherwise look up the default: tenant row first, platform row second.
         Raise ``CallSiteNotConfiguredError`` if both miss.
      4. Resolve the credential through Phase-1 ``resolve_credentials`` with
         single-credential auto-fallback.
      5. Resolve the model: Azure → deployment table; others → catalog.
      6. Compute capabilities and assert required ⊆ available.
    """
    if call_site not in CALL_SITES:
        raise UnknownCallSiteError(call_site)
    spec = get_call_site(call_site)
    tid = uuid.UUID(str(tenant_id)) if not isinstance(tenant_id, uuid.UUID) else tenant_id

    cache_sig = _cache_signature(
        provider_override, credential_name_override, model_override
    )
    cache_key = (str(tid), call_site, cache_sig)
    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]

    # Decide provider + credential_name + model_or_deployment.
    has_override = (
        provider_override is not None
        or credential_name_override is not None
        or model_override is not None
    )
    if has_override:
        if provider_override is None or model_override is None:
            raise CallSiteNotConfiguredError(
                f"Partial override for call site '{call_site}' — both "
                f"provider_override and model_override are required when "
                f"overriding (credential_name_override is optional)."
            )
        provider = provider_override
        model_or_deployment = model_override
        credential_name = credential_name_override or _DEFAULT_CREDENTIAL_NAME
    else:
        default_row = await _lookup_default_row(db, tid, call_site)
        if default_row is None:
            raise CallSiteNotConfiguredError(
                f"No tenant default and no platform default for call site "
                f"'{call_site}'. An admin must configure one in /admin/llm/defaults."
            )
        provider = default_row.provider
        credential_name = default_row.credential_name or _DEFAULT_CREDENTIAL_NAME
        model_or_deployment = default_row.model_or_deployment

    creds = await _resolve_credentials_with_single_fallback(
        db, tid, provider, credential_name, call_site=call_site,
    )

    # Look up the credential ORM row again — we need its id for Azure deployments.
    credential_row: TenantLlmCredential | None = None
    if provider == "azure_openai":
        credential_row = (
            await db.execute(
                select(TenantLlmCredential).where(
                    TenantLlmCredential.tenant_id == tid,
                    TenantLlmCredential.provider == provider,
                    TenantLlmCredential.name == creds.name,
                )
            )
        ).scalar_one_or_none()
        if credential_row is None:
            raise CallSiteNotConfiguredError(
                f"Resolved credential '{creds.name}' for provider '{provider}' "
                f"vanished between resolve and Azure-deployment lookup — retry "
                f"the operation."
            )
        catalog_row, api_version_override = await _resolve_azure_model(
            db, credential_row, model_or_deployment, call_site,
        )
        api_version = (
            api_version_override
            or creds.extra_config.get("api_version")
        )
    else:
        catalog_row = await _resolve_non_azure_model(
            db, provider, model_or_deployment, call_site,
        )
        api_version = creds.extra_config.get("api_version")

    _assert_capability_fit(call_site, spec.required_capabilities, catalog_row)
    capabilities = compute_capabilities(catalog_row)

    resolved = ResolvedLlmCall(
        call_site=call_site,
        provider=provider,
        credential_name=creds.name,
        credentials=creds,
        model=model_or_deployment,
        capabilities=capabilities,
        api_version=api_version,
    )
    _CACHE[cache_key] = (now + _CACHE_TTL_SECONDS, resolved)
    return resolved


__all__ = [
    "ResolvedLlmCall",
    "CallSiteNotConfiguredError",
    "CallSiteCapabilityMismatch",
    "CallSiteCapabilityUnknown",
    "resolve_llm_call",
    "invalidate_call_site_cache",
]
