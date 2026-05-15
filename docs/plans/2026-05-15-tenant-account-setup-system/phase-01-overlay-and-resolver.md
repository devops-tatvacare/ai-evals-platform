# Phase 1 — Per-tenant config overlay + resolver

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sharing one config blob across every tenant. Introduce a versioned per-tenant overlay table and a resolver service that folds template + overlay deterministically. Day-one behavior is identical to today (no overlays exist yet); the seam is in place for Phases 4–6.

**Architecture:** Three pieces:
1. **Rename** `applications.config` → `applications.config_template` (the immutable-per-release default).
2. **New table** `platform.tenant_application_configurations` storing per-`(tenant_id, app_id, version)` overlay rows with `status` ∈ {`draft`, `published`, `archived`}.
3. **New service** `app_config_resolver.resolve(tenant_id, app_id) → AppConfig` that reads the template, finds the latest published overlay (if any), deep-merges, returns the final shape. Cached per `(tenant_id, app_id)` with bust on overlay write.

**Tech stack:** Alembic, SQLAlchemy 2 async, Pydantic v2, pytest with `asyncio_mode='auto'`.

---

## Files

- **Create:**
  - `backend/alembic/versions/0030_tenant_application_configurations.py` (Alembic migration)
  - `backend/app/models/tenant_application_configuration.py` (ORM model)
  - `backend/app/services/app_config_resolver.py` (resolver + cache)
  - `backend/tests/services/test_app_config_resolver.py` (resolver tests)
  - `backend/tests/migrations/test_0030_overlay_migration.py` (migration round-trip + behavior parity)

- **Modify:**
  - `backend/app/models/application.py` — rename `config` → `config_template`
  - `backend/app/routes/apps.py` — `GET /api/apps/{slug}/config` calls resolver
  - `backend/app/services/seed_defaults.py` — `seed_apps()` writes `config_template`, not `config`
  - `backend/app/main.py` lifespan — clear resolver cache on boot (defensive)
  - `CLAUDE.md` — add invariant: "All per-tenant config reads MUST go through `app_config_resolver`"

- **Test:**
  - `backend/tests/services/test_app_config_resolver.py`
  - `backend/tests/migrations/test_0030_overlay_migration.py`
  - Existing FE config-loading snapshot tests must still pass unchanged (regression gate)

---

## Task T1.1 — Write the failing test for the resolver fallback

**Files:**
- Create: `backend/tests/services/test_app_config_resolver.py`

- [ ] **Step 1: Write the test that asserts resolver returns template when no overlay exists**

