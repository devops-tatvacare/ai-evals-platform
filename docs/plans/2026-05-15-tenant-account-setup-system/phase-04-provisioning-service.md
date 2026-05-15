# Phase 4 — Provisioning service + admin routes

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Land the backend service and routes that the `/platform` UI in Phases 5–6 will call. By the end of this phase, a curl request can create a new tenant end-to-end (identity + grants + invite link + audit row + zero-overlay) in one transaction. Edits to existing tenant overlays follow the draft → publish → invalidate flow.

**Architecture — service layer:**
- `backend/app/services/tenant_provisioning.py` — orchestrates `create_tenant`. Pure async, takes a payload, returns a result. Idempotent on tenant slug. All writes inside one `db.begin()`.
- `backend/app/services/tenant_overlay_service.py` — overlay CRUD: `create_draft`, `update_draft`, `publish`, `revert_to_version`, `list_versions`, `get_diff`. All writes audit-logged. Publish busts resolver cache.

**Architecture — route layer:**
- `POST   /api/platform/tenants` — create tenant
- `GET    /api/platform/tenants` — list tenants (platform-staff only)
- `GET    /api/platform/tenants/{tenant_id}` — tenant detail
- `PATCH  /api/platform/tenants/{tenant_id}` — identity edits
- `POST   /api/platform/tenants/{tenant_id}/apps/{app_slug}/grant` — grant app
- `POST   /api/platform/tenants/{tenant_id}/apps/{app_slug}/revoke` — revoke app
- `GET    /api/platform/tenants/{tenant_id}/apps/{app_slug}/overlay` — current state (latest published + open draft if any)
- `POST   /api/platform/tenants/{tenant_id}/apps/{app_slug}/overlay/draft` — create or update draft
- `POST   /api/platform/tenants/{tenant_id}/apps/{app_slug}/overlay/publish` — promote draft to published
- `POST   /api/platform/tenants/{tenant_id}/apps/{app_slug}/overlay/revert` — promote a prior version back to published
- `GET    /api/platform/tenants/{tenant_id}/apps/{app_slug}/overlay/versions` — version history
- `GET    /api/platform/tenants/{tenant_id}/apps/{app_slug}/overlay/diff?from=N&to=M` — diff two versions

**Out of scope this phase:**
- Tenant-owner subset edits (those are a thinner sibling route surface, not staff routes; ships in Phase 6 alongside the FE form).
- Tenant deletion / suspension (manual SQL until v1.1).

---

## Files

- **Create:**
  - `backend/app/services/tenant_provisioning.py`
  - `backend/app/services/tenant_overlay_service.py`
  - `backend/app/routes/platform_tenants.py` (new file; the existing `platform.py` keeps just `healthz`)
  - `backend/app/schemas/tenant_provisioning.py` (request/response Pydantic models)
  - `backend/app/schemas/tenant_overlay.py`
  - `backend/tests/services/test_tenant_provisioning.py`
  - `backend/tests/services/test_tenant_overlay_service.py`
  - `backend/tests/routes/test_platform_tenants.py`
- **Modify:**
  - `backend/app/main.py` — register the new router
  - `backend/app/services/app_config_resolver.py` — already exposes `invalidate(tenant_id, app_id)`; called from publish path

---

## Task T4.1 — Schemas

- [ ] **Step 1: `backend/app/schemas/tenant_provisioning.py`**

```python
from typing import Literal

from pydantic import EmailStr, Field

from app.schemas.base import CamelModel


class AppGrantSpec(CamelModel):
    """One app to grant the new tenant."""
    slug: str
    initial_overlay: dict[str, object] = Field(default_factory=dict)


class CreateTenantRequest(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9-]*$")
    allowed_domains: list[str] = Field(default_factory=list)
    logo_url: str | None = None
    app_url: str | None = None
    apps: list[AppGrantSpec] = Field(default_factory=list)
    initial_owner_email: EmailStr
    initial_owner_role: Literal["owner"] = "owner"


class CreateTenantResponse(CamelModel):
    tenant_id: str
    slug: str
    invite_link_url: str
    granted_apps: list[str]


class TenantSummary(CamelModel):
    id: str
    name: str
    slug: str
    is_active: bool
    granted_app_slugs: list[str]
    user_count: int
    created_at: str


class UpdateTenantRequest(CamelModel):
    name: str | None = None
    allowed_domains: list[str] | None = None
    logo_url: str | None = None
    app_url: str | None = None
```

