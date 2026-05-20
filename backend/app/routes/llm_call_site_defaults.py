"""Admin & platform-staff CRUD for ``platform.tenant_call_site_defaults``.

Two surfaces:

**Admin (tenant-scoped)** — gated by ``configuration:edit``. Edits the row
where ``tenant_id = auth.tenant_id``.

- ``GET    /api/admin/llm/defaults``
- ``PUT    /api/admin/llm/defaults/{call_site}``
- ``DELETE /api/admin/llm/defaults/{call_site}``  (drops tenant row → falls
  back to platform default)

**Platform staff** — gated by the new ``platform:edit`` permission. Edits
the platform-wide row (``tenant_id IS NULL``).

- ``GET /api/platform/llm/defaults``
- ``PUT /api/platform/llm/defaults/{call_site}``

Every upsert validates capability fit server-side (load the catalog target,
compute capabilities, assert the call site's required tags are a subset).
Every successful mutation invalidates the call-site cache for the affected
``(tenant_id, call_site)``; platform-default mutations invalidate every
tenant's slot for that call_site (because tenants without an override now
resolve to the new platform value).
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
from app.models.tenant_call_site_default import TenantCallSiteDefault
from app.models.tenant_curated_model import TenantCuratedModel
from app.models.tenant_llm_credential import TenantLlmCredential
from app.models.tenant_llm_deployment import TenantLlmDeployment
from app.schemas.base import CamelModel
from app.services.llm_credentials import (
    CALL_SITES,
    compute_capabilities,
    get_call_site,
    invalidate_cache,
    invalidate_call_site_cache,
)


admin_router = APIRouter(prefix="/api/admin/llm", tags=["admin-llm-defaults"])
platform_router = APIRouter(prefix="/api/platform/llm", tags=["platform-llm-defaults"])


# ── Schemas ──────────────────────────────────────────────────────────


class CallSiteDefaultResponse(CamelModel):
    call_site: str
    scope: str                            # 'tenant' | 'platform'
    provider: str
    credential_name: str
    model_or_deployment: str
    updated_at: datetime | None = None


class CallSiteDefaultUpsert(CamelModel):
    provider: str
    credential_name: str = "default"
    model_or_deployment: str


# ── Helpers ──────────────────────────────────────────────────────────


def _check_call_site(call_site: str) -> None:
    if call_site not in CALL_SITES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown LLM call site '{call_site}'",
        )


async def _capability_check_or_400(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    call_site: str,
    provider: str,
    credential_name: str,
    model_or_deployment: str,
) -> None:
    """Load the catalog target (Azure: deployment → canonical → catalog;
    others: direct catalog lookup) and assert the call site's required
    capabilities are satisfied. Raises HTTP 400 otherwise."""
    spec = get_call_site(call_site)
    catalog_row: RefLlmModelsCatalog | None = None

    if provider == "azure_openai":
        if tenant_id is None:
            # Platform default cannot reference an Azure deployment (deployments
            # are tenant-scoped). Force operators to use non-Azure providers
            # for platform-wide rows.
            raise HTTPException(
                status_code=400,
                detail=(
                    "Platform-wide defaults cannot point at Azure deployments "
                    "(deployments are tenant-scoped). Use a non-Azure provider "
                    "for platform defaults, or set a tenant-specific row instead."
                ),
            )
        cred = (
            await db.execute(
                select(TenantLlmCredential).where(
                    TenantLlmCredential.tenant_id == tenant_id,
                    TenantLlmCredential.provider == provider,
                    TenantLlmCredential.name == credential_name,
                )
            )
        ).scalar_one_or_none()
        if cred is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Tenant has no '{credential_name}' credential for provider "
                    f"'{provider}' — add it in /admin/ai-settings first."
                ),
            )
        dep = (
            await db.execute(
                select(TenantLlmDeployment).where(
                    TenantLlmDeployment.credential_id == cred.id,
                    TenantLlmDeployment.deployment_name == model_or_deployment,
                )
            )
        ).scalar_one_or_none()
        if dep is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Azure deployment '{model_or_deployment}' is not declared "
                    f"on credential '{credential_name}' for this tenant."
                ),
            )
        # Defensive: reject both unmapped (needs_mapping=true) and the
        # invariant-violation case (canonical_model_id IS NULL with
        # needs_mapping=false). The two should always agree by construction;
        # checking both means schema drift fails loud here instead of
        # producing a nonsense capability set downstream.
        if dep.needs_mapping or dep.canonical_model_id is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Azure deployment '{model_or_deployment}' needs admin "
                    f"mapping before it can be used as a default. Map it in "
                    f"/admin/ai-settings/credentials/{cred.id}/deployments."
                ),
            )
        catalog_row = (
            await db.execute(
                select(RefLlmModelsCatalog).where(
                    RefLlmModelsCatalog.id == dep.canonical_model_id
                )
            )
        ).scalar_one_or_none()
    else:
        catalog_row = (
            await db.execute(
                select(RefLlmModelsCatalog).where(
                    RefLlmModelsCatalog.provider == provider,
                    RefLlmModelsCatalog.model == model_or_deployment,
                )
            )
        ).scalar_one_or_none()

    if catalog_row is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Model '{model_or_deployment}' for provider '{provider}' is not "
                f"in the catalog. Refresh models.dev from /admin/ai-settings/cost "
                f"or pick a different model."
            ),
        )

    # Strict curation: a tenant-scoped non-Azure default must point at a model
    # curated for that credential — the same gate the dropdowns enforce. Azure
    # is gated by its deployment lookup above; platform rows (tenant_id None)
    # can't be curation-checked (curation is per-tenant) and fall back to
    # catalog validation only.
    if provider != "azure_openai" and tenant_id is not None:
        cred = (
            await db.execute(
                select(TenantLlmCredential).where(
                    TenantLlmCredential.tenant_id == tenant_id,
                    TenantLlmCredential.provider == provider,
                    TenantLlmCredential.name == credential_name,
                )
            )
        ).scalar_one_or_none()
        if cred is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Tenant has no '{credential_name}' credential for provider "
                    f"'{provider}' — add it in /admin/ai-settings first."
                ),
            )
        curated = (
            await db.execute(
                select(TenantCuratedModel).where(
                    TenantCuratedModel.credential_id == cred.id,
                    TenantCuratedModel.canonical_model_id == catalog_row.id,
                    TenantCuratedModel.enabled.is_(True),
                )
            )
        ).scalar_one_or_none()
        if curated is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Model '{model_or_deployment}' is not curated for credential "
                    f"'{credential_name}'. Add it under the credential in "
                    f"/admin/ai-settings first."
                ),
            )

    capabilities = compute_capabilities(catalog_row)
    missing = spec.required_capabilities - capabilities
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Model '{model_or_deployment}' does not support required "
                f"capabilities {sorted(missing)} for call site '{call_site}'."
            ),
        )


def _to_response(row: TenantCallSiteDefault) -> CallSiteDefaultResponse:
    return CallSiteDefaultResponse(
        call_site=row.call_site,
        scope="platform" if row.tenant_id is None else "tenant",
        provider=row.provider,
        credential_name=row.credential_name,
        model_or_deployment=row.model_or_deployment,
        updated_at=row.updated_at,
    )


async def _upsert_default(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    call_site: str,
    body: CallSiteDefaultUpsert,
    updated_by: uuid.UUID | None,
) -> TenantCallSiteDefault:
    """Upsert the (tenant, call_site) row; capability-validates before write.

    Caller MUST have already validated ``call_site`` via ``_check_call_site``
    (every route handler does so up front). We don't re-validate here.
    """
    await _capability_check_or_400(
        db,
        tenant_id=tenant_id,
        call_site=call_site,
        provider=body.provider,
        credential_name=body.credential_name,
        model_or_deployment=body.model_or_deployment,
    )

    stmt = select(TenantCallSiteDefault).where(
        TenantCallSiteDefault.call_site == call_site,
    )
    if tenant_id is None:
        stmt = stmt.where(TenantCallSiteDefault.tenant_id.is_(None))
    else:
        stmt = stmt.where(TenantCallSiteDefault.tenant_id == tenant_id)

    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        row = TenantCallSiteDefault(
            tenant_id=tenant_id,
            call_site=call_site,
            provider=body.provider,
            credential_name=body.credential_name,
            model_or_deployment=body.model_or_deployment,
            updated_by=updated_by,
        )
        db.add(row)
    else:
        row.provider = body.provider
        row.credential_name = body.credential_name
        row.model_or_deployment = body.model_or_deployment
        row.updated_by = updated_by
        row.updated_at = datetime.now(timezone.utc)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                f"another writer raced this upsert for call site '{call_site}'; "
                f"retry"
            ),
        ) from exc
    await db.refresh(row)
    return row


# ── Admin (tenant) routes ────────────────────────────────────────────


@admin_router.get("/defaults", response_model=list[CallSiteDefaultResponse])
async def list_tenant_defaults(
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    """Return every tenant-scoped row for this tenant. Empty list means
    everything resolves through the platform fallback."""
    rows = (
        await db.execute(
            select(TenantCallSiteDefault)
            .where(TenantCallSiteDefault.tenant_id == auth.tenant_id)
            .order_by(TenantCallSiteDefault.call_site)
        )
    ).scalars().all()
    return [_to_response(r) for r in rows]


@admin_router.put("/defaults/{call_site}", response_model=CallSiteDefaultResponse)
async def upsert_tenant_default(
    body: CallSiteDefaultUpsert,
    call_site: str = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    _check_call_site(call_site)
    row = await _upsert_default(
        db, tenant_id=auth.tenant_id, call_site=call_site,
        body=body, updated_by=auth.user_id,
    )
    # Plan Task 7: invalidate BOTH caches.
    # Credential cache could now resolve differently (e.g. the underlying
    # credential row was rotated by a different admin in another tab); be
    # cheap and clear the whole (tenant, provider) slot.
    invalidate_call_site_cache(auth.tenant_id, call_site)
    invalidate_cache(auth.tenant_id, row.provider, row.credential_name)
    return _to_response(row)


@admin_router.delete("/defaults/{call_site}", status_code=204)
async def delete_tenant_default(
    call_site: str = Path(...),
    auth: AuthContext = require_permission("configuration:edit"),
    db: AsyncSession = Depends(get_db),
):
    """Drop the tenant row → tenant now resolves via the platform default."""
    _check_call_site(call_site)
    # Invalidate up-front (idempotent + caches stale entries even when the
    # row is already missing for this admin's tenant — the cache might still
    # hold a no-DB-query hit from before another admin removed the row).
    invalidate_call_site_cache(auth.tenant_id, call_site)
    row = (
        await db.execute(
            select(TenantCallSiteDefault).where(
                TenantCallSiteDefault.tenant_id == auth.tenant_id,
                TenantCallSiteDefault.call_site == call_site,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    provider, credential_name = row.provider, row.credential_name
    await db.delete(row)
    await db.commit()
    invalidate_cache(auth.tenant_id, provider, credential_name)
    return None


# ── Platform-staff routes ────────────────────────────────────────────


@platform_router.get("/defaults", response_model=list[CallSiteDefaultResponse])
async def list_platform_defaults(
    auth: AuthContext = require_permission("platform:edit"),
    db: AsyncSession = Depends(get_db),
):
    _ = auth  # gated by permission only — read is global
    rows = (
        await db.execute(
            select(TenantCallSiteDefault)
            .where(TenantCallSiteDefault.tenant_id.is_(None))
            .order_by(TenantCallSiteDefault.call_site)
        )
    ).scalars().all()
    return [_to_response(r) for r in rows]


@platform_router.put("/defaults/{call_site}", response_model=CallSiteDefaultResponse)
async def upsert_platform_default(
    body: CallSiteDefaultUpsert,
    call_site: str = Path(...),
    auth: AuthContext = require_permission("platform:edit"),
    db: AsyncSession = Depends(get_db),
):
    _check_call_site(call_site)
    row = await _upsert_default(
        db, tenant_id=None, call_site=call_site,
        body=body, updated_by=auth.user_id,
    )
    # Platform-default change: every tenant's cached entry for this call_site
    # now resolves differently. Clear all of them. The credential cache spans
    # every tenant too, but credentials are tenant-scoped — we'd have to
    # walk every tenant to invalidate precisely. The 60s TTL plus the fact
    # that defaults-default writes are operator-rare make full-credential-
    # cache wipe overkill; instead, the credential cache will warm back up
    # naturally as each tenant's next request hits the resolver.
    invalidate_call_site_cache(call_site=call_site)
    return _to_response(row)
