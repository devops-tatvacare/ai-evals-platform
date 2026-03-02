"""LLM-related API endpoints — model discovery and auth status."""
import asyncio
import logging
import os
from typing import Literal, Optional

from fastapi import APIRouter

from app.config import settings
from app.schemas.base import CamelModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/llm", tags=["llm"])


# ── Request schemas ──────────────────────────────────────────────


class DiscoverModelsRequest(CamelModel):
    """Frontend sends camelCase (apiKey, etc.); CamelModel maps to snake_case."""
    provider: Literal["gemini", "openai", "azure_openai", "anthropic"]
    api_key: Optional[str] = None
    endpoint: Optional[str] = None       # Azure only
    api_version: Optional[str] = None    # Azure only


# ── Routes ───────────────────────────────────────────────────────


@router.get("/auth-status")
async def auth_status():
    """Check whether service account auth is configured on the server."""
    sa_path = settings.GEMINI_SERVICE_ACCOUNT_PATH
    sa_configured = bool(sa_path and os.path.isfile(sa_path))

    return {
        "serviceAccountConfigured": sa_configured,
        "providers": {
            "gemini": bool(settings.GEMINI_API_KEY or sa_configured),
            "openai": bool(settings.OPENAI_API_KEY),
            "azure_openai": bool(settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_ENDPOINT),
            "anthropic": bool(settings.ANTHROPIC_API_KEY),
        },
    }


@router.post("/discover-models")
async def discover_models(body: DiscoverModelsRequest):
    """Unified model discovery — accepts unsaved credentials in the request body."""
    if body.provider == "gemini":
        return await _discover_gemini_models(api_key_override=body.api_key)
    if body.provider == "openai":
        return await _discover_openai_models(api_key_override=body.api_key)
    if body.provider == "azure_openai":
        return _discover_azure_openai_models()
    if body.provider == "anthropic":
        return await _discover_anthropic_models(api_key_override=body.api_key)
    return {"error": f"Model discovery not supported for provider: {body.provider}"}


@router.get("/models")
async def list_models(provider: str = "gemini"):
    """Server-side model discovery (backward compat for runners / non-interactive callers)."""
    if provider == "gemini":
        return await _discover_gemini_models()
    if provider == "openai":
        return await _discover_openai_models()
    if provider == "azure_openai":
        return _discover_azure_openai_models()
    if provider == "anthropic":
        return await _discover_anthropic_models()
    return {"error": f"Model discovery not supported for provider: {provider}"}


# ── Provider discovery implementations ───────────────────────────


def _discover_azure_openai_models() -> list[dict]:
    """Return configured Azure OpenAI deployment as a model entry.

    Azure doesn't have a model listing API — the deployment name IS the model.
    """
    model = settings.AZURE_OPENAI_MODEL
    if not model:
        return []
    return [{
        "name": model,
        "displayName": model,
        "inputTokenLimit": 128000,
        "outputTokenLimit": 16384,
    }]


async def _discover_anthropic_models(api_key_override: Optional[str] = None) -> list[dict]:
    """Discover Anthropic models via the real API, with hardcoded fallback."""
    FALLBACK = [
        {"name": "claude-sonnet-4-6", "displayName": "Claude Sonnet 4.6", "inputTokenLimit": 200000, "outputTokenLimit": 64000},
        {"name": "claude-opus-4-6", "displayName": "Claude Opus 4.6", "inputTokenLimit": 200000, "outputTokenLimit": 32000},
        {"name": "claude-haiku-4-5", "displayName": "Claude Haiku 4.5", "inputTokenLimit": 200000, "outputTokenLimit": 8192},
    ]

    # Resolve API key: override → DB → env
    api_key = api_key_override
    if not api_key:
        api_key = await _get_provider_key_from_db("anthropic")
    if not api_key:
        api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        return FALLBACK

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        raw_models = await asyncio.to_thread(lambda: list(client.models.list()))
        models = []
        for m in raw_models:
            models.append({
                "name": m.id,
                "displayName": getattr(m, "display_name", m.id) or m.id,
                "inputTokenLimit": getattr(m, "input_token_limit", 200000) or 200000,
                "outputTokenLimit": getattr(m, "output_token_limit", 8192) or 8192,
            })
        models.sort(key=lambda x: x["name"])
        return models if models else FALLBACK
    except Exception as e:
        logger.warning("Anthropic model discovery failed, using fallback: %s", e)
        return FALLBACK