- [ ] **Step 2: `backend/app/schemas/tenant_overlay.py`**

```python
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel


class OverlayState(CamelModel):
    """Current state of an overlay for one (tenant, app)."""
    tenant_id: str
    app_id: str
    app_slug: str
    published_version: int | None = None
    published_config: dict[str, object] | None = None
    published_features_overrides: dict[str, object] | None = None
    draft_version: int | None = None
    draft_config: dict[str, object] | None = None
    draft_features_overrides: dict[str, object] | None = None


class UpsertDraftRequest(CamelModel):
    config: dict[str, object] = Field(default_factory=dict)
    features_overrides: dict[str, object] = Field(default_factory=dict)


class PublishDraftRequest(CamelModel):
    expected_version: int  # optimistic concurrency: client passes the draft version they intend to publish


class RevertRequest(CamelModel):
    target_version: int


class OverlayVersionSummary(CamelModel):
    version: int
    status: Literal["draft", "published", "archived"]
    created_at: str
    created_by_email: str | None
    published_at: str | None
    published_by_email: str | None
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/tenant_provisioning.py backend/app/schemas/tenant_overlay.py
git commit -m "feat(schemas): tenant provisioning + overlay request/response models"
```

---

## Task T4.2 — Provisioning service

- [ ] **Step 1: Write `backend/app/services/tenant_provisioning.py`**