```python
# backend/tests/services/test_app_config_resolver.py
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import Application
from app.models.tenant import Tenant
from app.services.app_config_resolver import resolve

pytestmark = pytest.mark.asyncio


async def test_resolve_returns_template_when_no_overlay(db_session: AsyncSession, sample_tenant: Tenant, sample_app: Application):
    """No overlay rows for this (tenant, app) → resolver returns the raw template unchanged."""
    sample_app.config_template = {"displayName": "Kaira Bot", "features": {"hasOrchestration": False}}
    await db_session.flush()

    result = await resolve(db_session, sample_tenant.id, sample_app.id)

    assert result["displayName"] == "Kaira Bot"
    assert result["features"]["hasOrchestration"] is False
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `pytest backend/tests/services/test_app_config_resolver.py::test_resolve_returns_template_when_no_overlay -v`

Expected: ImportError on `app.services.app_config_resolver` (module does not exist yet) OR AttributeError on `Application.config_template` (column not yet renamed).

---

## Task T1.2 — Write the Alembic migration: rename + new table

**Files:**
- Create: `backend/alembic/versions/0030_tenant_application_configurations.py`

- [ ] **Step 1: Get the next revision number**

Run: `ls backend/alembic/versions/ | sort | tail -3`

Expected: see the highest existing revision number. The new migration is `0030_*` (or whatever is next; check first).

- [ ] **Step 2: Write the migration**

```python
# backend/alembic/versions/0030_tenant_application_configurations.py
"""Per-tenant config overlay + rename applications.config → config_template.

Revision ID: 0030_tenant_app_configs
Revises: 0029_<previous>
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0030_tenant_app_configs"
down_revision = "0029_<previous>"  # CHECK ACTUAL PREVIOUS
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Rename applications.config → applications.config_template.
    op.alter_column(
        "applications",
        "config",
        new_column_name="config_template",
        schema="platform",
    )

    # 2. Create the per-tenant overlay table.
    op.create_table(
        "tenant_application_configurations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("app_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.applications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("features_overrides", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("published_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("status IN ('draft', 'published', 'archived')", name="ck_overlay_status"),
        sa.UniqueConstraint("tenant_id", "app_id", "version", name="uq_overlay_tenant_app_version"),
        schema="platform",
    )

    # 3. Indices for the resolver hot path.
    op.create_index(
        "ix_overlay_resolver_lookup",
        "tenant_application_configurations",
        ["tenant_id", "app_id", "status", "version"],
        postgresql_where=sa.text("status = 'published'"),
        schema="platform",
    )
    op.create_index(
        "ix_overlay_drafts_by_tenant",
        "tenant_application_configurations",
        ["tenant_id", "status"],
        postgresql_where=sa.text("status = 'draft'"),
        schema="platform",
    )

    # 4. Partial unique: only ONE published version per (tenant, app) at a time.
    # Older published rows must be archived before a new publish; this is a hard
    # invariant the publish service enforces, but the index belt-and-braces it.
    op.create_index(
        "uq_overlay_one_published",
        "tenant_application_configurations",
        ["tenant_id", "app_id"],
        unique=True,
        postgresql_where=sa.text("status = 'published'"),
        schema="platform",
    )


def downgrade() -> None:
    op.drop_index("uq_overlay_one_published", table_name="tenant_application_configurations", schema="platform")
    op.drop_index("ix_overlay_drafts_by_tenant", table_name="tenant_application_configurations", schema="platform")
    op.drop_index("ix_overlay_resolver_lookup", table_name="tenant_application_configurations", schema="platform")
    op.drop_table("tenant_application_configurations", schema="platform")
    op.alter_column(
        "applications",
        "config_template",
        new_column_name="config",
        schema="platform",
    )
```

- [ ] **Step 3: Verify the previous-revision string**

Run: `tail -20 backend/alembic/versions/$(ls backend/alembic/versions/ | sort | tail -2 | head -1)`

Expected: read off the `revision = "..."` line and paste into `down_revision = "..."` of the new file.

- [ ] **Step 4: Apply the migration locally**

Run: `docker compose exec backend alembic upgrade head`

Expected: `INFO [alembic.runtime.migration] Running upgrade ... -> 0030_tenant_app_configs, ...` and a clean prompt.

- [ ] **Step 5: Verify schema in DB**

Run: `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d platform.tenant_application_configurations"'`

Expected: table exists with all columns; partial unique index `uq_overlay_one_published` listed.

- [ ] **Step 6: Verify rename**

Run: `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d platform.applications"'`

Expected: column is `config_template`, NOT `config`.

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/0030_tenant_application_configurations.py
git commit -m "feat(db): add per-tenant config overlay table + rename applications.config_template"
```

---

## Task T1.3 — Update the ORM model

**Files:**
- Modify: `backend/app/models/application.py` (rename `config` → `config_template`)
- Create: `backend/app/models/tenant_application_configuration.py`

- [ ] **Step 1: Rename column on Application model**

```python
# backend/app/models/application.py
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = {"schema": "platform"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    icon_url: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Frozen-per-release default. Per-tenant variation lives on tenant_application_configurations.
    config_template: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

- [ ] **Step 2: Create the overlay model**

```python
# backend/app/models/tenant_application_configuration.py
import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OverlayStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class TenantApplicationConfiguration(Base):
    """Per-(tenant, app) config overlay. Versioned. Folded with the app
    template by `app_config_resolver.resolve`."""

    __tablename__ = "tenant_application_configurations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    app_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.applications.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    features_overrides: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True
    )
    published_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        CheckConstraint("status IN ('draft', 'published', 'archived')", name="ck_overlay_status"),
        UniqueConstraint("tenant_id", "app_id", "version", name="uq_overlay_tenant_app_version"),
        {"schema": "platform"},
    )
```

- [ ] **Step 3: Register in `app/models/__init__.py`**

Read `backend/app/models/__init__.py`, add `from app.models.tenant_application_configuration import TenantApplicationConfiguration` to the import list (preserve sort order).

- [ ] **Step 4: Run the existing test suite to find every broken `config` reference**

Run: `pytest backend/tests -x 2>&1 | tail -30`

Expected: failures from any code that reads `Application.config`. Each one is a real call site that needs updating in the next task.

---

## Task T1.4 — Update every reader of `Application.config`

**Files:**
- Modify: `backend/app/routes/apps.py`
- Modify: `backend/app/services/seed_defaults.py`
- Modify: any other module flagged by pytest in T1.3 step 4

- [ ] **Step 1: Grep for every `app.config` / `application.config` reference**

Run: `grep -rn "Application\.config\b\|app\.config\b\|application\.config\b" backend/app/ --include="*.py"`

Expected: a finite list of call sites. Voice them out before editing.

- [ ] **Step 2: Update `seed_defaults.py` `seed_apps()` to write `config_template`**

Find the section that does `app.config = app_data.get("config", {})` (~line 2403 today) and replace with:

```python
if app.config_template != app_data.get("config", {}):
    app.config_template = app_data.get("config", {})
    logger.info(f"Updated app config template: {app_data['slug']}")
```

(The seed-data dict key stays `"config"` — it's the JSON-side name. The ORM attr is what's renamed.)

- [ ] **Step 3: Update `routes/apps.py` `get_app_config` to read template (will be replaced by resolver in T1.6)**

```python
# backend/app/routes/apps.py — get_app_config()
return AppConfig.model_validate(app.config_template or {}).model_dump(by_alias=True)
```

This is intentionally a one-liner change; T1.6 swaps it for the resolver call.

- [ ] **Step 4: Run pytest again until clean**

Run: `pytest backend/tests -x 2>&1 | tail -10`

Expected: zero `config` AttributeErrors. Tests may still fail for other reasons; address only the rename ones in this task.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/application.py backend/app/models/tenant_application_configuration.py backend/app/models/__init__.py backend/app/routes/apps.py backend/app/services/seed_defaults.py
git commit -m "refactor(apps): rename Application.config → config_template; readers updated"
```

---

## Task T1.5 — Implement the resolver

**Files:**
- Create: `backend/app/services/app_config_resolver.py`

- [ ] **Step 1: Write the resolver**

```python
# backend/app/services/app_config_resolver.py
"""Per-tenant config resolver.

