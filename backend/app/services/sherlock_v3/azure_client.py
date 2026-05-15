"""AsyncOpenAI / AsyncAzureOpenAI client construction for Sherlock v3.

Sherlock uses the Responses API, which both OpenAI and Azure OpenAI expose.
It is a BYOK service with a provider constraint: the tenant must have an
azure_openai OR openai provider configured. Otherwise it is locked.
"""
from __future__ import annotations

import os
import uuid

import openai

from app.database import async_session
from app.services.llm_credentials import ProviderNotConfiguredError, resolve_llm_credentials


_DEFAULT_API_VERSION = "2025-04-01-preview"


async def get_sherlock_azure_client(*, tenant_id: uuid.UUID | str) -> openai.AsyncOpenAI:
    """Build a tenant-scoped OpenAI-family client for one Sherlock turn.

    Prefers azure_openai, falls back to openai. Raises
    ProviderNotConfiguredError if the tenant has neither.
    """
    creds = None
    async with async_session() as db:
        for provider in ("azure_openai", "openai"):
            try:
                creds = await resolve_llm_credentials(db, tenant_id, provider)
                break
            except ProviderNotConfiguredError:
                continue
    if creds is None:
        raise ProviderNotConfiguredError("openai-family (azure_openai or openai)")

    if creds.provider == "azure_openai":
        return openai.AsyncAzureOpenAI(
            api_key=creds.api_key,
            azure_endpoint=creds.base_url or "",
            api_version=creds.extra_config.get("api_version", _DEFAULT_API_VERSION),
        )
    return openai.AsyncOpenAI(api_key=creds.api_key, base_url=creds.base_url or None)


def supervisor_model() -> str:
    """Azure deployment name for the supervisor agent."""
    return os.getenv("SHERLOCK_SUPERVISOR_MODEL", "ai-evals-gpt-5.4")


def specialist_model() -> str:
    """Azure deployment name for specialist agents."""
    return os.getenv("SHERLOCK_SPECIALIST_MODEL", "ai-evals-gpt-5.4-mini")