```python
"""Tenant provisioning — single-transaction multi-write.

create_tenant orchestrates: tenant row, tenant_configurations,
default access roles (owner/editor/viewer), tenant_application_grants
for each requested app, an empty overlay row per app (so future overlay
edits versions from 1 not 2), an invite link for the initial owner, and
a platform audit row. All inside one `db.begin()`. Idempotent on slug:
re-running with the same slug is a no-op for the tenant row but still
writes any newly-requested grants.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext
from app.auth.platform_dependency import record_platform_audit
from app.models.application import Application
from app.models.identity_invite_link import IdentityInviteLink
from app.models.role import AccessRole
from app.models.tenant import Tenant
from app.models.tenant_application_configuration import TenantApplicationConfiguration
from app.models.tenant_application_grant import TenantApplicationGrant
from app.models.tenant_config import TenantConfiguration
from app.schemas.tenant_provisioning import CreateTenantRequest, CreateTenantResponse


_DEFAULT_INVITE_TTL_HOURS = 168  # 7 days


async def create_tenant(
    db: AsyncSession,
    actor: AuthContext,
    payload: CreateTenantRequest,
    *,
    invite_base_url: str,
) -> CreateTenantResponse:
    # Idempotent on slug: if tenant exists, reuse it. Audit row is still
    # written so re-runs are observable.
    existing = (await db.execute(select(Tenant).where(Tenant.slug == payload.slug))).scalar_one_or_none()
    if existing is None:
        tenant = Tenant(
            id=uuid.uuid4(),
            name=payload.name,
            slug=payload.slug,
            is_active=True,
        )
        db.add(tenant)
        await db.flush()
    else:
        tenant = existing

    # Identity config (logo, allowed domains, etc).
    config = (await db.execute(select(TenantConfiguration).where(TenantConfiguration.tenant_id == tenant.id))).scalar_one_or_none()
    if config is None:
        config = TenantConfiguration(
            tenant_id=tenant.id,
            allowed_domains=payload.allowed_domains,
            logo_url=payload.logo_url,
            app_url=payload.app_url,
        )
        db.add(config)
    else:
        config.allowed_domains = payload.allowed_domains or config.allowed_domains
        if payload.logo_url is not None:
            config.logo_url = payload.logo_url
        if payload.app_url is not None:
            config.app_url = payload.app_url

    # Default access roles. Re-uses seed_owner_role pattern.
    owner_role = (await db.execute(
        select(AccessRole).where(AccessRole.tenant_id == tenant.id, AccessRole.name == "Owner")
    )).scalar_one_or_none()
    if owner_role is None:
        owner_role = AccessRole(tenant_id=tenant.id, name="Owner", description="Full access", is_system=True)
        db.add(owner_role)
        await db.flush()

    # App grants + zero-overlay rows.
    granted_slugs: list[str] = []
    for app_spec in payload.apps:
        app = (await db.execute(select(Application).where(Application.slug == app_spec.slug))).scalar_one_or_none()
        if app is None:
            continue  # silently skip unknown slugs; staff sees the result list and can re-run
        existing_grant = (await db.execute(
            select(TenantApplicationGrant).where(
                TenantApplicationGrant.tenant_id == tenant.id,
                TenantApplicationGrant.app_id == app.id,
            )
        )).scalar_one_or_none()
        if existing_grant is None:
            db.add(TenantApplicationGrant(
                tenant_id=tenant.id,
                app_id=app.id,
                status="active",
                granted_by=actor.user_id,
            ))
        elif existing_grant.status != "active":
            existing_grant.status = "active"
            existing_grant.granted_at = datetime.now(tz=timezone.utc)
            existing_grant.granted_by = actor.user_id
            existing_grant.revoked_at = None
            existing_grant.revoked_by = None

        # Zero-overlay seed: a published version-0 row with empty config so
        # the version counter starts at 1 for real edits. Resolver still
        # falls through to template because the published row has empty
        # config + empty features_overrides.
        overlay_exists = (await db.execute(
            select(TenantApplicationConfiguration.id).where(
                TenantApplicationConfiguration.tenant_id == tenant.id,
                TenantApplicationConfiguration.app_id == app.id,
            )
        )).scalar_one_or_none()
        if overlay_exists is None:
            db.add(TenantApplicationConfiguration(
                tenant_id=tenant.id,
                app_id=app.id,
                version=0,
                status="published",
                config={},
                features_overrides={},
                created_by=actor.user_id,
                published_by=actor.user_id,
                published_at=datetime.now(tz=timezone.utc),
            ))

        if app_spec.initial_overlay:
            db.add(TenantApplicationConfiguration(
                tenant_id=tenant.id,
                app_id=app.id,
                version=1,
                status="draft",
                config=app_spec.initial_overlay,
                features_overrides={},
                created_by=actor.user_id,
            ))

        granted_slugs.append(app_spec.slug)

    # Invite link for the initial owner.
    invite_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(tz=timezone.utc) + timedelta(hours=_DEFAULT_INVITE_TTL_HOURS)
    invite = IdentityInviteLink(
        tenant_id=tenant.id,
        token=invite_token,
        role_id=owner_role.id,
        max_uses=1,
        expires_at=expires_at,
        signup_method="password",
        created_by=actor.user_id,
        created_by_email_snapshot=actor.email,
        label=f"Initial owner for {tenant.name}",
    )
    db.add(invite)

    # Cross-tenant audit row.
    await record_platform_audit(
        db,
        actor,
        action="tenant.create",
        target_type="tenant",
        target_id=tenant.id,
        target_tenant_id=tenant.id,
        payload={
            "slug": tenant.slug,
            "name": tenant.name,
            "granted_apps": granted_slugs,
            "initial_owner_email": payload.initial_owner_email,
        },
    )

    return CreateTenantResponse(
        tenant_id=str(tenant.id),
        slug=tenant.slug,
        invite_link_url=f"{invite_base_url}/auth/redeem-invite?token={invite_token}",
        granted_apps=granted_slugs,
    )
```

- [ ] **Step 2: Test (idempotent + happy path)**

