"""Tenant-wide ``GET /api/orchestration/actions`` endpoint tests.

Phase 15.1b — feeds the platform Logs page's Workflow actions tab. The
endpoint must:
  * scope to ``auth.tenant_id`` (cross-tenant rows invisible),
  * filter to apps in ``auth.app_access`` when no ``workflow_id`` is given,
  * apply optional channel / action_type / status / recipient_id /
    provider_correlation_id / since / until filters,
  * report a stable ``total`` independent of ``limit`` for pagination.

Same ASGI + dependency-override pattern as
``test_orchestration_isolation_unittest.py``.
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
from app.models.orchestration import (
    Workflow,
    WorkflowRun,
    WorkflowRunNodeStep,
    WorkflowRunRecipientAction,
    WorkflowVersion,
)

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
        email="actions-test@orchestration.local",
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


async def _seed_workflow_with_run(
    db_session, *, tenant_id: uuid.UUID, app_id: str, name: str,
) -> tuple[Workflow, WorkflowRun, WorkflowRunNodeStep]:
    wf = Workflow(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_type="crm", slug=f"actglob-{uuid.uuid4().hex[:8]}",
        name=name, created_by=SYSTEM_USER_ID,
    )
    db_session.add(wf)
    await db_session.flush()

    ver = WorkflowVersion(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=wf.id, version=1,
        definition={"nodes": [], "edges": []}, status="published",
    )
    db_session.add(ver)
    await db_session.flush()

    run = WorkflowRun(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=wf.id, workflow_version_id=ver.id,
        triggered_by="manual", triggered_by_user_id=SYSTEM_USER_ID,
        status="completed",
    )
    db_session.add(run)
    await db_session.flush()

    step = WorkflowRunNodeStep(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=wf.id, workflow_version_id=ver.id,
        run_id=run.id, node_id="n-dispatch", node_type="crm.send_wati",
        status="completed",
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
    )
    db_session.add(step)
    await db_session.flush()
    return wf, run, step


async def _add_action(
    db_session, *, run: WorkflowRun, step: WorkflowRunNodeStep, channel: str,
    status: str, action_type: str = "send",
    recipient_id: str | None = None,
    provider_correlation_id: str | None = None,
    error: str | None = None,
    created_at: datetime | None = None,
) -> WorkflowRunRecipientAction:
    action = WorkflowRunRecipientAction(
        id=uuid.uuid4(),
        tenant_id=run.tenant_id, app_id=run.app_id,
        workflow_id=run.workflow_id, workflow_version_id=run.workflow_version_id,
        run_id=run.id, node_step_id=step.id,
        recipient_id=recipient_id or f"r-{uuid.uuid4().hex[:6]}",
        channel=channel, action_type=action_type, status=status,
        idempotency_key=f"idem-{uuid.uuid4().hex[:10]}",
        payload={"contact": "+15555550100"},
        provider_correlation_id=provider_correlation_id,
        provider_terminal=status != "pending",
        error=error,
    )
    if created_at is not None:
        action.created_at = created_at
    db_session.add(action)
    await db_session.flush()
    return action


@pytest.mark.asyncio
async def test_returns_actions_for_caller_apps_only(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    _, run_a, step_a = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="A",
    )
    _, run_b, step_b = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="kaira-bot", name="B",
    )
    await _add_action(db_session, run=run_a, step=step_a, channel="wati", status="success")
    await _add_action(db_session, run=run_b, step=step_b, channel="bolna", status="failed")

    _set_auth(_make_auth(tenant_id=tenant_id, app_access=frozenset({"inside-sales"})))
    r = await client.get("/api/orchestration/actions")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["runId"] == str(run_a.id)


@pytest.mark.asyncio
async def test_status_and_channel_filters(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    _, run, step = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="status-filter",
    )
    await _add_action(db_session, run=run, step=step, channel="wati", status="success")
    await _add_action(
        db_session, run=run, step=step, channel="wati", status="failed",
        error="WATI 4xx",
    )
    await _add_action(db_session, run=run, step=step, channel="bolna", status="failed")

    _set_auth(_make_auth(tenant_id=tenant_id, app_access=frozenset({"inside-sales"})))

    r = await client.get("/api/orchestration/actions?status=failed")
    body = r.json()
    assert body["total"] == 2
    assert all(item["status"] == "failed" for item in body["items"])

    r = await client.get("/api/orchestration/actions?status=failed&channel=wati")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["channel"] == "wati"
    assert body["items"][0]["error"] == "WATI 4xx"


@pytest.mark.asyncio
async def test_app_id_filters_to_current_logs_app(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    _, run_inside, step_inside = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="inside",
    )
    _, run_kaira, step_kaira = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="kaira-bot", name="kaira",
    )
    action_inside = await _add_action(
        db_session, run=run_inside, step=step_inside, channel="wati", status="success",
    )
    await _add_action(
        db_session, run=run_kaira, step=step_kaira, channel="wati", status="success",
    )

    _set_auth(_make_auth(
        tenant_id=tenant_id,
        app_access=frozenset({"inside-sales", "kaira-bot"}),
    ))
    r = await client.get("/api/orchestration/actions", params={"appId": "inside-sales"})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == str(action_inside.id)


@pytest.mark.asyncio
async def test_workflow_id_filter_and_app_gate(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    wf_a, run_a, step_a = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="A",
    )
    _, run_b, step_b = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="B",
    )
    await _add_action(db_session, run=run_a, step=step_a, channel="wati", status="success")
    await _add_action(db_session, run=run_b, step=step_b, channel="wati", status="success")

    _set_auth(_make_auth(tenant_id=tenant_id, app_access=frozenset({"inside-sales"})))
    r = await client.get(f"/api/orchestration/actions?workflowId={wf_a.id}")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["workflowId"] == str(wf_a.id)
    assert body["items"][0]["workflowName"] == "A"


@pytest.mark.asyncio
async def test_pagination_total_matches_unpaged(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    _, run, step = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="paginate",
    )
    for _ in range(5):
        await _add_action(db_session, run=run, step=step, channel="wati", status="success")

    _set_auth(_make_auth(tenant_id=tenant_id, app_access=frozenset({"inside-sales"})))
    r = await client.get("/api/orchestration/actions?limit=2&offset=0")
    body = r.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2
    assert body["limit"] == 2
    assert body["offset"] == 0


@pytest.mark.asyncio
async def test_provider_correlation_id_lookup(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    _, run, step = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="corr",
    )
    await _add_action(
        db_session, run=run, step=step, channel="bolna", status="success",
        provider_correlation_id="exec-abcd-1234",
    )
    await _add_action(db_session, run=run, step=step, channel="bolna", status="success")

    _set_auth(_make_auth(tenant_id=tenant_id, app_access=frozenset({"inside-sales"})))
    r = await client.get(
        "/api/orchestration/actions?providerCorrelationId=exec-abcd-1234"
    )
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["providerCorrelationId"] == "exec-abcd-1234"


@pytest.mark.asyncio
async def test_since_until_window(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    _, run, step = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="time",
    )
    now = datetime.now(timezone.utc)
    await _add_action(
        db_session, run=run, step=step, channel="wati", status="success",
        created_at=now - timedelta(hours=24),
    )
    await _add_action(
        db_session, run=run, step=step, channel="wati", status="success",
        created_at=now - timedelta(hours=1),
    )

    _set_auth(_make_auth(tenant_id=tenant_id, app_access=frozenset({"inside-sales"})))
    since = (now - timedelta(hours=2)).isoformat()
    # `+` in the timezone offset would otherwise be URL-decoded to space —
    # let httpx encode params for us.
    r = await client.get("/api/orchestration/actions", params={"since": since})
    body = r.json()
    assert body["total"] == 1


@pytest.mark.asyncio
async def test_no_app_access_returns_empty(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    _, run, step = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="locked",
    )
    await _add_action(db_session, run=run, step=step, channel="wati", status="success")

    _set_auth(_make_auth(tenant_id=tenant_id, app_access=frozenset()))
    r = await client.get("/api/orchestration/actions")
    body = r.json()
    assert body["total"] == 0
    assert body["items"] == []


@pytest.mark.asyncio
async def test_workflow_id_for_other_tenant_returns_404(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    wf, _, _ = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="own",
    )

    other_tenant = uuid.uuid4()
    from app.models.tenant import Tenant
    db_session.add(Tenant(
        id=other_tenant, name=f"O-{other_tenant.hex[:6]}", slug=f"o-{other_tenant.hex[:6]}",
    ))
    await db_session.flush()

    _set_auth(_make_auth(tenant_id=other_tenant, app_access=frozenset({"inside-sales"})))
    r = await client.get(f"/api/orchestration/actions?workflowId={wf.id}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_run_action_detail_returns_single_action_row(client, db_session, seed_tenant_user_app):
    tenant_id, _, _ = seed_tenant_user_app
    _, run, step = await _seed_workflow_with_run(
        db_session, tenant_id=tenant_id, app_id="inside-sales", name="detail",
    )
    action = await _add_action(
        db_session,
        run=run,
        step=step,
        channel="bolna",
        status="success",
        provider_correlation_id="exec-detail-1234",
    )

    _set_auth(_make_auth(tenant_id=tenant_id, app_access=frozenset({"inside-sales"})))
    r = await client.get(f"/api/orchestration/runs/{run.id}/actions/{action.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == str(action.id)
    assert body["runId"] == str(run.id)
    assert body["providerCorrelationId"] == "exec-detail-1234"
