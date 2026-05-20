"""Read-only routes for runtime model selection + admin UI catalog reads.

- ``GET /api/llm/models?call_site=X&credential_id=Y`` — capability-filtered
  model list. For an Azure credential, joins ``tenant_llm_deployments`` with
  the catalog and filters by ``call_site`` required capabilities. For non-
  Azure credentials, filters ``ref_llm_models_catalog`` directly.

- ``GET /api/llm/catalog?provider=X`` — unfiltered catalog read. Used by the
  Phase-3 deployment editor (admin needs to see every canonical model so they
  can map a deployment, even if no call site requires it yet). Filterable by
  provider; required for Phase-3 deployment mapping flow.

- ``GET /api/llm/call-sites`` — serializes the in-code call-site registry to
  JSON for the Phase-3 defaults admin page. Read-only; cacheable client-side.

Auth: every route requires a valid session (any user) — no admin permission
gate. Used by overlay dropdowns AND admin pages.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.database import get_db
from app.models.cost import RefLlmModelsCatalog
from app.models.tenant_call_site_default import TenantCallSiteDefault
from app.models.tenant_curated_model import TenantCuratedModel
from app.models.tenant_llm_credential import TenantLlmCredential
from app.models.tenant_llm_deployment import TenantLlmDeployment
from app.schemas.base import CamelModel
from app.services.llm_credentials import (
    compute_capabilities,
    get_call_site,
    list_call_sites,
)
from app.services.llm_credentials.call_sites import UnknownCallSiteError


router = APIRouter(prefix="/api/llm", tags=["llm-models"])


class CallSiteSpecResponse(CamelModel):
    id: str
    required_capabilities: list[str]
    optional_capabilities: list[str]
    description: str
    reference: str


class ModelOptionResponse(CamelModel):
    model_or_deployment: str
    display_name: str | None = None
    provider: str
    capabilities: list[str]
    is_default_for_call_site: bool = False


class CatalogModelResponse(CamelModel):
    id: str
    provider: str
    model: str
    display_name: str | None = None
    family: str | None = None
    capabilities: list[str]


@router.get("/call-sites", response_model=list[CallSiteSpecResponse])
async def get_call_sites_registry(
    auth: AuthContext = Depends(get_auth_context),  # noqa: ARG001
):
    """Serializes the in-code call-site registry. Static enough to cache
    aggressively client-side."""
    return [
        CallSiteSpecResponse(
            id=spec.id,
            required_capabilities=sorted(spec.required_capabilities),
            optional_capabilities=sorted(spec.optional_capabilities),
            description=spec.description,
            reference=spec.reference,
        )
        for spec in list_call_sites()
    ]


@router.get("/catalog", response_model=list[CatalogModelResponse])
async def get_catalog(
    provider: str | None = Query(default=None),
    include_deprecated: bool = Query(default=True),
    auth: AuthContext = Depends(get_auth_context),  # noqa: ARG001
    db: AsyncSession = Depends(get_db),
):
    """Catalog read used by the Phase-3 deployment editor.

    Per the plan: "unfiltered catalog read … admin needs to see every
    canonical OpenAI model to map a deployment, even if it has no call site
    yet". Default returns every row regardless of status; pass
    ``include_deprecated=false`` to restrict to ``status='active'`` when a
    consumer wants the trimmed list.
    """
    stmt = select(RefLlmModelsCatalog)
    if provider:
        stmt = stmt.where(RefLlmModelsCatalog.provider == provider)
    if not include_deprecated:
        stmt = stmt.where(RefLlmModelsCatalog.status == "active")
    rows = (await db.execute(stmt.order_by(RefLlmModelsCatalog.model))).scalars().all()
    return [
        CatalogModelResponse(
            id=str(r.id),
            provider=r.provider,
            model=r.model,
            display_name=r.display_name,
            family=r.family,
            capabilities=sorted(compute_capabilities(r)),
        )
        for r in rows
    ]


@router.get("/models", response_model=list[ModelOptionResponse])
async def get_models(
    call_site: str = Query(...),
    credential_id: uuid.UUID = Query(...),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Capability-filtered options for a given (call_site, credential).

    Azure: joins ``tenant_llm_deployments`` with the catalog. Excludes rows
    where ``canonical_model_id IS NULL`` (admin must map first).

    Non-Azure: filters ``ref_llm_models_catalog`` by provider + required
    capability tags.
    """
    try:
        spec = get_call_site(call_site)
    except UnknownCallSiteError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    credential = (
        await db.execute(
            select(TenantLlmCredential).where(
                TenantLlmCredential.id == credential_id,
                TenantLlmCredential.tenant_id == auth.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if credential is None:
        raise HTTPException(status_code=404, detail="credential not found")

    # Look up the current default for "is_default_for_call_site" badge — tenant
    # row wins over platform row.
    default_row = (
        await db.execute(
            select(TenantCallSiteDefault).where(
                TenantCallSiteDefault.tenant_id == auth.tenant_id,
                TenantCallSiteDefault.call_site == call_site,
            )
        )
    ).scalar_one_or_none()
    if default_row is None:
        default_row = (
            await db.execute(
                select(TenantCallSiteDefault).where(
                    TenantCallSiteDefault.tenant_id.is_(None),
                    TenantCallSiteDefault.call_site == call_site,
                )
            )
        ).scalar_one_or_none()
    current_default_model = default_row.model_or_deployment if default_row else None

    options: list[ModelOptionResponse] = []
    if credential.provider == "azure_openai":
        deployment_rows = (
            await db.execute(
                select(TenantLlmDeployment, RefLlmModelsCatalog)
                .join(
                    RefLlmModelsCatalog,
                    RefLlmModelsCatalog.id == TenantLlmDeployment.canonical_model_id,
                )
                .where(
                    TenantLlmDeployment.credential_id == credential.id,
                    TenantLlmDeployment.enabled.is_(True),
                    TenantLlmDeployment.needs_mapping.is_(False),
                )
                .order_by(TenantLlmDeployment.deployment_name)
            )
        ).all()
        for dep, cat in deployment_rows:
            caps = compute_capabilities(cat)
            if not (spec.required_capabilities <= caps):
                continue
            options.append(
                ModelOptionResponse(
                    model_or_deployment=dep.deployment_name,
                    display_name=cat.display_name,
                    provider=credential.provider,
                    capabilities=sorted(caps),
                    is_default_for_call_site=(
                        dep.deployment_name == current_default_model
                    ),
                )
            )
    else:
        # Strict curation: non-Azure dropdowns show ONLY models the admin
        # curated for this credential (tenant_curated_models). Empty = none.
        rows = (
            await db.execute(
                select(RefLlmModelsCatalog)
                .join(
                    TenantCuratedModel,
                    TenantCuratedModel.canonical_model_id == RefLlmModelsCatalog.id,
                )
                .where(
                    TenantCuratedModel.credential_id == credential.id,
                    TenantCuratedModel.enabled.is_(True),
                    RefLlmModelsCatalog.status == "active",
                    RefLlmModelsCatalog.provider == credential.provider,
                )
                .order_by(RefLlmModelsCatalog.model)
            )
        ).scalars().all()
        for r in rows:
            caps = compute_capabilities(r)
            if not (spec.required_capabilities <= caps):
                continue
            options.append(
                ModelOptionResponse(
                    model_or_deployment=r.model,
                    display_name=r.display_name,
                    provider=credential.provider,
                    capabilities=sorted(caps),
                    is_default_for_call_site=(r.model == current_default_model),
                )
            )
    return options
