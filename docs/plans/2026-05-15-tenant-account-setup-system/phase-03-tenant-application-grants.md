# Phase 3 — Per-tenant app grants

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make "which apps does this tenant have access to?" a first-class data point. New tenants no longer auto-see every active app; they see only the apps explicitly granted to them.

**Architecture:**
1. New table `platform.tenant_application_grants(tenant_id, app_id, status, granted_at, granted_by, revoked_at, revoked_by)`. Status ∈ {`active`, `suspended`, `revoked`}.
2. `GET /api/apps` filters by grants for the calling tenant. Result: app switcher hides ungranted apps automatically.
3. App switcher and access-role grants both refer to the same source of truth — RBAC `access_role_application_grants` continues to gate USER-level access *within* the apps a tenant has, but the tenant-level grant is the gate above that.
4. Migration backfills: every existing `(tenant, app)` pair where the tenant has at least one user with `access_role_application_grants` for that app gets an `active` row. TatvaCare ends up with all 3 active grants.

---

## Files

- **Create:**
  - `backend/alembic/versions/0032_tenant_application_grants.py`
  - `backend/app/models/tenant_application_grant.py`
  - `backend/tests/services/test_app_grants_filter.py`
- **Modify:**
  - `backend/app/routes/apps.py` — `list_apps` filters by grants
  - `backend/app/models/__init__.py` — register
  - `CLAUDE.md` — invariant on app visibility

---

## Task T3.1 — Migration with backfill

- [ ] **Step 1: Write `0032_tenant_application_grants.py`**

```python
"""Per-tenant app grants table + backfill from RBAC.

Revision ID: 0032_tenant_app_grants
Revises: 0031_platform_staff_tier
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0032_tenant_app_grants"
down_revision = "0031_platform_staff_tier"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_application_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("app_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.applications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'active'")),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("granted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("status IN ('active', 'suspended', 'revoked')", name="ck_grant_status"),
        sa.UniqueConstraint("tenant_id", "app_id", name="uq_grant_tenant_app"),
        schema="platform",
    )

    # Backfill: any (tenant, app) pair where some user of the tenant has
    # an access_role_application_grant gets an active grant.
    op.execute("""
        INSERT INTO platform.tenant_application_grants (tenant_id, app_id, status)
        SELECT DISTINCT u.tenant_id, arag.app_id, 'active'
        FROM platform.users u
        JOIN platform.access_roles ar ON ar.tenant_id = u.tenant_id
        JOIN platform.access_role_application_grants arag ON arag.role_id = ar.id
        ON CONFLICT (tenant_id, app_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.drop_table("tenant_application_grants", schema="platform")
```

- [ ] **Step 2: Apply + verify backfill**

```bash
docker compose exec backend alembic upgrade head
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT t.name, a.slug, g.status FROM platform.tenant_application_grants g JOIN platform.tenants t ON t.id=g.tenant_id JOIN platform.applications a ON a.id=g.app_id ORDER BY t.name, a.slug;"'
```

Expected: TatvaCare appears with rows for voice-rx, kaira-bot, inside-sales, all `active`.

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/0032_tenant_application_grants.py
git commit -m "feat(db): tenant_application_grants table + RBAC backfill"
```

---

## Task T3.2 — ORM model

- [ ] **Step 1: Write `backend/app/models/tenant_application_grant.py`**

```python
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TenantApplicationGrant(Base):
    """Tenant-level access to an app. Sits above RBAC: a user inside a
    tenant can only access an app if BOTH (a) the tenant has an active
    grant for that app AND (b) the user's role grants the app via
    `access_role_application_grants`."""

    __tablename__ = "tenant_application_grants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    app_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.applications.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        CheckConstraint("status IN ('active', 'suspended', 'revoked')", name="ck_grant_status"),
        UniqueConstraint("tenant_id", "app_id", name="uq_grant_tenant_app"),
        {"schema": "platform"},
    )
