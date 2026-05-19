"""Admin /api/admin/orchestration/comm-cap endpoint tests.

Covers: GET empty, PUT upsert + audit log row, list scoping, non-admin 403.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app
from app.models.audit_log import AuditEventLog
from app.models.comm_cap_policy import CommCapPolicy


def _override_db(db_session):
    async def _g():
        yield db_session

    fastapi_app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]


def _set_super_admin():
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=SYSTEM_TENANT_ID,
        email="super@platform.local",
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset({"orchestration:admin:comm_cap"}),
        app_access=frozenset({"test-orchestration"}),
    )
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth
    return auth


def _set_non_admin():
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=SYSTEM_TENANT_ID,
        email="member@local",
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset(),
        app_access=frozenset({"test-orchestration"}),
    )
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth
    return auth


@pytest_asyncio.fixture
async def admin_client(db_session):
    _override_db(db_session)
    _set_super_admin()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


@pytest_asyncio.fixture
async def non_admin_client(db_session):
    _override_db(db_session)
    _set_non_admin()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


@pytest.mark.asyncio
async def test_get_returns_null_when_no_policy(admin_client):
    resp = await admin_client.get(
        "/api/admin/orchestration/comm-cap",
        params={"tenantId": str(SYSTEM_TENANT_ID), "appId": "test-orchestration"},
    )
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio
async def test_put_creates_policy_and_writes_audit(admin_client, db_session):
    app_id = f"app-{uuid.uuid4().hex[:8]}"
    resp = await admin_client.put(
        "/api/admin/orchestration/comm-cap",
        json={
            "tenantId": str(SYSTEM_TENANT_ID),
            "appId": app_id,
            "maxCount": 3,
            "windowSeconds": 86400,
            "isActive": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["maxCount"] == 3
    assert body["windowSeconds"] == 86400
    assert body["isActive"] is True
    assert body["appId"] == app_id

    policy = (
        await db_session.execute(
            select(CommCapPolicy).where(
                CommCapPolicy.tenant_id == SYSTEM_TENANT_ID,
                CommCapPolicy.app_id == app_id,
            )
        )
    ).scalar_one()
    assert policy.max_count == 3

    audit = (
        await db_session.execute(
            select(AuditEventLog)
            .where(
                AuditEventLog.entity_type == "comm_cap_policy",
                AuditEventLog.entity_id == policy.id,
            )
            .order_by(AuditEventLog.created_at.desc())
        )
    ).scalars().first()
    assert audit is not None
    assert audit.action == "orchestration.comm_cap.upsert"
    assert audit.before_state is None
    assert audit.after_state["max_count"] == 3
    assert audit.after_state["window_seconds"] == 86400


@pytest.mark.asyncio
async def test_put_updates_existing_policy_with_before_state(admin_client, db_session):
    app_id = f"app-{uuid.uuid4().hex[:8]}"
    await admin_client.put(
        "/api/admin/orchestration/comm-cap",
        json={
            "tenantId": str(SYSTEM_TENANT_ID),
            "appId": app_id,
            "maxCount": 2,
            "windowSeconds": 3600,
            "isActive": True,
        },
    )
    resp = await admin_client.put(
        "/api/admin/orchestration/comm-cap",
        json={
            "tenantId": str(SYSTEM_TENANT_ID),
            "appId": app_id,
            "maxCount": 5,
            "windowSeconds": 7200,
            "isActive": False,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["maxCount"] == 5
    assert resp.json()["isActive"] is False

    audits = (
        await db_session.execute(
            select(AuditEventLog).where(
                AuditEventLog.entity_type == "comm_cap_policy",
            )
        )
    ).scalars().all()
    # The update audit is the one whose after_state captures max_count=5.
    update_audit = next(
        a for a in audits if (a.after_state or {}).get("max_count") == 5
    )
    assert update_audit.before_state is not None
    assert update_audit.before_state["max_count"] == 2


@pytest.mark.asyncio
async def test_non_admin_token_gets_403(non_admin_client):
    resp = await non_admin_client.get(
        "/api/admin/orchestration/comm-cap",
        params={"tenantId": str(SYSTEM_TENANT_ID), "appId": "test-orchestration"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_returns_only_admins_tenant_for_non_super_admin(
    db_session,
):
    other_tenant = uuid.uuid4()
    db_session.add(
        CommCapPolicy(
            tenant_id=SYSTEM_TENANT_ID,
            app_id="my-app",
            max_count=2,
            window_seconds=3600,
        )
    )
    db_session.add(
        CommCapPolicy(
            tenant_id=other_tenant,
            app_id="other-app",
            max_count=3,
            window_seconds=3600,
        )
    )
    await db_session.flush()

    _override_db(db_session)
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=SYSTEM_TENANT_ID,
        email="tenant-admin@local",
        role_id=uuid.uuid4(),
        is_owner=False,  # not super-admin
        permissions=frozenset({"orchestration:admin:comm_cap"}),
        app_access=frozenset({"my-app"}),
    )
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as c:
            resp = await c.get("/api/admin/orchestration/comm-cap/list")
            assert resp.status_code == 200
            tenants = {row["tenantId"] for row in resp.json()}
            assert tenants == {str(SYSTEM_TENANT_ID)}
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)