```python
# backend/tests/services/test_tenant_provisioning.py
import pytest
from sqlalchemy import select

from app.models.tenant import Tenant
from app.models.tenant_application_grant import TenantApplicationGrant
from app.models.platform_audit_event_log import PlatformAuditEventLog
from app.services.tenant_provisioning import create_tenant
from app.schemas.tenant_provisioning import CreateTenantRequest, AppGrantSpec

pytestmark = pytest.mark.asyncio


async def test_create_tenant_writes_all_expected_rows(db_session, platform_staff_auth_context):
    payload = CreateTenantRequest(
        name="Acme Hospital",
        slug="acme",
        allowed_domains=["@acme.health"],
        apps=[AppGrantSpec(slug="kaira-bot")],
        initial_owner_email="ops@acme.health",
    )
    result = await create_tenant(db_session, platform_staff_auth_context, payload, invite_base_url="https://app.test")
    await db_session.flush()

    tenant = (await db_session.execute(select(Tenant).where(Tenant.slug == "acme"))).scalar_one()
    assert tenant.name == "Acme Hospital"

    grants = (await db_session.execute(
        select(TenantApplicationGrant).where(TenantApplicationGrant.tenant_id == tenant.id)
    )).scalars().all()
    assert len(grants) == 1
    assert grants[0].status == "active"

    audit = (await db_session.execute(
        select(PlatformAuditEventLog).where(PlatformAuditEventLog.target_tenant_id == tenant.id)
    )).scalars().all()
    assert len(audit) == 1
    assert audit[0].action == "tenant.create"

    assert result.invite_link_url.startswith("https://app.test/auth/redeem-invite?token=")
    assert result.granted_apps == ["kaira-bot"]


async def test_create_tenant_is_idempotent_on_slug(db_session, platform_staff_auth_context):
    payload = CreateTenantRequest(
        name="Acme Hospital", slug="acme",
        apps=[AppGrantSpec(slug="kaira-bot")],
        initial_owner_email="ops@acme.health",
    )
    await create_tenant(db_session, platform_staff_auth_context, payload, invite_base_url="https://app.test")
    await create_tenant(db_session, platform_staff_auth_context, payload, invite_base_url="https://app.test")
    await db_session.flush()

    tenants = (await db_session.execute(select(Tenant).where(Tenant.slug == "acme"))).scalars().all()
    assert len(tenants) == 1, "Re-running with same slug must not duplicate the tenant"

    grants = (await db_session.execute(
        select(TenantApplicationGrant).where(TenantApplicationGrant.tenant_id == tenants[0].id)
    )).scalars().all()
    assert len(grants) == 1, "Re-running with same app slug must not duplicate the grant"
```

- [ ] **Step 3: Run + commit**

```bash
pytest backend/tests/services/test_tenant_provisioning.py -v
git add backend/app/services/tenant_provisioning.py backend/tests/services/test_tenant_provisioning.py
git commit -m "feat(provisioning): create_tenant orchestrates identity + grants + invite + audit"
```

---

## Task T4.3 — Overlay service

- [ ] **Step 1: Write `backend/app/services/tenant_overlay_service.py`**