async def _discover_openai_models(api_key_override: Optional[str] = None) -> list[dict]:
    """Discover OpenAI models via the real API, with fallback list."""
    FALLBACK = [
        {"name": "gpt-4o", "displayName": "GPT-4o", "inputTokenLimit": 128000, "outputTokenLimit": 16384},
        {"name": "gpt-4o-mini", "displayName": "GPT-4o Mini", "inputTokenLimit": 128000, "outputTokenLimit": 16384},
        {"name": "gpt-4o-audio-preview", "displayName": "GPT-4o Audio Preview", "inputTokenLimit": 128000, "outputTokenLimit": 16384},
    ]

    # Resolve API key: override → DB → env
    api_key = api_key_override
    if not api_key:
        api_key = await _get_provider_key_from_db("openai")
    if not api_key:
        api_key = settings.OPENAI_API_KEY
    if not api_key:
        return FALLBACK

    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        raw_models = await asyncio.to_thread(lambda: list(client.models.list()))
        models = []
        for m in raw_models:
            mid = m.id
            if any(fam in mid for fam in ("gpt-4o", "gpt-4", "o1", "o3")):
                models.append({
                    "name": mid,
                    "displayName": mid,
                    "inputTokenLimit": 128000,
                    "outputTokenLimit": 16384,
                })
        models.sort(key=lambda x: x["name"])
        return models if models else FALLBACK
    except Exception as e:
        logger.warning("OpenAI model discovery failed, using fallback: %s", e)
        return FALLBACK


async def _discover_gemini_models(api_key_override: Optional[str] = None) -> list[dict]:
    """Discover Gemini models using server credentials or an API key override."""
    if api_key_override:
        try:
            from google import genai
            client = genai.Client(api_key=api_key_override)
            return _parse_gemini_model_list(client)
        except Exception as e:
            logger.error("Gemini discovery with override key failed: %s", e)
            return []

    # DB settings → service account → env API key
    try:
        from app.services.evaluators.settings_helper import get_llm_settings_from_db
        db_settings = await get_llm_settings_from_db(provider_override="gemini")
    except Exception as e:
        logger.warning("Could not load LLM settings for model discovery: %s", e)
        return []

    sa_path = db_settings.get("service_account_path", "")
    api_key = db_settings.get("api_key", "")

    try:
        from google import genai

        if sa_path and os.path.isfile(sa_path):
            import json as _json
            from google.oauth2 import service_account
            with open(sa_path) as f:
                sa_info = _json.load(f)
            project_id = sa_info.get("project_id", "")
            creds = service_account.Credentials.from_service_account_file(
                sa_path,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
            client = genai.Client(
                vertexai=True, project=project_id, credentials=creds,
            )
        elif api_key:
            client = genai.Client(api_key=api_key)
        else:
            return []

        return _parse_gemini_model_list(client)

    except Exception as e:
        logger.error("Model discovery failed: %s", e)
        return []


def _parse_gemini_model_list(client) -> list[dict]:
    """Extract generative Gemini models from a genai client."""
    models = []
    for model in client.models.list():
        if not model.name or "gemini" not in model.name:
            continue
        if "embedding" in model.name:
            continue
        name = model.name
        for prefix in ("publishers/google/models/", "publishers/google/", "models/"):
            if name.startswith(prefix):
                name = name[len(prefix):]
                break
        display = model.display_name or name
        for prefix in ("publishers/google/models/", "publishers/google/", "models/"):
            if display.startswith(prefix):
                display = display[len(prefix):]
                break
        models.append({
            "name": name,
            "displayName": display,
            "inputTokenLimit": model.input_token_limit,
            "outputTokenLimit": model.output_token_limit,
        })

    models.sort(key=lambda m: m["name"])
    return models


# ── Helpers ──────────────────────────────────────────────────────


async def _get_provider_key_from_db(provider: str) -> str:
    """Try to read a provider's API key from the DB settings table. Returns '' on failure."""
    try:
        from app.services.evaluators.settings_helper import get_llm_settings_from_db
        db_settings = await get_llm_settings_from_db(provider_override=provider)
        return db_settings.get("api_key", "")
    except Exception:
        pass
    return ""
