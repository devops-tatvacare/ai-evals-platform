"""Admin control plane for per-tenant LLM provider credentials.

Two surfaces in this module:

**Bridge GET** (legacy summary view, still consumed by 8 frontend pages for
``credentialsOk`` gating — "does this tenant have any working credential
for provider X?"):

- GET  ``/api/admin/ai-settings/providers``

The bridge upsert / validate / discover-models endpoints were removed
once Phase 3's ``MultiCredentialPanel`` shipped — every mutation now goes
through the per-credential surface below.

**Multi-credential surface** (per-credential CRUD + Azure deployments):

- GET    ``/api/admin/ai-settings/providers/{provider}/credentials``
- POST   ``/api/admin/ai-settings/providers/{provider}/credentials``
- PATCH  ``/api/admin/ai-settings/providers/{provider}/credentials/{id}``
- DELETE ``/api/admin/ai-settings/providers/{provider}/credentials/{id}``
- POST   ``/api/admin/ai-settings/credentials/{id}/validate``
- POST   ``/api/admin/ai-settings/credentials/{id}/discover-models``
- GET    ``/api/admin/ai-settings/credentials/{id}/deployments``
- POST   ``/api/admin/ai-settings/credentials/{id}/deployments``
- PATCH  ``/api/admin/ai-settings/deployments/{id}``
- DELETE ``/api/admin/ai-settings/deployments/{id}``

Gated by ``configuration:edit``, tenant-scoped via ``auth.tenant_id``.

Responses NEVER carry plaintext secrets — only ``secretPreview`` /
``apiKeyPreview``. Blank ``secret`` values on PATCH preserve the stored
value (mirrors orchestration connections semantics).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, require_permission
from app.database import get_db
from app.models.cost import RefLlmModelsCatalog
from app.models.tenant_llm_credential import TenantLlmCredential
from app.models.tenant_llm_deployment import TenantLlmDeployment
from app.schemas.ai_settings import (
    DEFAULT_CREDENTIAL_NAME,
    SUPPORTED_PROVIDERS,
    CredentialCreate,
    CredentialResponse,
    CredentialUpdate,
    DeploymentCreate,
    DeploymentResponse,
    DeploymentUpdate,
    ModelSearchRequest,
    ModelSearchResponse,
    ProviderConfigResponse,
    ValidateResponse,
)
from app.services.llm_credentials import (
    get_secret_preview,
    invalidate_cache,
    merge_secret_update,
    secret_has_value,
)
from app.services.llm_credentials.crypto import encrypt_json
from app.services.llm_model_discovery import (
    list_models_for_credential,
    validate_credentials,
)


router = APIRouter(prefix="/api/admin/ai-settings", tags=["admin-ai-settings"])


# ── Helpers ──────────────────────────────────────────────────────────


def _check_provider(provider: str) -> None:
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")


def _credential_to_response(row: TenantLlmCredential) -> CredentialResponse:
    return CredentialResponse(
        id=str(row.id),
        provider=row.provider,
        name=row.name,
        is_enabled=row.is_enabled,
        secret_preview=get_secret_preview(row),
        extra_config=dict(row.extra_config or {}),
        validation_status=row.validation_status,
        last_validated_at=row.last_validated_at,
    )


async def _all_credentials_for_provider(
    db: AsyncSession, tenant_id: uuid.UUID, provider: str
) -> list[TenantLlmCredential]:
    return list(
        (
            await db.execute(
                select(TenantLlmCredential)
                .where(
                    TenantLlmCredential.tenant_id == tenant_id,
                    TenantLlmCredential.provider == provider,
                )
                .order_by(TenantLlmCredential.name)
            )
        ).scalars().all()
    )


async def _get_credential_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, credential_id: uuid.UUID
) -> TenantLlmCredential:
    row = (
        await db.execute(
            select(TenantLlmCredential).where(
                TenantLlmCredential.id == credential_id,
                TenantLlmCredential.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="credential not found")
    return row


async def _get_deployment_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, deployment_id: uuid.UUID
) -> tuple[TenantLlmDeployment, TenantLlmCredential]:
    dep = (
        await db.execute(
            select(TenantLlmDeployment).where(TenantLlmDeployment.id == deployment_id)
        )
    ).scalar_one_or_none()
    if dep is None:
        raise HTTPException(status_code=404, detail="deployment not found")
    credential = await _get_credential_or_404(db, tenant_id, dep.credential_id)
    return dep, credential


def _deployment_to_response(
    dep: TenantLlmDeployment, canonical: RefLlmModelsCatalog | None = None
) -> DeploymentResponse:
    return DeploymentResponse(
        id=str(dep.id),
        credential_id=str(dep.credential_id),
        deployment_name=dep.deployment_name,
        canonical_model_id=str(dep.canonical_model_id) if dep.canonical_model_id else None,
        canonical_model=canonical.model if canonical else None,
        api_version_override=dep.api_version_override,
        enabled=dep.enabled,
        needs_mapping=dep.needs_mapping,
    )


async def _deployment_names_for_credential(
    db: AsyncSession, credential_id: uuid.UUID
) -> list[str]:
    rows = (
        await db.execute(
            select(TenantLlmDeployment.deployment_name)
            .where(TenantLlmDeployment.credential_id == credential_id)
            .order_by(TenantLlmDeployment.deployment_name)
        )
    ).scalars().all()
    return list(rows)


# ── Bridge GET (legacy summary, still consumed for credentialsOk gates) ─


async def _provider_summary(
    db: AsyncSession,
    provider: str,
    rows: list[TenantLlmCredential],
) -> ProviderConfigResponse:
    default_row = next(
        (r for r in rows if r.name == DEFAULT_CREDENTIAL_NAME), None
    )
    if default_row is None and rows:
        # No explicit "default" row but the tenant has credentials under other
        # names. Surface the most-recently-updated one so the summary stays
        # meaningful; full multi-credential admin runs through the per-credential
        # surface below.
        default_row = sorted(rows, key=lambda r: r.updated_at, reverse=True)[0]

    if default_row is None:
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
            credential_count=0,
            enabled_credential_count=0,
        )
    extra = dict(default_row.extra_config or {})
    curated: list[str] = []
    if provider == "azure_openai":
        curated = await _deployment_names_for_credential(db, default_row.id)
    return ProviderConfigResponse(
        provider=provider,
        is_enabled=default_row.is_enabled,
        has_api_key=secret_has_value(default_row),
        api_key_preview=get_secret_preview(default_row),
        base_url=extra.get("base_url"),
        extra_config=extra,
        curated_models=curated,
        validation_status=default_row.validation_status,
        last_validated_at=default_row.last_validated_at,
        credential_count=len(rows),
        enabled_credential_count=sum(1 for r in rows if r.is_enabled),
    )


@router.get("/providers", response_model=list[ProviderConfigResponse])
async def list_providers(
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    rows_by_provider: dict[str, list[TenantLlmCredential]] = {p: [] for p in SUPPORTED_PROVIDERS}
    for r in (
        await db.execute(
            select(TenantLlmCredential).where(
                TenantLlmCredential.tenant_id == auth.tenant_id,
            )
        )
    ).scalars():
        rows_by_provider.setdefault(r.provider, []).append(r)
    out = []
    for provider in SUPPORTED_PROVIDERS:
        out.append(await _provider_summary(db, provider, rows_by_provider.get(provider, [])))
    return out


# ── Per-credential surface ──────────────────────────────────────────


@router.get(
    "/providers/{provider}/credentials",
    response_model=list[CredentialResponse],
)
async def list_credentials(
    provider: str = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    _check_provider(provider)
    rows = await _all_credentials_for_provider(db, auth.tenant_id, provider)
    return [_credential_to_response(r) for r in rows]


@router.post(
    "/providers/{provider}/credentials",
    response_model=CredentialResponse,
    status_code=201,
)
async def create_credential(
    body: CredentialCreate,
    provider: str = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    _check_provider(provider)
    if not body.secret:
        raise HTTPException(status_code=400, detail="secret payload is required on create")
    # Sanity-check shape per provider: blank/missing required key = 400.
    if provider in {"openai", "anthropic", "azure_openai", "gemini"}:
        if not (body.secret.get("api_key") or "").strip():
            raise HTTPException(status_code=400, detail="secret.api_key is required")
    elif provider == "bedrock":
        if not (body.secret.get("access_key_id") or "").strip() or not (
            body.secret.get("secret_access_key") or ""
        ).strip():
            raise HTTPException(
                status_code=400,
                detail="secret.access_key_id and secret.secret_access_key are required",
            )
    elif provider == "vertex":
        if not (body.secret.get("service_account_json") or "").strip():
            raise HTTPException(
                status_code=400,
                detail="secret.service_account_json is required",
            )

    row = TenantLlmCredential(
        tenant_id=auth.tenant_id,
        provider=provider,
        name=(body.name or DEFAULT_CREDENTIAL_NAME).strip() or DEFAULT_CREDENTIAL_NAME,
        is_enabled=body.is_enabled,
        secret_blob_encrypted=encrypt_json(dict(body.secret)),
        extra_config=dict(body.extra_config or {}),
        updated_by=auth.user_id,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"credential name '{row.name}' already exists for {provider}",
        ) from exc
    await db.refresh(row)
    invalidate_cache(auth.tenant_id, provider, row.name)
    return _credential_to_response(row)


@router.patch(
    "/providers/{provider}/credentials/{credential_id}",
    response_model=CredentialResponse,
)
async def update_credential(
    body: CredentialUpdate,
    provider: str = Path(...),
    credential_id: uuid.UUID = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    _check_provider(provider)
    row = await _get_credential_or_404(db, auth.tenant_id, credential_id)
    if row.provider != provider:
        raise HTTPException(status_code=404, detail="credential not found")

    old_name = row.name
    if body.name is not None:
        new_name = body.name.strip() or DEFAULT_CREDENTIAL_NAME
        row.name = new_name
    if body.is_enabled is not None:
        row.is_enabled = body.is_enabled
    if body.extra_config is not None:
        row.extra_config = dict(body.extra_config)
    if body.secret is not None:
        # Blank/omitted keys preserve the stored value (mirrors orchestration).
        new_blob, rotated = merge_secret_update(row, dict(body.secret))
        row.secret_blob_encrypted = new_blob
        if rotated:
            row.validation_status = "untested"
    row.updated_by = auth.user_id
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"credential name '{row.name}' already exists for {provider}",
        ) from exc
    await db.refresh(row)
    invalidate_cache(auth.tenant_id, provider, old_name)
    invalidate_cache(auth.tenant_id, provider, row.name)
    return _credential_to_response(row)


@router.delete(
    "/providers/{provider}/credentials/{credential_id}",
    status_code=204,
)
async def delete_credential(
    provider: str = Path(...),
    credential_id: uuid.UUID = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    _check_provider(provider)
    row = await _get_credential_or_404(db, auth.tenant_id, credential_id)
    if row.provider != provider:
        raise HTTPException(status_code=404, detail="credential not found")

    # ``tenant_call_site_defaults`` does not exist until Phase 2's migration
    # 0051; the FK guard for it is added there. Deployments cascade via the
    # FK declared on tenant_llm_deployments, so we don't need to pre-check
    # — DELETE simply removes the credential and its child rows.
    await db.delete(row)
    await db.commit()
    invalidate_cache(auth.tenant_id, provider, row.name)
    return None


@router.post(
    "/credentials/{credential_id}/validate",
    response_model=ValidateResponse,
)
async def validate_credential(
    credential_id: uuid.UUID = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    row = await _get_credential_or_404(db, auth.tenant_id, credential_id)
    detail: str | None = None
    try:
        await validate_credentials(db, row)
        row.validation_status = "ok"
    except ValueError as exc:
        row.validation_status = "invalid"
        detail = str(exc)[:300]
    row.last_validated_at = datetime.now(timezone.utc)
    await db.commit()
    invalidate_cache(auth.tenant_id, row.provider, row.name)
    return ValidateResponse(validation_status=row.validation_status, detail=detail)


@router.post(
    "/credentials/{credential_id}/discover-models",
    response_model=ModelSearchResponse,
)
async def discover_credential_models(
    body: ModelSearchRequest,
    credential_id: uuid.UUID = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    row = await _get_credential_or_404(db, auth.tenant_id, credential_id)
    try:
        models = await list_models_for_credential(db, row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    search = (body.search or "").strip().lower()
    if search:
        models = [m for m in models if search in m.lower()]
    return ModelSearchResponse(models=models)


# ── Azure deployment editor ──────────────────────────────────────────


@router.get(
    "/credentials/{credential_id}/deployments",
    response_model=list[DeploymentResponse],
)
async def list_deployments(
    credential_id: uuid.UUID = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    row = await _get_credential_or_404(db, auth.tenant_id, credential_id)
    if row.provider != "azure_openai":
        raise HTTPException(
            status_code=404,
            detail="deployments are only defined for azure_openai credentials",
        )
    rows = (
        await db.execute(
            select(TenantLlmDeployment, RefLlmModelsCatalog)
            .outerjoin(
                RefLlmModelsCatalog,
                RefLlmModelsCatalog.id == TenantLlmDeployment.canonical_model_id,
            )
            .where(TenantLlmDeployment.credential_id == credential_id)
            .order_by(TenantLlmDeployment.deployment_name)
        )
    ).all()
    return [_deployment_to_response(dep, cat) for dep, cat in rows]


@router.post(
    "/credentials/{credential_id}/deployments",
    response_model=DeploymentResponse,
    status_code=201,
)
async def create_deployment(
    body: DeploymentCreate,
    credential_id: uuid.UUID = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    row = await _get_credential_or_404(db, auth.tenant_id, credential_id)
    if row.provider != "azure_openai":
        raise HTTPException(
            status_code=400,
            detail="deployments are only defined for azure_openai credentials",
        )
    name = body.deployment_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="deploymentName is required")

    canonical_model_id: uuid.UUID | None = None
    canonical: RefLlmModelsCatalog | None = None
    if body.canonical_model_id is not None:
        try:
            canonical_model_id = uuid.UUID(body.canonical_model_id)
        except (ValueError, AttributeError) as exc:
            raise HTTPException(status_code=400, detail="canonicalModelId is not a valid UUID") from exc
        canonical = (
            await db.execute(
                select(RefLlmModelsCatalog).where(
                    RefLlmModelsCatalog.id == canonical_model_id
                )
            )
        ).scalar_one_or_none()
        if canonical is None:
            raise HTTPException(status_code=400, detail="canonicalModelId not found in catalog")

    dep = TenantLlmDeployment(
        credential_id=credential_id,
        deployment_name=name,
        canonical_model_id=canonical_model_id,
        api_version_override=body.api_version_override,
        enabled=body.enabled,
        needs_mapping=(canonical_model_id is None),
    )
    db.add(dep)
    # Single transaction: deployment row + alias write either both commit or
    # both roll back, so we never end up with a mapped deployment whose
    # cost-tracking alias is missing.
    if canonical is not None:
        await _upsert_alias_row(db, auth.tenant_id, name, canonical.model)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"deployment '{name}' already exists for this credential",
        ) from exc
    await db.refresh(dep)
    return _deployment_to_response(dep, canonical)


@router.patch(
    "/deployments/{deployment_id}", response_model=DeploymentResponse,
)
async def update_deployment(
    body: DeploymentUpdate,
    deployment_id: uuid.UUID = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    dep, _credential = await _get_deployment_or_404(db, auth.tenant_id, deployment_id)

    new_canonical: RefLlmModelsCatalog | None = None
    if body.canonical_model_id is not None:
        try:
            new_canonical_id = uuid.UUID(body.canonical_model_id)
        except (ValueError, AttributeError) as exc:
            raise HTTPException(status_code=400, detail="canonicalModelId is not a valid UUID") from exc
        new_canonical = (
            await db.execute(
                select(RefLlmModelsCatalog).where(
                    RefLlmModelsCatalog.id == new_canonical_id
                )
            )
        ).scalar_one_or_none()
        if new_canonical is None:
            raise HTTPException(status_code=400, detail="canonicalModelId not found in catalog")
        dep.canonical_model_id = new_canonical_id
        dep.needs_mapping = False
    if body.api_version_override is not None:
        dep.api_version_override = body.api_version_override or None
    if body.enabled is not None:
        dep.enabled = body.enabled

    if new_canonical is not None:
        await _upsert_alias_row(db, auth.tenant_id, dep.deployment_name, new_canonical.model)
    await db.commit()
    await db.refresh(dep)
    return _deployment_to_response(dep, new_canonical)


@router.delete("/deployments/{deployment_id}", status_code=204)
async def delete_deployment(
    deployment_id: uuid.UUID = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    dep, _credential = await _get_deployment_or_404(db, auth.tenant_id, deployment_id)
    await db.delete(dep)
    await db.commit()
    return None


# ── Cost-tracking alias sync ─────────────────────────────────────────


async def _upsert_alias_row(
    db: AsyncSession, tenant_id: uuid.UUID, deployment_name: str, canonical: str
) -> None:
    """Forward declaration → write the ``ref_llm_model_alias`` row.

    Idempotent: existing tenant-scoped rows are left alone (admin overrides via
    the cost-admin Unmapped tab still take precedence).
    """
    from sqlalchemy import text

    await db.execute(
        text(
            """
            INSERT INTO analytics.ref_llm_model_alias
                (id, tenant_id, provider, observed, canonical, created_at, updated_at)
            VALUES
                (gen_random_uuid(), :tenant_id, 'azure_openai', :observed, :canonical, now(), now())
            ON CONFLICT (tenant_id, provider, observed) DO NOTHING
            """
        ),
        {"tenant_id": tenant_id, "observed": deployment_name, "canonical": canonical},
    )