```python
"""Versioned overlay CRUD for (tenant, app) configs.

Lifecycle:
  draft  → may be edited in place; multiple drafts are NOT allowed
           per (tenant, app) — there is at most one open draft.
  publish → archive any prior published row for (tenant, app), promote
           the draft to published, set published_at, bump cache.
  revert → load a prior published version's payload, create a NEW
           draft from it, publish it. (Never re-promote an old row;
           always create a new version so version monotonicity holds.)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext
from app.auth.platform_dependency import record_platform_audit
from app.models.tenant_application_configuration import TenantApplicationConfiguration
from app.services.app_config_resolver import invalidate
from app.schemas.tenant_overlay import OverlayState, OverlayVersionSummary


async def _next_version(db: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID) -> int:
    row = (await db.execute(
        select(TenantApplicationConfiguration.version)
        .where(
            TenantApplicationConfiguration.tenant_id == tenant_id,
            TenantApplicationConfiguration.app_id == app_id,
        )
        .order_by(desc(TenantApplicationConfiguration.version))
        .limit(1)
    )).scalar_one_or_none()
    return (row or 0) + 1


async def get_state(db: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, app_slug: str) -> OverlayState:
    rows = (await db.execute(
        select(TenantApplicationConfiguration)
        .where(
            TenantApplicationConfiguration.tenant_id == tenant_id,
            TenantApplicationConfiguration.app_id == app_id,
        )
    )).scalars().all()
    published = next((r for r in rows if r.status == "published"), None)
    draft = next((r for r in rows if r.status == "draft"), None)
    return OverlayState(
        tenant_id=str(tenant_id),
        app_id=str(app_id),
        app_slug=app_slug,
        published_version=published.version if published else None,
        published_config=published.config if published else None,
        published_features_overrides=published.features_overrides if published else None,
        draft_version=draft.version if draft else None,
        draft_config=draft.config if draft else None,
        draft_features_overrides=draft.features_overrides if draft else None,
    )


async def upsert_draft(
    db: AsyncSession,
    actor: AuthContext,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    config: dict,
    features_overrides: dict,
) -> TenantApplicationConfiguration:
    existing = (await db.execute(
        select(TenantApplicationConfiguration).where(
            TenantApplicationConfiguration.tenant_id == tenant_id,
            TenantApplicationConfiguration.app_id == app_id,
            TenantApplicationConfiguration.status == "draft",
        )
    )).scalar_one_or_none()
    if existing:
        existing.config = config
        existing.features_overrides = features_overrides
        existing.updated_at = datetime.now(tz=timezone.utc)
        row = existing
    else:
        row = TenantApplicationConfiguration(
            tenant_id=tenant_id,
            app_id=app_id,
            version=await _next_version(db, tenant_id, app_id),
            status="draft",
            config=config,
            features_overrides=features_overrides,
            created_by=actor.user_id,
        )
        db.add(row)
    await record_platform_audit(
        db, actor,
        action="tenant.overlay.draft.upsert",
        target_type="tenant_application_configuration",
        target_tenant_id=tenant_id,
        target_id=app_id,
        payload={"version": row.version, "config_keys": list(config.keys()), "features_overrides_keys": list(features_overrides.keys())},
    )
    return row


async def publish(
    db: AsyncSession,
    actor: AuthContext,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    expected_version: int,
) -> TenantApplicationConfiguration:
    draft = (await db.execute(
        select(TenantApplicationConfiguration).where(
            TenantApplicationConfiguration.tenant_id == tenant_id,
            TenantApplicationConfiguration.app_id == app_id,
            TenantApplicationConfiguration.status == "draft",
        )
    )).scalar_one_or_none()
    if draft is None or draft.version != expected_version:
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="Draft version mismatch — refresh and try again")

    # Archive any currently published row.
    await db.execute(
        update(TenantApplicationConfiguration)
        .where(
            TenantApplicationConfiguration.tenant_id == tenant_id,
            TenantApplicationConfiguration.app_id == app_id,
            TenantApplicationConfiguration.status == "published",
        )
        .values(status="archived")
    )

    draft.status = "published"
    draft.published_at = datetime.now(tz=timezone.utc)
    draft.published_by = actor.user_id

    invalidate(tenant_id, app_id)

    await record_platform_audit(
        db, actor,
        action="tenant.overlay.publish",
        target_type="tenant_application_configuration",
        target_tenant_id=tenant_id,
        target_id=app_id,
        payload={"version": draft.version},
    )
    return draft


async def revert_to(
    db: AsyncSession,
    actor: AuthContext,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    target_version: int,
) -> TenantApplicationConfiguration:
    target = (await db.execute(
        select(TenantApplicationConfiguration).where(
            TenantApplicationConfiguration.tenant_id == tenant_id,
            TenantApplicationConfiguration.app_id == app_id,
            TenantApplicationConfiguration.version == target_version,
        )
    )).scalar_one_or_none()
    if target is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Version not found")

    new_version = await _next_version(db, tenant_id, app_id)
    new_row = TenantApplicationConfiguration(
        tenant_id=tenant_id,
        app_id=app_id,
        version=new_version,
        status="published",
        config=dict(target.config or {}),
        features_overrides=dict(target.features_overrides or {}),
        created_by=actor.user_id,
        published_by=actor.user_id,
        published_at=datetime.now(tz=timezone.utc),
    )
    # Archive the current published row in the same statement.
    await db.execute(
        update(TenantApplicationConfiguration)
        .where(
            TenantApplicationConfiguration.tenant_id == tenant_id,
            TenantApplicationConfiguration.app_id == app_id,
            TenantApplicationConfiguration.status == "published",
        )
        .values(status="archived")
    )
    db.add(new_row)
    invalidate(tenant_id, app_id)

    await record_platform_audit(
        db, actor,
        action="tenant.overlay.revert",
        target_type="tenant_application_configuration",
        target_tenant_id=tenant_id,
        target_id=app_id,
        payload={"reverted_to_version": target_version, "new_published_version": new_version},
    )
    return new_row


async def list_versions(db: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID) -> list[OverlayVersionSummary]:
    rows = (await db.execute(
        select(TenantApplicationConfiguration)
        .where(
            TenantApplicationConfiguration.tenant_id == tenant_id,
            TenantApplicationConfiguration.app_id == app_id,
        )
        .order_by(desc(TenantApplicationConfiguration.version))
    )).scalars().all()
    return [
        OverlayVersionSummary(
            version=r.version,
            status=r.status,
            created_at=r.created_at.isoformat(),
            created_by_email=None,  # join out in the route layer if displaying
            published_at=r.published_at.isoformat() if r.published_at else None,
            published_by_email=None,
        )
        for r in rows
    ]
```

