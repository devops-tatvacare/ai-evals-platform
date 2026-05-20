"""Sherlock client + model construction — call-site driven.

Phase 2 cutover: Sherlock no longer reads ``SHERLOCK_SUPERVISOR_MODEL`` /
``SHERLOCK_SPECIALIST_MODEL`` env vars, nor the hardcoded
``ai-evals-gpt-5.4`` fallback. The supervisor and specialist model strings
come from ``platform.tenant_call_site_defaults`` via ``resolve_llm_call``.
Migration 0051 seeded tenant-specific Azure rows from the pre-cutover env
values, so deploying without those env vars is non-breaking.

The previous ``supervisor_model()`` / ``specialist_model()`` env helpers and
``_DEFAULT_API_VERSION`` constant are intentionally absent — anything reading
them was a sign of the env-var coupling we just deleted.
"""
from __future__ import annotations

import uuid

import openai

from app.database import async_session
from app.services.llm_credentials import (
    CallSiteCapabilityMismatch,
    CallSiteCapabilityUnknown,
    CallSiteNotConfiguredError,
    ProviderNotConfiguredError,
    UnknownCallSiteError,
    resolve_llm_call,
)


_SHERLOCK_CALL_SITES = ("analytics_supervisor", "analytics_specialist")

# Sherlock has historically pinned a newer api_version than the rest of the
# platform (which defaults to 2025-03-01-preview when the credential doesn't
# carry one). Kept distinct here because the OpenAI Responses API surface
# Sherlock uses was introduced in 2025-04-01-preview.
_SHERLOCK_AZURE_API_VERSION_FALLBACK = "2025-04-01-preview"


async def get_sherlock_azure_client(
    *,
    tenant_id: uuid.UUID | str,
    call_site: str,
) -> tuple[openai.AsyncOpenAI, str]:
    """Resolve one Sherlock call site to ``(client, model_string)``.

    The OpenAI-compatible client is built per call (cheap — boto3-style SDK
    instantiation only). The model string is the resolved Azure deployment
    name (Sherlock tenants) or the canonical OpenAI model id (OpenAI-only
    tenants fall through to the platform default).

    Raises ``ProviderNotConfiguredError`` when the tenant has no OpenAI-family
    credential at all; ``CallSiteNotConfiguredError`` when the resolver can't
    find a default (tenant or platform) for the call site;
    ``CallSiteCapabilityMismatch`` / ``CallSiteCapabilityUnknown`` when the
    resolved model fails the call site's required-capability check.
    """
    if call_site not in _SHERLOCK_CALL_SITES:
        raise UnknownCallSiteError(call_site)

    async with async_session() as db:
        resolved = await resolve_llm_call(db, tenant_id, call_site)

    creds = resolved.credentials
    api_key = creds.secret.get("api_key", "")
    if not api_key:
        raise ProviderNotConfiguredError(creds.provider, creds.name)

    if creds.provider == "azure_openai":
        client = openai.AsyncAzureOpenAI(
            api_key=api_key,
            azure_endpoint=creds.extra_config.get("base_url") or "",
            api_version=resolved.api_version
            or creds.extra_config.get("api_version", _SHERLOCK_AZURE_API_VERSION_FALLBACK),
        )
    elif creds.provider == "openai":
        client = openai.AsyncOpenAI(
            api_key=api_key,
            base_url=creds.extra_config.get("base_url") or None,
        )
    else:
        # The call-site registry's required capabilities (text + tool_call /
        # structured_output) should already gate to OpenAI-family providers
        # via admin save-time validation, but surface the mismatch loudly if
        # a non-supported provider ever slips through.
        raise CallSiteNotConfiguredError(
            f"Sherlock call site '{call_site}' resolved to provider "
            f"'{creds.provider}', which is not supported by the OpenAI "
            f"Responses API. Reconfigure in /admin/llm/defaults."
        )

    return client, resolved.model


__all__ = [
    "get_sherlock_azure_client",
    # Re-export so callers that catch resolver errors don't need a second import.
    "CallSiteCapabilityMismatch",
    "CallSiteCapabilityUnknown",
    "CallSiteNotConfiguredError",
]
