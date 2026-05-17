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
    ModelSearchRequest,
    ModelSearchResponse,
    ProviderConfigResponse,
    ProviderConfigUpsert,
    ValidateResponse,
)
from app.services.llm_credentials import (
    ProviderNotConfiguredError,
    invalidate_cache,
    resolve_llm_credentials,
)
from app.services.llm_credentials.crypto import (
    LlmCredentialCryptoError,
    decrypt_secret,
    encrypt_secret,
)
from app.services.llm_model_discovery import (
    list_models_for_provider,
    validate_azure_credentials,
)
from app.utils.secret_masking import mask_secret_value


router = APIRouter(prefix="/api/admin/ai-settings", tags=["admin-ai-settings"])


def _api_key_preview(row: TenantLlmProvider) -> str | None:
    """Decrypt the stored key just long enough to mask it.

    The plaintext lives only inside this function. The mask uses the same
    ``XYZA••••WXYZ`` format as orchestration connections so both admin
    surfaces look consistent.
    """
    if not row.api_key_encrypted:
        return None
    try:
        plaintext = decrypt_secret(row.api_key_encrypted)
    except LlmCredentialCryptoError:
        return None
    masked = mask_secret_value(plaintext)
    return masked or None


def _to_response(provider: str, row: TenantLlmProvider | None) -> ProviderConfigResponse:
    if row is None:
        return ProviderConfigResponse(
            provider=provider,
            is_enabled=False,
            has_api_key=False,
            api_key_preview=None,
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
        api_key_preview=_api_key_preview(row),
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


@router.post(
    "/providers/{provider}/discover-models",
    response_model=ModelSearchResponse,
)
async def discover_models(
    body: ModelSearchRequest,
    provider: str = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")
    try:
        creds = await resolve_llm_credentials(db, auth.tenant_id, provider)
    except ProviderNotConfiguredError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        models = await list_models_for_provider(provider, creds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    search = (body.search or "").strip().lower()
    if search:
        models = [m for m in models if search in m.lower()]
    return ModelSearchResponse(models=models)


@router.post(
    "/providers/{provider}/validate",
    response_model=ValidateResponse,
)
async def validate_provider(
    provider: str = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone

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
        raise HTTPException(
            status_code=404, detail=f"Provider {provider} not configured"
        )

    detail: str | None = None
    try:
        creds = await resolve_llm_credentials(db, auth.tenant_id, provider)
        if provider == "azure_openai":
            # Azure has no public key-based listing — call the resource
            # directly so an empty deployment list can't pass validation.
            await validate_azure_credentials(creds)
        else:
            await list_models_for_provider(provider, creds)
        row.validation_status = "ok"
    except (ProviderNotConfiguredError, ValueError) as exc:
        row.validation_status = "invalid"
        detail = str(exc)[:300]
    row.last_validated_at = datetime.now(timezone.utc)
    await db.commit()
    invalidate_cache(auth.tenant_id, provider)
    return ValidateResponse(validation_status=row.validation_status, detail=detail)