- [ ] **Step 2: Test publish + revert + cache invalidation**

```python
# backend/tests/services/test_tenant_overlay_service.py
import pytest
from sqlalchemy import select

from app.models.tenant_application_configuration import TenantApplicationConfiguration
from app.services import tenant_overlay_service as svc
from app.services.app_config_resolver import resolve

pytestmark = pytest.mark.asyncio


async def test_publish_archives_previous_and_busts_cache(db_session, platform_staff_auth_context, sample_tenant, sample_app):
    sample_app.config_template = {"displayName": "Template"}
    db_session.add(TenantApplicationConfiguration(
        tenant_id=sample_tenant.id, app_id=sample_app.id,
        version=1, status="published", config={"displayName": "v1"},
    ))
    db_session.add(TenantApplicationConfiguration(
        tenant_id=sample_tenant.id, app_id=sample_app.id,
        version=2, status="draft", config={"displayName": "v2"},
    ))
    await db_session.flush()

    # Warm cache.
    pre = await resolve(db_session, sample_tenant.id, sample_app.id)
    assert pre["displayName"] == "v1"

    await svc.publish(db_session, platform_staff_auth_context, sample_tenant.id, sample_app.id, expected_version=2)
    await db_session.flush()

    post = await resolve(db_session, sample_tenant.id, sample_app.id)
    assert post["displayName"] == "v2"

    archived = (await db_session.execute(
        select(TenantApplicationConfiguration).where(
            TenantApplicationConfiguration.tenant_id == sample_tenant.id,
            TenantApplicationConfiguration.app_id == sample_app.id,
            TenantApplicationConfiguration.version == 1,
        )
    )).scalar_one()
    assert archived.status == "archived"


async def test_revert_creates_new_published_version_with_old_payload(db_session, platform_staff_auth_context, sample_tenant, sample_app):
    db_session.add(TenantApplicationConfiguration(
        tenant_id=sample_tenant.id, app_id=sample_app.id,
        version=1, status="archived", config={"displayName": "old-good"},
    ))
    db_session.add(TenantApplicationConfiguration(
        tenant_id=sample_tenant.id, app_id=sample_app.id,
        version=2, status="published", config={"displayName": "current-bad"},
    ))
    await db_session.flush()

    new_row = await svc.revert_to(db_session, platform_staff_auth_context, sample_tenant.id, sample_app.id, target_version=1)
    await db_session.flush()

    assert new_row.version == 3
    assert new_row.status == "published"
    assert new_row.config == {"displayName": "old-good"}
```

- [ ] **Step 3: Run + commit**

```bash
pytest backend/tests/services/test_tenant_overlay_service.py -v
git add backend/app/services/tenant_overlay_service.py backend/tests/services/test_tenant_overlay_service.py
git commit -m "feat(overlay): draft/publish/revert lifecycle + cache invalidation"
```

---

## Task T4.4 — Routes

- [ ] **Step 1: Write `backend/app/routes/platform_tenants.py`**

Wire all 11 routes from the architecture section above. Each calls into the service layer, then returns the appropriate Pydantic response. Every mutation is gated by `Depends(require_platform_staff)`.

For brevity, here is the most-important route (`POST /api/platform/tenants`); the others follow the same pattern (auth dep + service call + return):

