# Phase 2 — Platform-staff tier

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Introduce a first-class "TatvaCare staff" actor that exists outside the per-tenant scoping invariant, plus a separate audit log for cross-tenant writes.

**Architecture:**
1. New boolean column `platform.users.is_platform_staff`. Default false. Set true for the bootstrap admin in seed.
2. New table `platform.platform_audit_event_logs` — same shape as `audit_event_logs` minus the tenant FK (intentionally; events span tenants).
3. New auth dependency `require_platform_staff` that re-uses `get_auth_context` then asserts the boolean. Bypasses tenant filter.
4. New healthz route `GET /api/platform/healthz` as the proof-of-life smoke test.

**Why a separate audit table:** existing `audit_event_logs` is `(tenant_id, ...)` — a hard schema invariant. Cross-tenant events would either need a sentinel `tenant_id` (smell) or violate the invariant. A second table keeps both clean.

---

## Files

- **Create:**
  - `backend/alembic/versions/0031_platform_staff_tier.py`
  - `backend/app/models/platform_audit_event_log.py`
  - `backend/app/auth/platform_dependency.py` (`require_platform_staff`)
  - `backend/app/routes/platform.py` (new router; healthz only this phase)
  - `backend/tests/auth/test_platform_dependency.py`
  - `backend/tests/routes/test_platform_healthz.py`

- **Modify:**
  - `backend/app/models/user.py` — add `is_platform_staff` column
  - `backend/app/services/seed_defaults.py` — `seed_bootstrap_admin` sets `is_platform_staff=True`
  - `backend/app/main.py` — register the platform router
  - `backend/app/auth/context.py` — load `is_platform_staff` into `AuthContext`
  - `CLAUDE.md` — invariant: cross-tenant writes go through `require_platform_staff` AND emit `platform_audit_event_logs`

---

## Task T2.1 — Migration

- [ ] **Step 1: Write `backend/alembic/versions/0031_platform_staff_tier.py`**

```python
"""Add User.is_platform_staff + platform_audit_event_logs.

Revision ID: 0031_platform_staff_tier
Revises: 0030_tenant_app_configs
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0031_platform_staff_tier"
down_revision = "0030_tenant_app_configs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_platform_staff", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        schema="platform",
    )

    op.create_table(
        "platform_audit_event_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_email_snapshot", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("target_type", sa.String(length=50), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema="platform",
    )

    op.create_index(
        "ix_platform_audit_target_tenant",
        "platform_audit_event_logs",
        ["target_tenant_id", "created_at"],
        schema="platform",
    )
    op.create_index(
        "ix_platform_audit_actor",
        "platform_audit_event_logs",
        ["actor_user_id", "created_at"],
        schema="platform",
    )


def downgrade() -> None:
    op.drop_index("ix_platform_audit_actor", table_name="platform_audit_event_logs", schema="platform")
    op.drop_index("ix_platform_audit_target_tenant", table_name="platform_audit_event_logs", schema="platform")
    op.drop_table("platform_audit_event_logs", schema="platform")
    op.drop_column("users", "is_platform_staff", schema="platform")
```

- [ ] **Step 2: Apply + verify**

```bash
docker compose exec backend alembic upgrade head
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d platform.users" | grep is_platform_staff'
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d platform.platform_audit_event_logs"'
```

Expected: column appears; new table appears with both indices.

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/0031_platform_staff_tier.py
git commit -m "feat(db): User.is_platform_staff + platform_audit_event_logs"
```

---

## Task T2.2 — ORM models

- [ ] **Step 1: Add column to User**

```python
# backend/app/models/user.py — append to the User class
is_platform_staff: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
```

(Add `text` to imports if not already present; same for `Boolean`.)

- [ ] **Step 2: Create `backend/app/models/platform_audit_event_log.py`**

```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PlatformAuditEventLog(Base):
    """Cross-tenant audit log. Distinct from `platform.audit_event_logs`,
    which is per-tenant — that table requires `tenant_id`, which a
    cross-tenant action cannot truthfully populate."""

    __tablename__ = "platform_audit_event_logs"
    __table_args__ = {"schema": "platform"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True
    )
    actor_email_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    target_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="SET NULL"), nullable=True
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 3: Register in `backend/app/models/__init__.py`**

Add `from app.models.platform_audit_event_log import PlatformAuditEventLog` (preserve sort order).

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/user.py backend/app/models/platform_audit_event_log.py backend/app/models/__init__.py
git commit -m "feat(models): User.is_platform_staff + PlatformAuditEventLog"
```

---

## Task T2.3 — `require_platform_staff` dependency + audit helper

- [ ] **Step 1: Update `AuthContext` to load the flag**

Find `backend/app/auth/context.py`, add `is_platform_staff: bool` to the dataclass and populate it from the user row.

- [ ] **Step 2: Write `backend/app/auth/platform_dependency.py`**

```python
"""Platform-staff auth dependency + audit helper.

Use `require_platform_staff` for any endpoint that reads or writes data
across tenant boundaries (listing all tenants, creating a tenant, editing
another tenant's overlay, etc). It bypasses the per-tenant filter
invariant — every call site that uses it MUST also write a
`PlatformAuditEventLog` row in the same transaction. The helper
`record_platform_audit` enforces the call-site convention.
"""
from typing import Any
import uuid

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.database import get_db
from app.models.platform_audit_event_log import PlatformAuditEventLog


async def require_platform_staff(
    auth: AuthContext = Depends(get_auth_context),
) -> AuthContext:
    if not auth.is_platform_staff:
        raise HTTPException(status_code=403, detail="Platform staff required")
    return auth


