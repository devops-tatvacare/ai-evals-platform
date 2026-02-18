"""Helper to read LLM settings from the database settings table.

Used by job handlers to resolve API keys at runtime rather than requiring
them in job params (avoids storing secrets in the jobs table).
"""
import logging
import os
from typing import Optional

from sqlalchemy import select

from app.database import async_session
from app.models.setting import Setting

logger = logging.getLogger(__name__)


def _detect_service_account_path() -> str:
    """Auto-detect service account from env. Returns path if valid, else ''."""
    from app.config import settings as app_settings
    sa_path = app_settings.GEMINI_SERVICE_ACCOUNT_PATH
    if sa_path and os.path.isfile(sa_path):
        return sa_path
    return ""


async def get_llm_settings_from_db(
    app_id: Optional[str] = None,
    key: str = "llm-settings",
    auth_intent: str = "interactive",
) -> dict:
    """Read LLM settings from the settings table.

    Returns dict with keys: api_key, provider, selected_model,
    auth_method, service_account_path.

    Auto-detects service account from GEMINI_SERVICE_ACCOUNT_PATH env.
    Both api_key and service_account_path can coexist.
    Raises RuntimeError if NEITHER is available.
    """
    async with async_session() as db:
        query = select(Setting).where(Setting.key == key)
        # app_id is stored as empty string (not NULL) for global settings
        resolved_app_id = app_id or ""
        query = query.where(Setting.app_id == resolved_app_id)
        result = await db.execute(query)
        setting = result.scalar_one_or_none()

        # Fallback: if empty string query returned nothing, try NULL
        if not setting and resolved_app_id == "":
            query_null = select(Setting).where(
                Setting.key == key,
                Setting.app_id.is_(None),
            )
            result_null = await db.execute(query_null)
            setting = result_null.scalar_one_or_none()

    if not setting or not setting.value:
        raise RuntimeError(
            "No LLM settings found in database. "
            "Go to Settings to configure your API key."
        )

    value = setting.value
    provider = value.get("provider", "gemini")

    # New format: per-provider API keys (geminiApiKey, openaiApiKey)
    if "geminiApiKey" in value or "openaiApiKey" in value:
        if provider == "openai":
            api_key = value.get("openaiApiKey", "")
        else:
            api_key = value.get("geminiApiKey") or value.get("apiKey", "")
        selected_model = value.get("selectedModel", "")
    elif "apiKey" in value:
        # Legacy format: single apiKey at top level
        api_key = value.get("apiKey", "")
        selected_model = value.get("selectedModel", "")
    else:
        # Old nested format (pre-migration)
        llm = value.get("llm", {})
        api_key = llm.get("apiKey", "")
        provider = llm.get("provider", "gemini")
        selected_model = llm.get("selectedModel", "")

    # Auto-detect service account
    service_account_path = ""
    auth_method = "api_key"

    if provider == "gemini":
        service_account_path = _detect_service_account_path()

        if auth_intent == "managed_job":
            # Managed jobs: prefer SA (strict), fallback to API key
            if service_account_path:
                auth_method = "service_account"
                api_key = ""  # strict SA-only, no fallback
            elif api_key:
                auth_method = "api_key"
            else:
                raise RuntimeError(
                    "No credentials for managed job. "
                    "Configure a service account on the server or add an API key in Settings."
                )
        else:
            # Interactive: prefer API key (browser-side features)
            if api_key:
                auth_method = "api_key"
            elif service_account_path:
                auth_method = "service_account"

    # Raise only if NEITHER credential source is available
    if not api_key and not service_account_path:
        raise RuntimeError(
            f"No credentials configured for {provider}. "
            "Add an API key in Settings or configure a service account on the server."
        )

    return {
        "api_key": api_key,
        "provider": provider,
        "selected_model": selected_model,
        "auth_method": auth_method,
        "service_account_path": service_account_path,
    }
