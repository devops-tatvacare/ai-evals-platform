"""AsyncAzureOpenAI client construction for Sherlock v3.

Provider lock per architecture spec §8 (Azure OpenAI). Credentials resolve
through the **tenant-scoped LLM settings** stored in the platform settings
table. Env vars are only used for the deployment-name pin (which is a
deploy-level choice, not a per-tenant secret).

CLAUDE.md invariant: "LLM settings are global per tenant and user at
``app_id=''``; do not pass an app ID for LLM settings lookup." We honor
that — `app_id` is intentionally not threaded through.
"""
from __future__ import annotations

import os
import uuid

import openai

from app.services.evaluators.settings_helper import get_llm_settings_from_db


def _create_azure_client(
    *,
    api_key: str,
    azure_endpoint: str,
    api_version: str,
) -> openai.AsyncAzureOpenAI:
    """Direct AsyncAzureOpenAI constructor — Sherlock v3 is Azure-only.

    Inlined here so this module is the single home of Sherlock v3 client
    construction. The v2 ``chat_engine.openai_agents_adapter.create_openai
    _client`` helper used to wrap this; v3 doesn't need the OpenAI-direct
    branch.
    """
    return openai.AsyncAzureOpenAI(
        api_key=api_key,
        azure_endpoint=azure_endpoint,
        api_version=api_version,
    )


_DEFAULT_API_VERSION = '2025-04-01-preview'


async def get_sherlock_azure_client(
    *,
    tenant_id: uuid.UUID | str,
    user_id: uuid.UUID | str,
) -> openai.AsyncAzureOpenAI:
    """Build a tenant-scoped AsyncAzureOpenAI client for one Sherlock turn.

    Reads creds from the per-tenant + per-user LLM settings row via
    ``get_llm_settings_from_db``. Caller passes ``provider_override='azure_openai'``
    implicitly because v3 is Azure-locked. Result is **not cached** — each
    turn opens a fresh client to honor mid-session credential rotation;
    the SDK is cheap to construct (the underlying ``httpx`` pool is what
    actually matters for connection reuse and is per-AsyncClient).
    """
    creds = await get_llm_settings_from_db(
        tenant_id=tenant_id,
        user_id=user_id,
        provider_override='azure_openai',
        auth_intent='interactive',
    )
    if creds.get('provider') != 'azure_openai':
        raise RuntimeError(
            'Sherlock v3 requires the resolved provider to be azure_openai; got '
            f'{creds.get("provider")!r}. Configure Azure OpenAI in LLM settings '
            'for this tenant/user before enabling Sherlock v3.',
        )

    return _create_azure_client(
        api_key=creds.get('api_key', ''),
        azure_endpoint=creds.get('azure_endpoint', ''),
        api_version=creds.get('api_version', _DEFAULT_API_VERSION),
    )


def supervisor_model() -> str:
    """Azure deployment name for the supervisor agent."""
    return os.getenv('SHERLOCK_SUPERVISOR_MODEL', 'ai-evals-gpt-5.4')


def specialist_model() -> str:
    """Azure deployment name for specialist agents."""
    return os.getenv('SHERLOCK_SPECIALIST_MODEL', 'ai-evals-gpt-5.4-mini')