async def record_platform_audit(
    db: AsyncSession,
    actor: AuthContext,
    *,
    action: str,
    target_type: str,
    target_id: uuid.UUID | None = None,
    target_tenant_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """Insert a platform audit row. Caller is responsible for the surrounding
    transaction. Email snapshot lets rows survive actor deletion."""
    db.add(PlatformAuditEventLog(
        actor_user_id=actor.user_id,
        actor_email_snapshot=actor.email,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_tenant_id=target_tenant_id,
        payload=payload or {},
    ))
```

- [ ] **Step 3: Write the test**

```python
# backend/tests/auth/test_platform_dependency.py
import pytest
from fastapi import Depends, FastAPI
from httpx import AsyncClient

from app.auth.context import AuthContext
from app.auth.platform_dependency import require_platform_staff

pytestmark = pytest.mark.asyncio


def _make_app():
    app = FastAPI()

    @app.get("/probe")
    async def probe(auth: AuthContext = Depends(require_platform_staff)):
        return {"ok": True, "user_id": str(auth.user_id)}

    return app


async def test_require_platform_staff_403_for_regular_user(client_factory, regular_user_auth_override):
    app = _make_app()
    async with client_factory(app, auth_override=regular_user_auth_override) as client:
        response = await client.get("/probe")
        assert response.status_code == 403
        assert response.json()["detail"] == "Platform staff required"


async def test_require_platform_staff_200_for_staff_user(client_factory, staff_user_auth_override):
    app = _make_app()
    async with client_factory(app, auth_override=staff_user_auth_override) as client:
        response = await client.get("/probe")
        assert response.status_code == 200
```

- [ ] **Step 4: Run**

`pytest backend/tests/auth/test_platform_dependency.py -v` → 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth/context.py backend/app/auth/platform_dependency.py backend/tests/auth/test_platform_dependency.py
git commit -m "feat(auth): require_platform_staff dependency + audit helper"
```

---

## Task T2.4 — `/api/platform/healthz` smoke route

- [ ] **Step 1: Write `backend/app/routes/platform.py`**

```python
"""Platform-scoped routes — cross-tenant operations.

Every endpoint here is gated by `require_platform_staff`. v1 ships only
the healthz probe; tenant-management routes land in Phase 4.
"""
from fastapi import APIRouter, Depends

from app.auth.context import AuthContext
from app.auth.platform_dependency import require_platform_staff

router = APIRouter(prefix="/api/platform", tags=["platform"])


@router.get("/healthz")
async def platform_healthz(auth: AuthContext = Depends(require_platform_staff)):
    return {"ok": True, "actor": auth.email}
```

- [ ] **Step 2: Register in `backend/app/main.py`**

Add `from app.routes import platform` and `app.include_router(platform.router)` next to the other router includes.

- [ ] **Step 3: Add the integration test**

```python
# backend/tests/routes/test_platform_healthz.py
import pytest

pytestmark = pytest.mark.asyncio


async def test_healthz_403_for_regular_user(client, regular_user_auth):
    response = await client.get("/api/platform/healthz", headers=regular_user_auth)
    assert response.status_code == 403


async def test_healthz_200_for_platform_staff(client, platform_staff_auth):
    response = await client.get("/api/platform/healthz", headers=platform_staff_auth)
    assert response.status_code == 200
    assert response.json()["ok"] is True
```

- [ ] **Step 4: Run + commit**

```bash
pytest backend/tests/routes/test_platform_healthz.py -v
git add backend/app/routes/platform.py backend/app/main.py backend/tests/routes/test_platform_healthz.py
git commit -m "feat(platform): /api/platform/healthz gated by platform-staff"
```

---

## Task T2.5 — Bootstrap admin gets the staff bit

- [ ] **Step 1: Update `seed_bootstrap_admin` in `seed_defaults.py`**

Find the function (~line 2928), set `is_platform_staff=True` on the bootstrap user. Idempotent: if user already exists with the field false, flip to true.

```python
# inside seed_bootstrap_admin
if not user.is_platform_staff:
    user.is_platform_staff = True
    logger.info("Marked bootstrap admin as platform staff")
```

- [ ] **Step 2: Restart + verify**

```bash
docker compose restart backend && sleep 8
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT email, is_platform_staff FROM platform.users WHERE is_platform_staff = true;"'
```

Expected: bootstrap admin email shows up.

- [ ] **Step 3: Curl the healthz with the bootstrap admin's JWT**

(Get JWT from a fresh login as the bootstrap admin, then:)

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8721/api/platform/healthz
```

Expected: `{"ok":true,"actor":"<email>"}`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/seed_defaults.py
git commit -m "chore(seed): bootstrap admin gets is_platform_staff=true"
```

---

## Task T2.6 — Invariant in CLAUDE.md

- [ ] **Step 1: Append**

```markdown
- **Cross-tenant writes MUST be gated by `require_platform_staff` AND emit a `PlatformAuditEventLog` row in the same transaction.** This is the only legitimate way to bypass the per-tenant filter invariant; any new endpoint that touches more than one tenant's data is a code-review failure if it lacks both. Helper: `app.auth.platform_dependency.record_platform_audit(...)`. Reason: cross-tenant access is the highest-risk operation in the system; an audit gap here is a security incident, not a hygiene issue.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(platform): invariant — cross-tenant writes need staff gate + audit"
```

---

## Self-review

- [ ] `pytest backend/tests/auth/test_platform_dependency.py backend/tests/routes/test_platform_healthz.py -v` green.
- [ ] `is_platform_staff=true` appears on bootstrap admin in DB.
- [ ] Regular user's JWT against `/api/platform/healthz` returns 403; staff JWT returns 200.
- [ ] CLAUDE.md invariant added.
- [ ] Phase 2 branch is `feat/tenant-setup-phase-02-staff-tier`. Merge to `main` before Phase 3.
