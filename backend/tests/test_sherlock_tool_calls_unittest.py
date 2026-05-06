"""Tests for ``GET /api/sherlock/tool-calls`` and detail endpoint.

Phase 15.1d — backend for the platform Logs page's Sherlock tab. Verifies:
  * tenant scoping (cross-tenant rows invisible),
  * user scoping (cross-user rows invisible — Sherlock is per-user),
  * app gating via ``auth.app_access``,
  * filters: ``toolName``, ``status``, ``sessionId``, ``dbSessionId``,
    ``since``/``until``,
  * stable ``total`` independent of ``limit`` for pagination,
  * detail endpoint returns full row,
  * detail endpoint returns 404 for foreign user / tenant.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app
from app.models.analytics_log import LogSherlockToolCall


def _override_db(db_session):
    async def _g():
        yield db_session
    fastapi_app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]


def _make_auth(
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID = SYSTEM_USER_ID,
    app_access: frozenset[str] = frozenset({"voice-rx", "kaira-bot", "inside-sales"}),
) -> AuthContext:
    return AuthContext(
        user_id=user_id,
        tenant_id=tenant_id,
        email="sherlock-test@local",
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset(),
        app_access=app_access,
    )


def _set_auth(auth: AuthContext) -> None:
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth


@pytest_asyncio.fixture
async def client(db_session):
    _override_db(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test"
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


async def _add_tool_call(
    db_session,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID = SYSTEM_USER_ID,
    app_id: str = "inside-sales",
    tool_name: str = "execute_canonical_sql",
    status: str = "success",
    session_id: str | None = None,
    db_session_id: uuid.UUID | None = None,
    arguments: dict | None = None,
    error_message: str | None = None,
    created_at: datetime | None = None,
) -> LogSherlockToolCall:
    row = LogSherlockToolCall(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        tool_name=tool_name,
        status=status,
        session_id=session_id,
        db_session_id=db_session_id,
        arguments=arguments or {},
        error_message=error_message,
        execution_ms=42.5,
        row_count=3,
    )
    if created_at is not None:
        row.created_at = created_at
    db_session.add(row)
    await db_session.flush()
    return row


async def _create_user(db_session, *, tenant_id: uuid.UUID) -> uuid.UUID:
    """Create a user in the seeded tenant, reusing the seeded system role_id
    so we don't need to fabricate access roles. Returns the new user id."""
    from sqlalchemy import select
    from app.models.user import User
    seed = (await db_session.execute(select(User).limit(1))).scalar_one()
    new_id = uuid.uuid4()
    db_session.add(User(
        id=new_id, tenant_id=tenant_id, email=f"o-{new_id.hex[:6]}@local",
        display_name="other", password_hash="x", role_id=seed.role_id,
    ))
    await db_session.flush()
    return new_id


