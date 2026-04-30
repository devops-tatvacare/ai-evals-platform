"""End-to-end webhook route tests via FastAPI ASGITransport.

The router under test is public (no Bearer required). We use ASGITransport so
the request never crosses the network, then override ``get_db`` to share the
test's transactional session — its ``rollback()`` at teardown then cleans up
any data the route persisted. Route handlers call ``await db.commit()``; we
monkeypatch ``commit`` to ``flush`` on the test session so the outer rollback
still has something to undo.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import select

from app.config import settings
from app.constants import SYSTEM_USER_ID
from app.database import get_db
from app.main import app
from app.models.orchestration import (
    WorkflowRunRecipientAction,
    WorkflowTrigger,
)


@pytest.mark.asyncio
async def test_webhook_route_does_not_require_auth():
    """Hitting the webhook URL without a Bearer token must NOT 401."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post("/api/orchestration/webhooks/wati/wrongsecret", json={})
    assert r.status_code != 401
    # With an empty WATI_WEBHOOK_SECRET (default in tests) ANY value is rejected
    # by _check_secret since `expected` is falsy → 404.
    assert r.status_code == 404


def _override_db_with_session(db_session):
    """Make get_db yield our transactional test session and turn its commit into a flush
    so outer rollback at teardown still cleans up route-persisted rows."""
    async def _override():
        yield db_session
    app.dependency_overrides[get_db] = _override
    db_session.commit = db_session.flush  # type: ignore[assignment]


@pytest.mark.asyncio
async def test_wati_webhook_with_correct_secret_dispatches(db_session, seed_full_run, monkeypatch):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    monkeypatch.setattr(settings, "ORCHESTRATION_DEFAULT_TENANT_ID", str(tenant_id))
    monkeypatch.setattr(settings, "ORCHESTRATION_DEFAULT_APP_ID", app_id)
    monkeypatch.setattr(settings, "WATI_WEBHOOK_SECRET", "shh-wati")

    local_msg_id = f"lm-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, recipient_id="L-route",
        channel="wati", action_type="wa_dispatched", status="success",
        idempotency_key=f"k-{uuid.uuid4().hex[:8]}",
        payload={}, response={"localMessageId": local_msg_id},
    ))
    await db_session.flush()

    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                "/api/orchestration/webhooks/wati/shh-wati",
                json={"eventType": "sentMessageDELIVERED_v2", "localMessageId": local_msg_id},
            )
        assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.pop(get_db, None)

    rows = await db_session.execute(
        select(WorkflowRunRecipientAction.action_type)
        .where(WorkflowRunRecipientAction.run_id == run.id,
               WorkflowRunRecipientAction.recipient_id == "L-route")
    )
    types = sorted(t[0] for t in rows.all())
    assert "wa_delivered" in types


@pytest.mark.asyncio
async def test_event_webhook_creates_run(db_session, seed_full_run, monkeypatch):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = version.id
    event_name = f"e.{uuid.uuid4().hex[:6]}"
    db_session.add(WorkflowTrigger(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, kind="event", event_name=event_name,
        active=True, params={}, created_by=run.triggered_by_user_id or SYSTEM_USER_ID,
    ))
    await db_session.flush()

    monkeypatch.setattr(settings, "ORCHESTRATION_DEFAULT_TENANT_ID", str(tenant_id))
    monkeypatch.setattr(settings, "ORCHESTRATION_DEFAULT_APP_ID", app_id)
    monkeypatch.setattr(settings, "ORCHESTRATION_EVENT_WEBHOOK_SECRET", "shh-event")

    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/api/orchestration/webhooks/event/{event_name}/shh-event",
                json={"recipient_id": "evt-route", "foo": "bar"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "ok"
        assert body["runs_created"] == 1
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_event_webhook_rejects_payload_without_recipient_contract(
    db_session, seed_full_run, monkeypatch
):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = version.id
    event_name = f"e.{uuid.uuid4().hex[:6]}"
    db_session.add(WorkflowTrigger(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, kind="event", event_name=event_name,
        active=True, params={}, created_by=run.triggered_by_user_id or SYSTEM_USER_ID,
    ))
    await db_session.flush()

    monkeypatch.setattr(settings, "ORCHESTRATION_DEFAULT_TENANT_ID", str(tenant_id))
    monkeypatch.setattr(settings, "ORCHESTRATION_DEFAULT_APP_ID", app_id)
    monkeypatch.setattr(settings, "ORCHESTRATION_EVENT_WEBHOOK_SECRET", "shh-event")

    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/api/orchestration/webhooks/event/{event_name}/shh-event",
                json={"foo": "bar"},
            )
        assert r.status_code == 400, r.text
        assert "recipient" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_lsq_webhook_rejects_payload_without_lead_identifier(
    db_session, seed_full_run, monkeypatch
):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = version.id
    db_session.add(WorkflowTrigger(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, kind="event", event_name="lsq.lead.updated",
        active=True, params={}, created_by=run.triggered_by_user_id or SYSTEM_USER_ID,
    ))
    await db_session.flush()

    monkeypatch.setattr(settings, "ORCHESTRATION_DEFAULT_TENANT_ID", str(tenant_id))
    monkeypatch.setattr(settings, "ORCHESTRATION_DEFAULT_APP_ID", app_id)
    monkeypatch.setattr(settings, "LSQ_WEBHOOK_SECRET", "shh-lsq")

    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                "/api/orchestration/webhooks/lsq/shh-lsq",
                json={"foo": "bar"},
            )
        assert r.status_code == 400, r.text
        assert "lead identifier" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_bolna_webhook_404_on_empty_secret_setting():
    # WATI/Bolna/etc. secrets are blank by default in tests. compare_digest
    # against an empty expected fails closed → 404.
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post("/api/orchestration/webhooks/bolna/anything", json={})
    assert r.status_code == 404