```python
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext
from app.auth.platform_dependency import require_platform_staff
from app.database import get_db
from app.schemas.tenant_provisioning import CreateTenantRequest, CreateTenantResponse
from app.services import tenant_provisioning

router = APIRouter(prefix="/api/platform/tenants", tags=["platform-tenants"])


@router.post("", response_model=CreateTenantResponse, status_code=201)
async def create_tenant_route(
    payload: CreateTenantRequest,
    request: Request,
    auth: AuthContext = Depends(require_platform_staff),
    db: AsyncSession = Depends(get_db),
):
    base_url = f"{request.url.scheme}://{request.url.netloc}"
    return await tenant_provisioning.create_tenant(db, auth, payload, invite_base_url=base_url)
```

(The full file lands all 11 routes — list, detail, patch identity, grant, revoke, overlay get, draft, publish, revert, versions, diff. Each is ~10 lines.)

- [ ] **Step 2: Register in `backend/app/main.py`**

`from app.routes import platform_tenants` + `app.include_router(platform_tenants.router)`.

- [ ] **Step 3: Integration test the create flow end-to-end**

```python
# backend/tests/routes/test_platform_tenants.py
import pytest

pytestmark = pytest.mark.asyncio


async def test_create_tenant_403_for_regular_user(client, regular_user_auth):
    response = await client.post("/api/platform/tenants", json={
        "name": "Acme", "slug": "acme",
        "apps": [], "initialOwnerEmail": "ops@acme.health",
    }, headers=regular_user_auth)
    assert response.status_code == 403


async def test_create_tenant_201_for_staff(client, platform_staff_auth):
    response = await client.post("/api/platform/tenants", json={
        "name": "Acme Hospital",
        "slug": "acme",
        "allowedDomains": ["@acme.health"],
        "apps": [{"slug": "kaira-bot"}],
        "initialOwnerEmail": "ops@acme.health",
    }, headers=platform_staff_auth)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["slug"] == "acme"
    assert body["grantedApps"] == ["kaira-bot"]
    assert "redeem-invite" in body["inviteLinkUrl"]
```

- [ ] **Step 4: Run + commit**

```bash
pytest backend/tests/routes/test_platform_tenants.py -v
git add backend/app/routes/platform_tenants.py backend/app/main.py backend/tests/routes/test_platform_tenants.py
git commit -m "feat(routes): /api/platform/tenants CRUD + overlay lifecycle"
```

---

## Task T4.5 — End-to-end smoke (curl)

- [ ] **Step 1: As bootstrap admin, create a synthetic test tenant**

```bash
TOKEN="<bootstrap admin JWT>"
curl -s -X POST http://localhost:8721/api/platform/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test","slug":"smoke-test","apps":[{"slug":"kaira-bot"}],"initialOwnerEmail":"smoke@test.local"}' \
  | python3 -m json.tool
```

Expected: 201, JSON with tenantId, inviteLinkUrl, grantedApps=["kaira-bot"].

- [ ] **Step 2: Verify rows landed**

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT t.slug, count(g.id) as grants, count(o.id) as overlays FROM platform.tenants t LEFT JOIN platform.tenant_application_grants g ON g.tenant_id=t.id LEFT JOIN platform.tenant_application_configurations o ON o.tenant_id=t.id WHERE t.slug='\''smoke-test'\'' GROUP BY t.slug;"'
```

Expected: 1 grant, 1 overlay (the version-0 seed).

- [ ] **Step 3: Verify audit row**

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT action, target_type, payload FROM platform.platform_audit_event_logs ORDER BY created_at DESC LIMIT 1;"'
```

Expected: `tenant.create` row.

- [ ] **Step 4: Cleanup**

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM platform.tenants WHERE slug='\''smoke-test'\'';"'
```

(CASCADE drops grants, overlays, identity, invite link.)

---

## Self-review

- [ ] All 11 routes return correct status codes for both staff and non-staff JWTs.
- [ ] Re-running `POST /api/platform/tenants` with the same slug is a no-op (one tenant row, one audit row per attempt).
- [ ] `publish` archives the previous published row in the same statement that promotes the draft (verify by querying for `status='published'` after publish — exactly one row per tenant/app).
- [ ] `revert` creates a NEW version (never re-promotes an old row).
- [ ] Resolver cache is busted within the same transaction as publish.
- [ ] Phase 4 branch is `feat/tenant-setup-phase-04-provisioning`. Merge to `main` before Phase 5.
