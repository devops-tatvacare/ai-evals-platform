"""LLM-related API endpoints — model discovery and auth status."""
import asyncio
import logging
import os
from typing import Literal, Optional

from fastapi import APIRouter, Depends

from app.auth.context import AuthContext, get_auth_context
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
    deployments: Optional[str] = None    # Azure only — comma/newline-separated deployment names


# ── Routes ───────────────────────────────────────────────────────


@router.get("/auth-status")
async def auth_status(_auth: AuthContext = Depends(get_auth_context)):
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
async def discover_models(
    body: DiscoverModelsRequest,
    auth: AuthContext = Depends(get_auth_context),
):
    """Unified model discovery — accepts unsaved credentials in the request body."""
    if body.provider == "gemini":
        return await _discover_gemini_models(auth=auth, api_key_override=body.api_key)
    if body.provider == "openai":
        return await _discover_openai_models(auth=auth, api_key_override=body.api_key)
    if body.provider == "azure_openai":
        return await _discover_azure_openai_models(auth=auth, deployments_override=body.deployments)
    if body.provider == "anthropic":
        return await _discover_anthropic_models(auth=auth, api_key_override=body.api_key)
    return {"error": f"Model discovery not supported for provider: {body.provider}"}


@router.get("/models")
async def list_models(
    provider: str = "gemini",
    auth: AuthContext = Depends(get_auth_context),
):
    """Server-side model discovery (backward compat for runners / non-interactive callers)."""
    if provider == "gemini":
        return await _discover_gemini_models(auth=auth)
    if provider == "openai":
        return await _discover_openai_models(auth=auth)
    if provider == "azure_openai":
        return await _discover_azure_openai_models(auth=auth)
    if provider == "anthropic":
        return await _discover_anthropic_models(auth=auth)
    return {"error": f"Model discovery not supported for provider: {provider}"}


# ── Provider discovery implementations ───────────────────────────


async def _discover_azure_openai_models(
    auth: Optional[AuthContext] = None,
    deployments_override: Optional[str] = None,
) -> list[dict]:
    """Return configured Azure OpenAI deployments as model entries.

    Azure has no public API-key-based listing for deployments (ARM only,
    requires Azure AD). So we return whatever the user configured in Settings:
    ``azureOpenaiDeployments`` (comma- or newline-separated), falling back to
    the ``AZURE_OPENAI_MODEL`` env var.

    Resolution order: request override → DB settings → env fallback.
    """
    raw: str = ""
    if deployments_override:
        raw = deployments_override
    elif auth:
        from app.database import async_session
        from app.services.llm_credentials import (
            ProviderNotConfiguredError,
            resolve_llm_credentials,
        )
        try:
            async with async_session() as db:
                creds = await resolve_llm_credentials(db, auth.tenant_id, "azure_openai")
            deployments = creds.extra_config.get("deployments") or []
            if isinstance(deployments, list):
                raw = ",".join(deployments)
            elif isinstance(deployments, str):
                raw = deployments
        except ProviderNotConfiguredError:
            pass
        except Exception as e:
            logger.warning("Azure deployments lookup failed: %s", e)

    # Parse comma or newline separated, trim, drop blanks, dedupe preserving order.
    seen: set[str] = set()
    names: list[str] = []
    for chunk in raw.replace("\n", ",").split(","):
        name = chunk.strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)

    return [
        {
            "name": n,
            "displayName": n,
            "inputTokenLimit": 128000,
            "outputTokenLimit": 16384,
        }
        for n in names
    ]


async def _discover_anthropic_models(
    auth: Optional[AuthContext] = None,
    api_key_override: Optional[str] = None,
) -> list[dict]:
    """Discover Anthropic models via the real API, with hardcoded fallback."""
    FALLBACK = [
        {"name": "claude-sonnet-4-6", "displayName": "Claude Sonnet 4.6", "inputTokenLimit": 200000, "outputTokenLimit": 64000},
        {"name": "claude-opus-4-6", "displayName": "Claude Opus 4.6", "inputTokenLimit": 200000, "outputTokenLimit": 32000},
        {"name": "claude-haiku-4-5", "displayName": "Claude Haiku 4.5", "inputTokenLimit": 200000, "outputTokenLimit": 8192},
    ]

    # Resolve API key: override → DB → env
    api_key = api_key_override
    if not api_key:
        api_key = await _get_provider_key_from_db("anthropic", auth=auth)
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


async def _discover_openai_models(
    auth: Optional[AuthContext] = None,
    api_key_override: Optional[str] = None,
) -> list[dict]:
    """Discover OpenAI models via the real API, with fallback list."""
    FALLBACK = [
        {"name": "gpt-4o", "displayName": "GPT-4o", "inputTokenLimit": 128000, "outputTokenLimit": 16384},
        {"name": "gpt-5.4-mini", "displayName": "GPT-5.4 Mini", "inputTokenLimit": 128000, "outputTokenLimit": 16384},
        {"name": "gpt-4o-audio-preview", "displayName": "GPT-4o Audio Preview", "inputTokenLimit": 128000, "outputTokenLimit": 16384},
    ]

    # Resolve API key: override → DB → env
    api_key = api_key_override
    if not api_key:
        api_key = await _get_provider_key_from_db("openai", auth=auth)
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


async def _discover_gemini_models(
    auth: Optional[AuthContext] = None,
    api_key_override: Optional[str] = None,
) -> list[dict]:
    """Discover Gemini models using server credentials or an API key override."""
    if api_key_override:
        try:
            from google import genai
            client = genai.Client(api_key=api_key_override)
            return await asyncio.to_thread(_parse_gemini_model_list, client)
        except Exception as e:
            logger.error("Gemini discovery with override key failed: %s", e)
            return []

    # DB credentials → service account → env API key
    if not auth:
        return []
    try:
        from app.database import async_session
        from app.services.llm_credentials import (
            ProviderNotConfiguredError,
            resolve_llm_credentials,
        )
        async with async_session() as db:
            creds = await resolve_llm_credentials(db, auth.tenant_id, "gemini")
    except ProviderNotConfiguredError:
        return []
    except Exception as e:
        logger.warning("Could not load LLM credentials for model discovery: %s", e)
        return []

    sa_path = creds.service_account_path or ""
    api_key = creds.api_key

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

        return await asyncio.to_thread(_parse_gemini_model_list, client)

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


async def _get_provider_key_from_db(
    provider: str,
    auth: Optional[AuthContext] = None,
) -> str:
    """Read a provider's API key from tenant_llm_providers. Returns '' on failure."""
    if not auth:
        return ""
    from app.database import async_session
    from app.services.llm_credentials import (
        ProviderNotConfiguredError,
        resolve_llm_credentials,
    )
    try:
        async with async_session() as db:
            creds = await resolve_llm_credentials(db, auth.tenant_id, provider)
        return creds.api_key
    except ProviderNotConfiguredError:
        return ""
    except Exception:
        return ""
