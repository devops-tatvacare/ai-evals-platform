"""LLM-related API endpoints — model discovery and auth status."""
import logging
import os

from fastapi import APIRouter

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.get("/auth-status")
async def auth_status():
    """Check whether service account auth is configured on the server."""
    sa_path = settings.GEMINI_SERVICE_ACCOUNT_PATH
    sa_configured = bool(sa_path and os.path.isfile(sa_path))

    return {
        "serviceAccountConfigured": sa_configured,
    }


@router.get("/models")
async def list_models(provider: str = "gemini"):
    """Server-side model discovery — works with both API key and service account."""
    if provider == "gemini":
        return await _discover_gemini_models()
    return {"error": f"Model discovery not supported for provider: {provider}"}


async def _discover_gemini_models() -> list[dict]:
    """Discover Gemini models using server credentials."""
    try:
        from app.services.evaluators.settings_helper import get_llm_settings_from_db
        db_settings = await get_llm_settings_from_db()
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

        models = []
        for model in client.models.list():
            if not model.name or "gemini" not in model.name:
                continue
            # Skip embedding-only models
            if "embedding" in model.name:
                continue
            # Normalize name: strip "models/" (AI API) or "publishers/google/models/" (Vertex AI)
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

    except Exception as e:
        logger.error("Model discovery failed: %s", e)
        return []
