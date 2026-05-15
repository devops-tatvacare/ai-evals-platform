"""Admin control plane for per-tenant LLM provider credentials.

Gated by ``configuration:edit``, tenant-scoped via ``auth.tenant_id``.

- GET ``/api/admin/ai-settings/providers``: list one entry per supported
  provider; rows that don't exist surface as disabled placeholders.
- PUT ``/api/admin/ai-settings/providers/{provider}``: upsert. A blank
  ``apiKey`` preserves the stored ciphertext; supplying a new key resets
  ``validation_status`` to ``"untested"``.

GET / PUT responses NEVER carry the API key — only ``hasApiKey: bool``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, require_permission
from app.database import get_db
from app.models.tenant_llm_provider import TenantLlmProvider
from app.schemas.ai_settings import (
    SUPPORTED_PROVIDERS,
    ProviderConfigResponse,
    ProviderConfigUpsert,
)
from app.services.llm_credentials import invalidate_cache
from app.services.llm_credentials.crypto import encrypt_secret


router = APIRouter(prefix="/api/admin/ai-settings", tags=["admin-ai-settings"])


def _to_response(provider: str, row: TenantLlmProvider | None) -> ProviderConfigResponse:
    if row is None:
        return ProviderConfigResponse(
            provider=provider,
            is_enabled=False,
            has_api_key=False,
            base_url=None,
            extra_config={},
            curated_models=[],
            validation_status="untested",
            last_validated_at=None,
        )
    return ProviderConfigResponse(
        provider=provider,
        is_enabled=row.is_enabled,
        has_api_key=bool(row.api_key_encrypted),
        base_url=row.base_url,
        extra_config=dict(row.extra_config or {}),
        curated_models=list(row.curated_models or []),
        validation_status=row.validation_status,
        last_validated_at=row.last_validated_at,
    )


@router.get("/providers", response_model=list[ProviderConfigResponse])
async def list_providers(
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    rows = {
        r.provider: r
        for r in (
            await db.execute(
                select(TenantLlmProvider).where(
                    TenantLlmProvider.tenant_id == auth.tenant_id,
                )
            )
        ).scalars()
    }
    return [_to_response(p, rows.get(p)) for p in SUPPORTED_PROVIDERS]


@router.put("/providers/{provider}", response_model=ProviderConfigResponse)
async def upsert_provider(
    body: ProviderConfigUpsert,
    provider: str = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    row = (
        await db.execute(
            select(TenantLlmProvider).where(
                TenantLlmProvider.tenant_id == auth.tenant_id,
                TenantLlmProvider.provider == provider,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = TenantLlmProvider(tenant_id=auth.tenant_id, provider=provider)
        db.add(row)

    row.is_enabled = body.is_enabled
    row.base_url = body.base_url
    row.extra_config = body.extra_config or {}
    row.curated_models = list(body.curated_models or [])
    row.updated_by = auth.user_id
    if body.api_key:
        row.api_key_encrypted = encrypt_secret(body.api_key)
        row.validation_status = "untested"

    await db.commit()
    await db.refresh(row)
    invalidate_cache(auth.tenant_id, provider)
    return _to_response(provider, row)