```

- [ ] **Step 2: Register in `backend/app/models/__init__.py`**

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/tenant_application_grant.py backend/app/models/__init__.py
git commit -m "feat(models): TenantApplicationGrant"
```

---

## Task T3.3 — Filter `GET /api/apps` by grants

- [ ] **Step 1: Update `list_apps` in `backend/app/routes/apps.py`**

```python
@router.get("")
async def list_apps(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """List apps the calling tenant has an active grant for."""
    stmt = (
        select(Application)
        .join(TenantApplicationGrant, TenantApplicationGrant.app_id == Application.id)
        .where(
            Application.is_active.is_(True),
            TenantApplicationGrant.tenant_id == auth.tenant_id,
            TenantApplicationGrant.status == "active",
        )
        .order_by(Application.slug)
    )
    apps = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": str(a.id),
            "slug": a.slug,
            "displayName": a.display_name,
            "description": a.description,
            "iconUrl": a.icon_url,
            "isActive": a.is_active,
        }
        for a in apps
    ]
```

Add `from app.models.tenant_application_grant import TenantApplicationGrant` to imports.

- [ ] **Step 2: Write the test**

```python
# backend/tests/services/test_app_grants_filter.py
import pytest

pytestmark = pytest.mark.asyncio


async def test_list_apps_returns_only_granted(client, tenant_with_one_grant_auth):
    """Tenant has one grant (kaira-bot) — list_apps must return ONLY kaira-bot."""
    response = await client.get("/api/apps", headers=tenant_with_one_grant_auth)
    assert response.status_code == 200
    body = response.json()
    assert {a["slug"] for a in body} == {"kaira-bot"}


async def test_list_apps_excludes_revoked(client, tenant_with_revoked_grant_auth):
    """A grant with status='revoked' is excluded from list_apps."""
    response = await client.get("/api/apps", headers=tenant_with_revoked_grant_auth)
    body = response.json()
    assert len(body) == 0
```

- [ ] **Step 3: Run + commit**

```bash
pytest backend/tests/services/test_app_grants_filter.py -v
git add backend/app/routes/apps.py backend/tests/services/test_app_grants_filter.py
git commit -m "feat(apps): list_apps filters by tenant_application_grants"
```

---

## Task T3.4 — Browser smoke

- [ ] **Step 1: Manually revoke a grant via SQL**

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE platform.tenant_application_grants SET status='\''revoked'\'' WHERE app_id IN (SELECT id FROM platform.applications WHERE slug='\''voice-rx'\'');"'
```

- [ ] **Step 2: Reload the FE in browser, open the app switcher**

Expected: Voice Rx is gone from the switcher dropdown (only Kaira Bot, Inside Sales, Admin show).

- [ ] **Step 3: Restore**

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE platform.tenant_application_grants SET status='\''active'\'' WHERE app_id IN (SELECT id FROM platform.applications WHERE slug='\''voice-rx'\'');"'
```

Expected: Voice Rx reappears after FE reload.

---

## Task T3.5 — Invariant in CLAUDE.md

```markdown
- **App visibility for a user is the AND of (a) tenant has an active `tenant_application_grant` for the app AND (b) user's access role has the app via `access_role_application_grants`.** Backend enforces (a) at `GET /api/apps`; frontend enforces (b) via `user.appAccess`. Adding a new app to a tenant means inserting both grant rows; revoking access via either is sufficient. Reason: tenant-level commercial control is independent of user-level RBAC.
```

Commit:
```bash
git add CLAUDE.md
git commit -m "docs(grants): invariant — tenant-grant AND role-grant for app visibility"
```

---

## Self-review

- [ ] Backfill creates the right number of rows for the existing TatvaCare tenant (3 apps × 1 tenant = 3 rows).
- [ ] `pytest backend/tests/services/test_app_grants_filter.py -v` green.
- [ ] Browser smoke: revoking a grant removes the app from the switcher within one reload.
- [ ] CLAUDE.md invariant added.
- [ ] Phase 3 branch is `feat/tenant-setup-phase-03-app-grants`. Merge to `main` before Phase 4.
