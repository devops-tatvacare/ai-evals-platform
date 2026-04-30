"""Tenant + app isolation tests for orchestration routes.

Covers two distinct authorization concerns:

1. Cross-tenant isolation — a user in tenant B cannot see / mutate / cancel /
   override resources that belong to tenant A. Every route returns 404
   (not 403) so we don't leak existence information across tenants.

2. App isolation within a tenant — a user with ``app_access`` to app X
   cannot read / mutate runs or workflows belonging to app Y, even when
   they share the tenant. Routes return 403 ("No access to app: ...") via
   ``ensure_registered_app_access``. List endpoints filter the result set
   to apps the caller has access to.

These tests use the same FastAPI ASGITransport + dependency-override pattern
as test_orchestration_routes_unittest.py.
"""
from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
import pytest_asyncio

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app
from app.models.orchestration import Workflow

import app.services.orchestration.nodes  # noqa: F401 — register handlers


def _override_db(db_session):
    async def _g():
        yield db_session
    fastapi_app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]


def _make_auth(*, tenant_id: uuid.UUID, app_access: frozenset[str]) -> AuthContext:
    return AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=tenant_id,
        email="iso-test@orchestration.local",
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset(),
        app_access=app_access,
    )


def _set_auth(auth: AuthContext) -> None:
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth


@pytest_asyncio.fixture
async def client(db_session):
    """Bare HTTP client + DB override. Auth is set per-test (not via fixture)
    so individual tests can swap identities mid-flow."""
    _override_db(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test"
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


def _wf_body(slug: str, **overrides: Any) -> dict:
    body = {"appId": "inside-sales", "workflowType": "crm", "slug": slug, "name": "T"}
    body.update(overrides)
    return body


@pytest_asyncio.fixture
async def seed_other_tenant(db_session):
    """Seed a second tenant + system user for cross-tenant assertions.

    Reuses SYSTEM_USER_ID as the FK target since access_role / users live
    on the system tenant; the orchestration tables only require user_id to
    point at SOME real user, not necessarily the same tenant in our test.
    """
    from app.models.tenant import Tenant
    other_id = uuid.uuid4()
    db_session.add(Tenant(
        id=other_id,
        name=f"Other-{other_id.hex[:6]}",
        slug=f"other-{other_id.hex[:6]}",
    ))
    await db_session.flush()
    return other_id


# ─── Cross-tenant isolation ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cross_tenant_get_workflow_returns_404(client, seed_other_tenant):
    """A user in tenant B cannot read a workflow created by tenant A."""
    # Tenant A creates workflow.
    _set_auth(_make_auth(
        tenant_id=SYSTEM_TENANT_ID,
        app_access=frozenset({"inside-sales", "voice-rx", "kaira-bot"}),
    ))
    slug = f"x-tenant-{uuid.uuid4().hex[:8]}"
    wf = (await client.post("/api/orchestration/workflows", json=_wf_body(slug))).json()

    # Tenant B (other_id) tries to fetch.
    _set_auth(_make_auth(
        tenant_id=seed_other_tenant,
        app_access=frozenset({"inside-sales", "voice-rx", "kaira-bot"}),
    ))
    r = await client.get(f"/api/orchestration/workflows/{wf['id']}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_patch_returns_404(client, seed_other_tenant):
    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"inside-sales"})))
    wf = (await client.post(
        "/api/orchestration/workflows",
        json=_wf_body(f"x-patch-{uuid.uuid4().hex[:8]}"),
    )).json()

    _set_auth(_make_auth(tenant_id=seed_other_tenant,
                         app_access=frozenset({"inside-sales"})))
    r = await client.patch(
        f"/api/orchestration/workflows/{wf['id']}", json={"name": "Hijacked"}
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_delete_returns_404(client, seed_other_tenant):
    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"inside-sales"})))
    wf = (await client.post(
        "/api/orchestration/workflows",
        json=_wf_body(f"x-del-{uuid.uuid4().hex[:8]}"),
    )).json()

    _set_auth(_make_auth(tenant_id=seed_other_tenant,
                         app_access=frozenset({"inside-sales"})))
    r = await client.delete(f"/api/orchestration/workflows/{wf['id']}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_create_version_returns_404(client, seed_other_tenant):
    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"inside-sales"})))
    wf = (await client.post(
        "/api/orchestration/workflows",
        json=_wf_body(f"x-ver-{uuid.uuid4().hex[:8]}"),
    )).json()

    _set_auth(_make_auth(tenant_id=seed_other_tenant,
                         app_access=frozenset({"inside-sales"})))
    r = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_create_trigger_returns_404(client, seed_other_tenant):
    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"inside-sales"})))
    wf = (await client.post(
        "/api/orchestration/workflows",
        json=_wf_body(f"x-trig-{uuid.uuid4().hex[:8]}"),
    )).json()

    _set_auth(_make_auth(tenant_id=seed_other_tenant,
                         app_access=frozenset({"inside-sales"})))
    r = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/triggers",
        json={"kind": "event", "eventName": "lead.new", "active": True},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_run_endpoints_return_404(client, seed_other_tenant):
    """End-to-end: run created by tenant A is invisible to tenant B across all
    run-scoped endpoints (get, recipients, actions, cancel, override, fire-from-id)."""
    # Tenant A: create + publish + fire run.
    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"inside-sales"})))
    wf = (await client.post(
        "/api/orchestration/workflows",
        json=_wf_body(f"x-run-{uuid.uuid4().hex[:8]}"),
    )).json()
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )).json()
    await client.post(f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish")
    run = (await client.post(
        "/api/orchestration/runs", json={"workflowId": wf["id"], "params": {}}
    )).json()

    # Tenant B: try every run-scoped endpoint → 404.
    _set_auth(_make_auth(tenant_id=seed_other_tenant,
                         app_access=frozenset({"inside-sales"})))
    rid = run["id"]
    assert (await client.get(f"/api/orchestration/runs/{rid}")).status_code == 404
    assert (await client.get(f"/api/orchestration/runs/{rid}/recipients")).status_code == 404
    assert (await client.get(f"/api/orchestration/runs/{rid}/actions")).status_code == 404
    assert (await client.post(f"/api/orchestration/runs/{rid}/cancel")).status_code == 404
    assert (await client.post(
        f"/api/orchestration/runs/{rid}/recipients/whoever/override",
        json={"action": "pause"},
    )).status_code == 404
    # Manual fire by workflow_id from tenant A → tenant B sees no such workflow.
    assert (await client.post(
        "/api/orchestration/runs",
        json={"workflowId": wf["id"], "params": {}},
    )).status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_list_workflows_excludes_other_tenant_rows(
    client, db_session, seed_other_tenant,
):
    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"inside-sales"})))
    a_slug = f"x-list-a-{uuid.uuid4().hex[:8]}"
    await client.post("/api/orchestration/workflows", json=_wf_body(a_slug))

    # Insert a workflow directly for tenant B (no inside-sales app validation
    # needed at the DB layer; we're seeding an FK-valid row).
    from app.constants import SYSTEM_USER_ID as _SU
    db_session.add(Workflow(
        id=uuid.uuid4(), tenant_id=seed_other_tenant, app_id="inside-sales",
        workflow_type="crm", slug=f"x-list-b-{uuid.uuid4().hex[:8]}",
        name="B", created_by=_SU,
    ))
    await db_session.flush()

    # Tenant A list should not show tenant B's row.
    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"inside-sales"})))
    r = await client.get("/api/orchestration/workflows?appId=inside-sales")
    assert r.status_code == 200
    slugs = [w["slug"] for w in r.json()]
    assert a_slug in slugs
    assert all(not s.startswith("x-list-b-") for s in slugs)


# ─── App-access isolation within one tenant ─────────────────────────────────


