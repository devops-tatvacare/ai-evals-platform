"""Helper to read LLM settings from the database settings table.

Used by job handlers to resolve API keys at runtime rather than requiring
them in job params (avoids storing secrets in the jobs table).
"""
import logging
from typing import Optional

from sqlalchemy import select

from app.database import async_session
from app.models.setting import Setting

logger = logging.getLogger(__name__)


async def get_llm_settings_from_db(
    app_id: Optional[str] = None,
    key: str = "llm-settings",
) -> dict:
    """Read LLM settings from the settings table.

    Returns dict with keys: api_key, provider, selected_model.
    Raises RuntimeError if no API key is configured.
    """
    async with async_session() as db:
        query = select(Setting).where(Setting.key == key)
        # app_id is stored as empty string (not NULL) for global settings
        resolved_app_id = app_id or ""
        query = query.where(Setting.app_id == resolved_app_id)
        result = await db.execute(query)
        setting = result.scalar_one_or_none()

    if not setting or not setting.value:
        raise RuntimeError(
            "No LLM settings found in database. "
            "Go to Settings to configure your API key."
        )

    value = setting.value
    # New format: fields are at top level (no "llm" wrapper)
    # Fallback to old nested format for backwards compat during transition
    if "apiKey" in value:
        api_key = value.get("apiKey", "")
        provider = value.get("provider", "gemini")
        selected_model = value.get("selectedModel", "")
    else:
        llm = value.get("llm", {})
        api_key = llm.get("apiKey", "")
        provider = llm.get("provider", "gemini")
        selected_model = llm.get("selectedModel", "")

    if not api_key:
        raise RuntimeError(
            f"No API key configured for {provider}. "
            "Go to Settings to add your API key."
        )

    return {
        "api_key": api_key,
        "provider": provider,
        "selected_model": selected_model,
    }