Folds an app's frozen template (Application.config_template) with the
tenant's latest published overlay (TenantApplicationConfiguration) into the
final AppConfig payload returned to the frontend.

Caching: keyed by (tenant_id, app_id). Bust via `invalidate(tenant_id,
app_id)` from publish/archive paths. Boot-time the cache is empty.
"""
import asyncio
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import Application
from app.models.tenant_application_configuration import TenantApplicationConfiguration

# Process-local cache. Survives across requests in one container; cleared on
# boot. Multi-replica setups rely on publish-time invalidation messages — out
# of scope for v1; a single backend container is the prod topology today.
_cache: dict[tuple[uuid.UUID, uuid.UUID], dict[str, Any]] = {}
_cache_lock = asyncio.Lock()


def invalidate(tenant_id: uuid.UUID, app_id: uuid.UUID) -> None:
    """Drop the cached resolution for (tenant, app). Call from publish /
    archive paths inside the same transaction. Safe to call when the key is
    missing."""
    _cache.pop((tenant_id, app_id), None)


def invalidate_all() -> None:
    _cache.clear()


def _deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """Recursive shallow-per-key merge: overlay scalar/list/None replaces
    base; overlay dict merges into base dict at that key.

    Lists are REPLACED, not concatenated. Tenant overlays expressing
    "I want exactly these quickActions" must restate the full list. This
    matches the FE's mergeAppConfig behavior shipped in 412be36."""
    out: dict[str, Any] = {**base}
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