@pytest.mark.asyncio
async def test_returns_only_callers_rows(client, db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app

    # Mine
    await _add_tool_call(db_session, tenant_id=tenant_id, user_id=user_id, tool_name="t1")
    await _add_tool_call(db_session, tenant_id=tenant_id, user_id=user_id, tool_name="t2")

    # Same tenant, different user — should NOT appear (Sherlock is per-user).
    other_user = await _create_user(db_session, tenant_id=tenant_id)
    await _add_tool_call(db_session, tenant_id=tenant_id, user_id=other_user, tool_name="other-user")

    _set_auth(_make_auth(tenant_id=tenant_id, user_id=user_id))
    r = await client.get("/api/sherlock/tool-calls")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert {item["toolName"] for item in body["items"]} == {"t1", "t2"}


@pytest.mark.asyncio
async def test_app_access_filters_rows(client, db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app
    await _add_tool_call(db_session, tenant_id=tenant_id, app_id="inside-sales", tool_name="a")
    await _add_tool_call(db_session, tenant_id=tenant_id, app_id="kaira-bot", tool_name="b")

    _set_auth(_make_auth(tenant_id=tenant_id, app_access=frozenset({"inside-sales"})))
    r = await client.get("/api/sherlock/tool-calls")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["appId"] == "inside-sales"


@pytest.mark.asyncio
async def test_explicit_app_id_filters_rows(client, db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app
    await _add_tool_call(db_session, tenant_id=tenant_id, user_id=user_id, app_id="inside-sales", tool_name="inside")
    await _add_tool_call(db_session, tenant_id=tenant_id, user_id=user_id, app_id="kaira-bot", tool_name="kaira")

    _set_auth(_make_auth(
        tenant_id=tenant_id,
        user_id=user_id,
        app_access=frozenset({"inside-sales", "kaira-bot"}),
    ))
    r = await client.get("/api/sherlock/tool-calls", params={"appId": "inside-sales"})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["toolName"] == "inside"


@pytest.mark.asyncio
async def test_status_and_tool_name_filters(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    await _add_tool_call(db_session, tenant_id=tenant_id, tool_name="alpha", status="success")
    await _add_tool_call(
        db_session, tenant_id=tenant_id, tool_name="alpha", status="error",
        error_message="boom",
    )
    await _add_tool_call(db_session, tenant_id=tenant_id, tool_name="beta", status="error")

    _set_auth(_make_auth(tenant_id=tenant_id))

    r = await client.get("/api/sherlock/tool-calls?status=error")
    body = r.json()
    assert body["total"] == 2

    r = await client.get("/api/sherlock/tool-calls?status=error&toolName=alpha")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["errorMessage"] == "boom"


@pytest.mark.asyncio
async def test_pagination_total_stable(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    for _ in range(5):
        await _add_tool_call(db_session, tenant_id=tenant_id)

    _set_auth(_make_auth(tenant_id=tenant_id))
    r = await client.get("/api/sherlock/tool-calls?limit=2&offset=0")
    body = r.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2
    assert body["limit"] == 2 and body["offset"] == 0


@pytest.mark.asyncio
async def test_args_summary_and_payload_omission(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    await _add_tool_call(
        db_session, tenant_id=tenant_id,
        arguments={"sql": "SELECT 1", "limit": 10, "filters": {}},
    )

    _set_auth(_make_auth(tenant_id=tenant_id))
    r = await client.get("/api/sherlock/tool-calls")
    item = r.json()["items"][0]
    # Top-level keys, comma-joined.
    assert "sql" in item["argsSummary"]
    assert "limit" in item["argsSummary"]
    # Heavy fields must NOT be on the list response.
    assert "arguments" not in item
    assert "generatedSql" not in item


@pytest.mark.asyncio
async def test_since_until_window(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    now = datetime.now(timezone.utc)
    await _add_tool_call(db_session, tenant_id=tenant_id, created_at=now - timedelta(hours=24))
    await _add_tool_call(db_session, tenant_id=tenant_id, created_at=now - timedelta(hours=1))

    _set_auth(_make_auth(tenant_id=tenant_id))
    r = await client.get(
        "/api/sherlock/tool-calls",
        params={"since": (now - timedelta(hours=2)).isoformat()},
    )
    assert r.json()["total"] == 1


@pytest.mark.asyncio
async def test_detail_endpoint_returns_full_row(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    row = await _add_tool_call(
        db_session, tenant_id=tenant_id,
        arguments={"sql": "SELECT 1"},
    )

    _set_auth(_make_auth(tenant_id=tenant_id))
    r = await client.get(f"/api/sherlock/tool-calls/{row.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == str(row.id)
    # Full payloads ARE present on detail.
    assert body["arguments"] == {"sql": "SELECT 1"}


@pytest.mark.asyncio
async def test_detail_endpoint_respects_explicit_app_id(client, db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app
    row = await _add_tool_call(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id="inside-sales",
    )

    _set_auth(_make_auth(
        tenant_id=tenant_id,
        user_id=user_id,
        app_access=frozenset({"inside-sales", "kaira-bot"}),
    ))
    ok = await client.get(
        f"/api/sherlock/tool-calls/{row.id}",
        params={"appId": "inside-sales"},
    )
    assert ok.status_code == 200

    mismatch = await client.get(
        f"/api/sherlock/tool-calls/{row.id}",
        params={"appId": "kaira-bot"},
    )
    assert mismatch.status_code == 404


@pytest.mark.asyncio
async def test_detail_endpoint_404_for_foreign_user(client, db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app
    other_user = await _create_user(db_session, tenant_id=tenant_id)
    row = await _add_tool_call(db_session, tenant_id=tenant_id, user_id=other_user)

    _set_auth(_make_auth(tenant_id=tenant_id, user_id=user_id))
    r = await client.get(f"/api/sherlock/tool-calls/{row.id}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_distinct_tool_names(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    await _add_tool_call(db_session, tenant_id=tenant_id, tool_name="alpha")
    await _add_tool_call(db_session, tenant_id=tenant_id, tool_name="alpha")
    await _add_tool_call(db_session, tenant_id=tenant_id, tool_name="beta")

    _set_auth(_make_auth(tenant_id=tenant_id))
    r = await client.get("/api/sherlock/tool-calls/distinct-tool-names")
    assert r.status_code == 200
    assert r.json() == ["alpha", "beta"]


@pytest.mark.asyncio
async def test_distinct_tool_names_respects_app_id(client, db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app
    await _add_tool_call(db_session, tenant_id=tenant_id, user_id=user_id, app_id="inside-sales", tool_name="alpha")
    await _add_tool_call(db_session, tenant_id=tenant_id, user_id=user_id, app_id="kaira-bot", tool_name="beta")

    _set_auth(_make_auth(
        tenant_id=tenant_id,
        user_id=user_id,
        app_access=frozenset({"inside-sales", "kaira-bot"}),
    ))
    r = await client.get(
        "/api/sherlock/tool-calls/distinct-tool-names",
        params={"appId": "inside-sales"},
    )
    assert r.status_code == 200
    assert r.json() == ["alpha"]
