"""AsyncAzureOpenAI client construction for Sherlock v3.

Provider lock per architecture spec §8 (Azure OpenAI). Reuses the existing
``create_openai_client`` helper from the v2 adapter so the provider story
stays in one place — Sherlock just calls it with ``azure=True`` and the
configured deployment names.
"""
from __future__ import annotations

import os
from functools import lru_cache

import openai

from app.services.chat_engine.openai_agents_adapter import create_openai_client


def _required(env_var: str) -> str:
    value = os.getenv(env_var)
    if not value:
        raise RuntimeError(
            f'Sherlock v3 requires {env_var} to be set in the environment. '
            'See docs/specs/2026-04-26-sherlock-v3-architecture.md §8.',
        )
    return value


@lru_cache(maxsize=1)
def get_sherlock_azure_client() -> openai.AsyncAzureOpenAI:
    """One process-wide AsyncAzureOpenAI client for Sherlock v3.

    LRU-cached to one instance — repeatedly constructing AsyncAzureOpenAI
    objects allocates a fresh httpx pool each time. The cache lives for the
    process lifetime; on env changes (which require a restart anyway), the
    next process picks up the new values.
    """
    client = create_openai_client(
        api_key=_required('AZURE_OPENAI_API_KEY'),
        azure=True,
        azure_endpoint=_required('AZURE_OPENAI_ENDPOINT'),
        api_version=os.getenv('AZURE_OPENAI_API_VERSION', '2025-04-01-preview'),
    )
    # ``create_openai_client`` returns the union AsyncOpenAI; cast for callers.
    assert isinstance(client, openai.AsyncAzureOpenAI), (
        'Sherlock v3 expects azure=True; got AsyncOpenAI from create_openai_client'
    )
    return client


def supervisor_model() -> str:
    return os.getenv('SHERLOCK_SUPERVISOR_MODEL', 'ai-evals-gpt-5.4')


def specialist_model() -> str:
    return os.getenv('SHERLOCK_SPECIALIST_MODEL', 'ai-evals-gpt-5.4-mini')