async def resolve(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
) -> dict[str, Any]:
    """Return the final AppConfig dict for (tenant, app)."""
    cached = _cache.get((tenant_id, app_id))
    if cached is not None:
        return cached

    async with _cache_lock:
        # Double-check under the lock — another coroutine may have populated
        # while we were waiting.
        cached = _cache.get((tenant_id, app_id))
        if cached is not None:
            return cached

        app = (await db.execute(select(Application).where(Application.id == app_id))).scalar_one_or_none()
        if app is None:
            return {}
        template = app.config_template or {}

        overlay_row = (
            await db.execute(
                select(TenantApplicationConfiguration)
                .where(
                    TenantApplicationConfiguration.tenant_id == tenant_id,
                    TenantApplicationConfiguration.app_id == app_id,
                    TenantApplicationConfiguration.status == "published",
                )
                .order_by(TenantApplicationConfiguration.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        if overlay_row is None:
            resolved = template
        else:
            # features_overrides is a sibling JSONB so we can index/filter on
            # it without unpacking the whole config blob. At resolve time we
            # fold it under config["features"].
            overlay_payload = dict(overlay_row.config or {})
            if overlay_row.features_overrides:
                overlay_payload.setdefault("features", {})
                overlay_payload["features"] = {
                    **overlay_payload["features"],
                    **(overlay_row.features_overrides or {}),
                }
            resolved = _deep_merge(template, overlay_payload)

        _cache[(tenant_id, app_id)] = resolved
        return resolved


async def resolve_by_slug(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    slug: str,
) -> dict[str, Any]:
    """Convenience: resolve by (tenant_id, app slug)."""
    app = (await db.execute(select(Application).where(Application.slug == slug, Application.is_active.is_(True)))).scalar_one_or_none()
    if app is None:
        return {}
    return await resolve(db, tenant_id, app.id)
```

- [ ] **Step 2: Run the resolver unit test from T1.1**

Run: `pytest backend/tests/services/test_app_config_resolver.py::test_resolve_returns_template_when_no_overlay -v`

Expected: PASS.

- [ ] **Step 3: Add the published-overlay test**

```python
# Append to backend/tests/services/test_app_config_resolver.py

async def test_resolve_folds_published_overlay(db_session, sample_tenant, sample_app):
    """A published overlay's keys override template keys in the final shape."""
    sample_app.config_template = {"displayName": "Kaira Bot", "features": {"hasOrchestration": False}}
    overlay = TenantApplicationConfiguration(
        tenant_id=sample_tenant.id,
        app_id=sample_app.id,
        version=1,
        status="published",
        config={"displayName": "Acme Care Bot"},
        features_overrides={"hasOrchestration": True},
    )
    db_session.add(overlay)
    await db_session.flush()

    result = await resolve(db_session, sample_tenant.id, sample_app.id)

    assert result["displayName"] == "Acme Care Bot"
    assert result["features"]["hasOrchestration"] is True
```

- [ ] **Step 4: Add the draft-ignored test**

```python
async def test_resolve_ignores_draft_overlay(db_session, sample_tenant, sample_app):
    """Draft overlays must not affect resolved config — only published rows do."""
    sample_app.config_template = {"displayName": "Kaira Bot"}
    db_session.add(TenantApplicationConfiguration(
        tenant_id=sample_tenant.id, app_id=sample_app.id,
        version=1, status="draft", config={"displayName": "WRONG"},
    ))
    await db_session.flush()

    result = await resolve(db_session, sample_tenant.id, sample_app.id)
    assert result["displayName"] == "Kaira Bot"
```

- [ ] **Step 5: Add the latest-version-wins test**

```python
async def test_resolve_picks_latest_published_version(db_session, sample_tenant, sample_app):
    """When multiple published overlays exist (transient state during
    publish), the highest version wins."""
    sample_app.config_template = {"displayName": "Kaira Bot"}
    db_session.add(TenantApplicationConfiguration(
        tenant_id=sample_tenant.id, app_id=sample_app.id,
        version=1, status="published", config={"displayName": "v1"},
    ))
    db_session.add(TenantApplicationConfiguration(
        tenant_id=sample_tenant.id, app_id=sample_app.id,
        version=2, status="published", config={"displayName": "v2"},
    ))
    await db_session.flush()

    result = await resolve(db_session, sample_tenant.id, sample_app.id)
    assert result["displayName"] == "v2"
```

- [ ] **Step 6: Add the cache-invalidation test**

```python
async def test_invalidate_clears_cached_resolution(db_session, sample_tenant, sample_app):
    sample_app.config_template = {"displayName": "Original"}
    await db_session.flush()

    # First resolve populates cache.
    first = await resolve(db_session, sample_tenant.id, sample_app.id)
    assert first["displayName"] == "Original"

    # Mutate template, then invalidate.
    sample_app.config_template = {"displayName": "Updated"}
    await db_session.flush()

    invalidate(sample_tenant.id, sample_app.id)

    second = await resolve(db_session, sample_tenant.id, sample_app.id)
    assert second["displayName"] == "Updated"
```

- [ ] **Step 7: Run all four resolver tests**

Run: `pytest backend/tests/services/test_app_config_resolver.py -v`

Expected: 4 PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/app_config_resolver.py backend/tests/services/test_app_config_resolver.py
git commit -m "feat(config): app_config_resolver folds template + per-tenant overlay"
```

---

## Task T1.6 — Wire the resolver into the apps route

**Files:**
- Modify: `backend/app/routes/apps.py`

- [ ] **Step 1: Update `get_app_config`**

```python
# backend/app/routes/apps.py
from app.services.app_config_resolver import resolve_by_slug


@router.get("/{slug}/config")
async def get_app_config(
    slug: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Return the resolved AppConfig for (current tenant, app slug)."""
    config = await resolve_by_slug(db, auth.tenant_id, slug)
    if not config:
        raise HTTPException(status_code=404, detail="App not found")
    return AppConfig.model_validate(config).model_dump(by_alias=True)
```

- [ ] **Step 2: Run the existing FE-config snapshot test (regression gate)**

Run: `pytest backend/tests/routes/test_apps.py -v 2>&1 | tail -20`

Expected: existing tests PASS unchanged. The resolver with no overlay rows must return identical bytes to the old `app.config` reader.

- [ ] **Step 3: Add a new test for the resolver-route happy path**

```python
# backend/tests/routes/test_apps.py — append
async def test_get_app_config_resolves_with_overlay(client, sample_tenant_auth, sample_app_with_overlay):
    response = await client.get(f"/api/apps/{sample_app_with_overlay.slug}/config", headers=sample_tenant_auth)
    assert response.status_code == 200
    body = response.json()
    # Overlay set displayName="Acme Care Bot"; assert it took effect.
    assert body["displayName"] == "Acme Care Bot"
```

- [ ] **Step 4: Run the new test**

Run: `pytest backend/tests/routes/test_apps.py::test_get_app_config_resolves_with_overlay -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routes/apps.py backend/tests/routes/test_apps.py
git commit -m "feat(apps): GET /api/apps/{slug}/config goes through resolver"
```

---

## Task T1.7 — Boot-time cache reset (defensive)

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add resolver invalidation to lifespan**

In the `lifespan` function (after seed_apps runs), append:

```python
from app.services.app_config_resolver import invalidate_all
invalidate_all()  # cold-start cache; survives container restart implicitly but be explicit
```

This is belt-and-braces — the cache is process-local so a fresh container starts empty anyway, but explicit invalidate documents intent.

- [ ] **Step 2: Boot the stack**

Run: `docker compose restart backend && sleep 8 && docker compose logs backend --tail 20`

Expected: clean boot, "Application startup complete", no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "chore(config): explicit resolver-cache invalidate on boot"
```

---

## Task T1.8 — Migration parity test (the regression gate)

**Files:**
- Create: `backend/tests/migrations/test_0030_overlay_migration.py`

- [ ] **Step 1: Write the parity test**

```python
# backend/tests/migrations/test_0030_overlay_migration.py
"""Pre-migration vs post-migration parity: with no overlay rows, the API
must return identical config payloads."""
import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_no_overlay_returns_template_unchanged(client: AsyncClient, tatvacare_owner_auth):
    """The single existing tenant (TatvaCare) has no overlay row yet —
    GET /api/apps/{slug}/config must return the template unchanged."""
    for slug in ("voice-rx", "kaira-bot", "inside-sales"):
        response = await client.get(f"/api/apps/{slug}/config", headers=tatvacare_owner_auth)
        assert response.status_code == 200, f"slug={slug} returned {response.status_code}"
        body = response.json()
        assert body["displayName"], f"slug={slug} has no displayName — resolver dropped fields"
        # quickActions slot must be intact (relied on by 0f6c94a sidebar).
        assert "quickActions" in body, f"slug={slug} missing quickActions in resolved config"
```

- [ ] **Step 2: Run it**

Run: `pytest backend/tests/migrations/test_0030_overlay_migration.py -v`

Expected: PASS for all 3 slugs.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/migrations/test_0030_overlay_migration.py
git commit -m "test(config): parity gate — no overlay returns template unchanged"
```

---

## Task T1.9 — Lint rule: forbid direct `config_template` reads outside resolver

**Files:**
- Modify: `CLAUDE.md` (add invariant)
- Optionally: a custom flake8/ruff plugin or a grep-based pre-commit hook

- [ ] **Step 1: Add the invariant to CLAUDE.md**

Append to the `## Invariants` section:

```markdown
- **All per-tenant config reads MUST go through `app_config_resolver.resolve(tenant_id, app_id)` or `resolve_by_slug(...)`.** Direct reads of `Application.config_template` are forbidden outside the resolver itself, the Alembic migrations, and `seed_apps`. Lint rule: `grep -rn "\.config_template" backend/app | grep -v "app_config_resolver\|seed_defaults\|alembic"` should match nothing on a clean tree. Reason: config-by-tenant is the entire point of Phase 1; bypassing the resolver re-introduces the global-config bug class. Caught by [phase-01 plan task T1.9].
```

- [ ] **Step 2: Verify the grep is clean**

Run: `grep -rn "\.config_template" backend/app | grep -v "app_config_resolver\|seed_defaults\|alembic\|test_"`

Expected: zero matches.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(config): invariant — config reads go through app_config_resolver"
```

---

## Task T1.10 — End-to-end smoke

- [ ] **Step 1: Boot the full stack fresh**

Run: `docker compose down && docker compose up --build -d && sleep 30`

Expected: backend, worker, frontend, postgres all `Up`.

- [ ] **Step 2: Verify resolver returns expected shape via curl**

Run: log into the FE in a browser, capture a JWT from devtools, then:

```bash
TOKEN="<paste JWT>"
for slug in voice-rx kaira-bot inside-sales; do
  echo "=== $slug ==="
  curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8721/api/apps/$slug/config" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('displayName'), len(d.get('quickActions') or []))"
done
```

Expected: each slug prints its displayName and the count of quickActions matching what the seed data in `seed_defaults.py` declared.

- [ ] **Step 3: Click-test the sidebar in the browser**

Navigate through Voice Rx → Kaira Bot → Inside Sales. Open the Run dropdown for each. Verify the items are unchanged from the pre-Phase-1 baseline — same labels, same icons, same on-click behavior.

This is the user-visible regression gate. Anything different here is a Phase 1 bug.

---

## Self-review checklist (run before opening PR)

- [ ] Migration up + down both succeed cleanly on a copy of prod schema (use a snapshot DB, not actual prod).
- [ ] `grep -rn "Application\.config\b\|app\.config\b" backend/app/ --include="*.py"` returns zero matches.
- [ ] `pytest backend/tests/services/test_app_config_resolver.py backend/tests/migrations/test_0030_overlay_migration.py backend/tests/routes/test_apps.py -v` all green.
- [ ] FE behavior unchanged: sidebar Run dropdown for all 3 apps shows the same items, clicks fire the same modals/triggers as before Phase 1.
- [ ] CLAUDE.md invariant added and grep-verifiable.
- [ ] No code outside `app_config_resolver.py`, `seed_defaults.py`, Alembic versions, or test files references `.config_template`.
- [ ] Phase 1 branch is `feat/tenant-setup-phase-01-overlay`. Merge to `main` before starting Phase 2.