@pytest.mark.asyncio
async def test_no_app_access_get_workflow_returns_403(client):
    """User has tenant access but lacks app_access → 403 from app_scope."""
    # Privileged user creates a workflow under inside-sales.
    _set_auth(_make_auth(
        tenant_id=SYSTEM_TENANT_ID,
        app_access=frozenset({"inside-sales", "voice-rx", "kaira-bot"}),
    ))
    wf = (await client.post(
        "/api/orchestration/workflows",
        json=_wf_body(f"app-iso-{uuid.uuid4().hex[:8]}"),
    )).json()

    # Switch to a user in the same tenant who has only voice-rx access.
    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"voice-rx"})))
    r = await client.get(f"/api/orchestration/workflows/{wf['id']}")
    assert r.status_code == 403
    assert "inside-sales" in r.json()["detail"]


@pytest.mark.asyncio
async def test_no_app_access_run_endpoints_return_403(client):
    _set_auth(_make_auth(
        tenant_id=SYSTEM_TENANT_ID,
        app_access=frozenset({"inside-sales", "voice-rx", "kaira-bot"}),
    ))
    wf = (await client.post(
        "/api/orchestration/workflows",
        json=_wf_body(f"run-iso-{uuid.uuid4().hex[:8]}"),
    )).json()
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )).json()
    await client.post(f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish")
    run = (await client.post(
        "/api/orchestration/runs", json={"workflowId": wf["id"], "params": {}}
    )).json()

    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"voice-rx"})))
    rid = run["id"]
    assert (await client.get(f"/api/orchestration/runs/{rid}")).status_code == 403
    assert (await client.get(f"/api/orchestration/runs/{rid}/recipients")).status_code == 403
    assert (await client.get(f"/api/orchestration/runs/{rid}/actions")).status_code == 403
    assert (await client.post(f"/api/orchestration/runs/{rid}/cancel")).status_code == 403
    assert (await client.post(
        f"/api/orchestration/runs/{rid}/recipients/x/override",
        json={"action": "pause"},
    )).status_code == 403


@pytest.mark.asyncio
async def test_no_app_access_list_workflows_filters_unreachable_apps(client):
    """Unfiltered /workflows must NOT include rows from apps the caller can't reach."""
    _set_auth(_make_auth(
        tenant_id=SYSTEM_TENANT_ID,
        app_access=frozenset({"inside-sales", "voice-rx", "kaira-bot"}),
    ))
    is_slug = f"is-{uuid.uuid4().hex[:8]}"
    vr_slug = f"vr-{uuid.uuid4().hex[:8]}"
    await client.post("/api/orchestration/workflows", json=_wf_body(is_slug))
    await client.post(
        "/api/orchestration/workflows", json=_wf_body(vr_slug, appId="voice-rx"),
    )

    # Only voice-rx access → should NOT see the inside-sales workflow.
    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"voice-rx"})))
    r = await client.get("/api/orchestration/workflows")
    assert r.status_code == 200
    slugs = [w["slug"] for w in r.json()]
    assert vr_slug in slugs
    assert is_slug not in slugs


@pytest.mark.asyncio
async def test_no_app_access_list_runs_filters_unreachable_apps(client):
    _set_auth(_make_auth(
        tenant_id=SYSTEM_TENANT_ID,
        app_access=frozenset({"inside-sales", "voice-rx", "kaira-bot"}),
    ))
    # Create + publish + fire a run on inside-sales.
    wf = (await client.post(
        "/api/orchestration/workflows",
        json=_wf_body(f"is-run-{uuid.uuid4().hex[:8]}"),
    )).json()
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )).json()
    await client.post(f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish")
    run = (await client.post(
        "/api/orchestration/runs", json={"workflowId": wf["id"], "params": {}}
    )).json()

    _set_auth(_make_auth(tenant_id=SYSTEM_TENANT_ID,
                         app_access=frozenset({"voice-rx"})))
    r = await client.get("/api/orchestration/runs")
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert run["id"] not in ids
