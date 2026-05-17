"""LLM-related API endpoints — auth status only.

Phase 3 deleted the runtime `/discover-models` + `/models` routes plus all
of their per-provider helpers. Admin-side discovery lives at
`/api/admin/ai-settings/providers/{p}/discover-models` and is the only
discovery surface end users (or admins) hit. Runtime callers select models
through ``/api/llm/models?call_site=…`` (Phase 2) which reads the catalog
and per-call-site defaults.
"""
import logging
import os

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.config import settings
from app.database import get_db
from app.models.tenant_llm_credential import TenantLlmCredential

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/llm", tags=["llm"])


# ── Routes ───────────────────────────────────────────────────────


@router.get("/auth-status")
async def auth_status(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Report which providers the tenant has configured.

    Reads ``platform.tenant_llm_credentials`` for the caller's tenant; any
    enabled row (under any credential ``name``) counts as available.
    ``serviceAccountConfigured`` still reflects the system-tenant Gemini SA
    fallback path.
    """
    sa_path = settings.GEMINI_SERVICE_ACCOUNT_PATH
    sa_configured = bool(sa_path and os.path.isfile(sa_path))

    providers: dict[str, bool] = {
        "gemini": False,
        "openai": False,
        "azure_openai": False,
        "anthropic": False,
        "vertex": False,
        "bedrock": False,
    }
    rows = (
        await db.execute(
            select(TenantLlmCredential.provider).where(
                TenantLlmCredential.tenant_id == auth.tenant_id,
                TenantLlmCredential.is_enabled.is_(True),
            )
        )
    ).scalars().all()
    for name in rows:
        if name in providers:
            providers[name] = True
    if sa_configured:
        providers["gemini"] = True

    return {
        "serviceAccountConfigured": sa_configured,
        "providers": providers,
    }


