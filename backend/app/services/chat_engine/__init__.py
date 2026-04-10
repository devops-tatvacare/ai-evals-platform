"""
Provider-native chat engine.
Each session is locked to one provider. Messages stored in native SDK format.
"""
from __future__ import annotations

from typing import Any

from app.services.chat_engine.types import ChatAdapter, ToolCall
from app.services.chat_engine.runner import run_tool_loop


def get_adapter_class(provider: str) -> type:
    """Return the adapter class for a provider. Does not instantiate."""
    from app.services.chat_engine.gemini_adapter import GeminiAdapter
    from app.services.chat_engine.openai_adapter import OpenAIAdapter

    mapping: dict[str, type] = {
        "gemini": GeminiAdapter,
        "openai": OpenAIAdapter,
        "azure_openai": OpenAIAdapter,
    }
    cls = mapping.get(provider)
    if not cls:
        raise ValueError(f"Unsupported provider: {provider}")
    return cls


async def create_adapter(
    provider: str,
    model: str,
    tenant_id: str,
    user_id: str,
) -> ChatAdapter:
    """Resolve credentials and return a ready-to-use adapter instance."""
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    from app.services.chat_engine.gemini_adapter import GeminiAdapter
    from app.services.chat_engine.openai_adapter import OpenAIAdapter

    creds = await get_llm_settings_from_db(
        tenant_id=tenant_id, user_id=user_id,
        provider_override=provider, auth_intent="interactive",
    )

    if provider == "gemini":
        return GeminiAdapter(
            model=model,
            api_key=creds.get("api_key", ""),
            service_account_path=creds.get("service_account_path", ""),
        )

    if provider not in ("openai", "azure_openai"):
        raise ValueError(f"Unsupported provider: {provider}. Supported: gemini, openai, azure_openai")

    azure = provider == "azure_openai"
    return OpenAIAdapter(
        model=model,
        api_key=creds.get("api_key", ""),
        azure=azure,
        azure_endpoint=creds.get("azure_endpoint", "") if azure else "",
        api_version=creds.get("api_version", "2025-03-01-preview") if azure else "",
    )
