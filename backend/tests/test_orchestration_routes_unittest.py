"""End-to-end orchestration API route tests.

Uses FastAPI ASGITransport with dependency overrides for ``get_db`` (test
session, commit→flush so outer rollback wipes) and ``get_auth_context``
(synthetic owner-auth bound to SYSTEM_TENANT_ID + SYSTEM_USER_ID).
"""
from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app
from app.models.orchestration import (
    WorkflowRunRecipientOverride,
    WorkflowTrigger,
)
from app.models.scheduled_job import ScheduledJobDefinition

import app.services.orchestration.nodes  # noqa: F401 — register handlers


def _override_db(db_session):
    async def _g():
        yield db_session
    fastapi_app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]


def _override_auth():
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=SYSTEM_TENANT_ID,
        email="test@orchestration.local",
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({"voice-rx", "kaira-bot", "inside-sales"}),
    )
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth
    return auth


@pytest_asyncio.fixture
async def client(db_session):
    _override_db(db_session)
    _override_auth()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test"
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


def _wf_body(slug: str, **overrides: Any) -> dict:
    body = {
        "appId": "inside-sales",
        "workflowType": "crm",
        "slug": slug,
        "name": "T",
    }
    body.update(overrides)
    return body


# ─── Workflows ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_workflow_returns_201_and_payload(client):
    slug = f"wf-{uuid.uuid4().hex[:8]}"
    r = await client.post("/api/orchestration/workflows", json=_wf_body(slug))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["slug"] == slug
    assert body["currentPublishedVersionId"] is None
    assert body["workflowType"] == "crm"


@pytest.mark.asyncio
async def test_create_workflow_duplicate_slug_returns_409(client):
    slug = f"dup-{uuid.uuid4().hex[:8]}"
    a = await client.post("/api/orchestration/workflows", json=_wf_body(slug, name="A"))
    assert a.status_code == 201, a.text
    b = await client.post("/api/orchestration/workflows", json=_wf_body(slug, name="B"))
    assert b.status_code == 409


@pytest.mark.asyncio
async def test_list_workflows_filters_by_app(client):
    s1 = f"a-{uuid.uuid4().hex[:8]}"
    s2 = f"b-{uuid.uuid4().hex[:8]}"
    await client.post("/api/orchestration/workflows", json=_wf_body(s1))
    # voice-rx is in app_access; create one there too
    await client.post("/api/orchestration/workflows", json=_wf_body(s2, appId="voice-rx"))
    r = await client.get("/api/orchestration/workflows?appId=inside-sales")
    assert r.status_code == 200
    slugs = [w["slug"] for w in r.json()]
    assert s1 in slugs and s2 not in slugs


@pytest.mark.asyncio
async def test_get_workflow_404_when_missing(client):
    r = await client.get(f"/api/orchestration/workflows/{uuid.uuid4()}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_patch_workflow_updates_name(client):
    slug = f"u-{uuid.uuid4().hex[:8]}"
    wf = (await client.post("/api/orchestration/workflows", json=_wf_body(slug, name="Old"))).json()
    r = await client.patch(
        f"/api/orchestration/workflows/{wf['id']}", json={"name": "New"}
    )
    assert r.status_code == 200
    assert r.json()["name"] == "New"


# ─── Versions ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_draft_version_increments_version(client):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"v-{uuid.uuid4().hex[:8]}")
    )).json()
    a = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )
    assert a.status_code == 201, a.text
    assert a.json()["version"] == 1
    b = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )
    assert b.status_code == 201
    assert b.json()["version"] == 2


@pytest.mark.asyncio
async def test_publish_sets_current_published_version_id(client):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"p-{uuid.uuid4().hex[:8]}")
    )).json()
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )).json()
    r = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish"
    )
    assert r.status_code == 200
    assert r.json()["status"] == "published"
    wf2 = (await client.get(f"/api/orchestration/workflows/{wf['id']}")).json()
    assert wf2["currentPublishedVersionId"] == v["id"]


@pytest.mark.asyncio
async def test_publish_rejects_unknown_node_type(client):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"val-{uuid.uuid4().hex[:8]}")
    )).json()
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {
            "nodes": [{"id": "n1", "type": "fake.unknown_node", "config": {}}],
            "edges": [],
        }},
    )).json()
    r = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish"
    )
    assert r.status_code == 400
    assert "fake.unknown_node" in r.json()["detail"]


@pytest.mark.asyncio
async def test_publish_rejects_invalid_node_config(client):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"cfg-{uuid.uuid4().hex[:8]}")
    )).json()
    # crm.send_wati requires template_slug. Omit it → handler.config_schema raises.
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {
            "nodes": [{"id": "n1", "type": "crm.send_wati", "config": {}}],
            "edges": [],
        }},
    )).json()
    r = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish"
    )
    assert r.status_code == 400


# ─── Triggers + cron sync ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_cron_trigger_inserts_scheduled_job(client, db_session):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"cron-{uuid.uuid4().hex[:8]}")
    )).json()
    r = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/triggers",
        json={"kind": "cron", "cronExpression": "0 9 * * *", "active": True},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "cron"
    assert body["scheduledJobId"] is not None

    sched = (await db_session.execute(
        select(ScheduledJobDefinition).where(
            ScheduledJobDefinition.id == uuid.UUID(body["scheduledJobId"])
        )
    )).scalar_one()
    assert sched.cron == "0 9 * * *"
    # Cron triggers must NOT enqueue ``run-workflow`` directly — that handler
    # requires a pre-existing ``run_id`` and would no-op without one. The
    # scheduler enqueues ``fire-orchestration-trigger`` which creates the run
    # then queues a ``run-workflow`` job pointing at it.
    assert sched.job_type == "fire-orchestration-trigger"
    assert sched.params["trigger_id"] == body["id"]
    assert sched.enabled is True


@pytest.mark.asyncio
async def test_create_event_trigger_no_scheduled_job(client):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"evt-{uuid.uuid4().hex[:8]}")
    )).json()
    r = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/triggers",
        json={"kind": "event", "eventName": "lead.new", "active": True},
    )
    assert r.status_code == 201
    assert r.json()["scheduledJobId"] is None


@pytest.mark.asyncio
async def test_invalid_cron_returns_400(client):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"bad-cron-{uuid.uuid4().hex[:8]}")
    )).json()
    r = await client.post(
        f"/api/orchestration/workflows/{wf['id']}/triggers",
        json={"kind": "cron", "cronExpression": "not-a-cron", "active": True},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_patch_inactive_cron_trigger_materializes_scheduled_job(client, db_session):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"patch-cron-{uuid.uuid4().hex[:8]}")
    )).json()
    created = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/triggers",
        json={"kind": "cron", "cronExpression": "0 9 * * *", "active": False},
    )).json()
    assert created["scheduledJobId"] is None

    patched = await client.patch(
        f"/api/orchestration/triggers/{created['id']}",
        json={"active": True},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["active"] is True
    assert body["scheduledJobId"] is not None

    sched = (await db_session.execute(
        select(ScheduledJobDefinition).where(
            ScheduledJobDefinition.id == uuid.UUID(body["scheduledJobId"])
        )
    )).scalar_one()
    assert sched.job_type == "fire-orchestration-trigger"
    assert sched.enabled is True
    assert sched.params["trigger_id"] == body["id"]


@pytest.mark.asyncio
async def test_patch_cron_trigger_updates_schedule_row(client, db_session):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"patch-cron-row-{uuid.uuid4().hex[:8]}")
    )).json()
    created = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/triggers",
        json={"kind": "cron", "cronExpression": "0 9 * * *", "active": True},
    )).json()

    patched = await client.patch(
        f"/api/orchestration/triggers/{created['id']}",
        json={"cronExpression": "15 10 * * *", "active": False},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["cronExpression"] == "15 10 * * *"
    assert body["active"] is False

    sched = (await db_session.execute(
        select(ScheduledJobDefinition).where(
            ScheduledJobDefinition.id == uuid.UUID(body["scheduledJobId"])
        )
    )).scalar_one()
    assert sched.cron == "15 10 * * *"
    assert sched.enabled is False


@pytest.mark.asyncio
async def test_delete_cron_trigger_removes_scheduled_job(client, db_session):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"del-{uuid.uuid4().hex[:8]}")
    )).json()
    t = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/triggers",
        json={"kind": "cron", "cronExpression": "0 * * * *", "active": True},
    )).json()
    sid = uuid.UUID(t["scheduledJobId"])

    r = await client.delete(f"/api/orchestration/triggers/{t['id']}")
    assert r.status_code == 204

    row = (await db_session.execute(
        select(ScheduledJobDefinition).where(ScheduledJobDefinition.id == sid)
    )).scalar_one_or_none()
    assert row is None

    trig_row = (await db_session.execute(
        select(WorkflowTrigger).where(WorkflowTrigger.id == uuid.UUID(t["id"]))
    )).scalar_one_or_none()
    assert trig_row is None


# ─── Runs + override ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_manual_fire_requires_published_version(client):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"fire1-{uuid.uuid4().hex[:8]}")
    )).json()
    r = await client.post("/api/orchestration/runs", json={"workflowId": wf["id"], "params": {}})
    assert r.status_code == 400
    assert "published" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_manual_fire_creates_run_and_job(client, db_session):
    from app.models.job import BackgroundJob

    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"fire2-{uuid.uuid4().hex[:8]}")
    )).json()
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )).json()
    await client.post(f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish")
    r = await client.post("/api/orchestration/runs", json={"workflowId": wf["id"], "params": {}})
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    jobs = (await db_session.execute(
        select(BackgroundJob).where(BackgroundJob.job_type == "run-workflow")
    )).scalars().all()
    matching = [j for j in jobs if (j.params or {}).get("run_id") == rid]
    assert len(matching) == 1
    assert matching[0].status == "queued"


@pytest.mark.asyncio
async def test_list_and_get_run(client):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"list-r-{uuid.uuid4().hex[:8]}")
    )).json()
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )).json()
    await client.post(f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish")
    run = (await client.post(
        "/api/orchestration/runs", json={"workflowId": wf["id"], "params": {}}
    )).json()
    rl = await client.get(f"/api/orchestration/runs?workflowId={wf['id']}")
    assert rl.status_code == 200
    ids = [r["id"] for r in rl.json()]
    assert run["id"] in ids

    detail = await client.get(f"/api/orchestration/runs/{run['id']}")
    assert detail.status_code == 200
    assert detail.json()["id"] == run["id"]


@pytest.mark.asyncio
async def test_cancel_run(client, db_session):
    from app.models.orchestration import WorkflowRun
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"cn-{uuid.uuid4().hex[:8]}")
    )).json()
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )).json()
    await client.post(f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish")
    run = (await client.post(
        "/api/orchestration/runs", json={"workflowId": wf["id"], "params": {}}
    )).json()
    r = await client.post(f"/api/orchestration/runs/{run['id']}/cancel")
    assert r.status_code == 204

    row = (await db_session.execute(
        select(WorkflowRun).where(WorkflowRun.id == uuid.UUID(run["id"]))
    )).scalar_one()
    assert row.status == "cancelled"
    assert row.completed_at is not None


@pytest.mark.asyncio
async def test_override_creates_row(client, db_session):
    wf = (await client.post(
        "/api/orchestration/workflows", json=_wf_body(f"ov-{uuid.uuid4().hex[:8]}")
    )).json()
    v = (await client.post(
        f"/api/orchestration/workflows/{wf['id']}/versions",
        json={"definition": {"nodes": [], "edges": [], "canvas": {}}},
    )).json()
    await client.post(f"/api/orchestration/workflows/{wf['id']}/versions/{v['id']}/publish")
    run = (await client.post(
        "/api/orchestration/runs", json={"workflowId": wf["id"], "params": {}}
    )).json()

    r = await client.post(
        f"/api/orchestration/runs/{run['id']}/recipients/some-recipient/override",
        json={"action": "pause", "reason": "QA review"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["action"] == "pause"

    rows = (await db_session.execute(
        select(WorkflowRunRecipientOverride).where(
            WorkflowRunRecipientOverride.run_id == uuid.UUID(run["id"])
        )
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].action == "pause"


# ─── Templates / consent ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upsert_and_list_action_templates(client):
    slug = f"tmpl-{uuid.uuid4().hex[:8]}"
    body = {
        "channel": "wati",
        "slug": slug,
        "name": "Test Template",
        "payloadSchema": {"template_name": "x"},
        "active": True,
    }
    r = await client.post(
        "/api/orchestration/action_templates?appId=inside-sales", json=body,
    )
    assert r.status_code == 200, r.text
    assert r.json()["slug"] == slug

    # Upsert again with new name → should overwrite, not duplicate.
    body["name"] = "Updated"
    r2 = await client.post(
        "/api/orchestration/action_templates?appId=inside-sales", json=body,
    )
    assert r2.status_code == 200
    assert r2.json()["name"] == "Updated"
    assert r2.json()["id"] == r.json()["id"]

    listing = await client.get(
        "/api/orchestration/action_templates?appId=inside-sales&channel=wati"
    )
    assert listing.status_code == 200
    matched = [t for t in listing.json() if t["slug"] == slug]
    assert len(matched) == 1


@pytest.mark.asyncio
async def test_set_and_get_consent(client):
    rid = f"P-{uuid.uuid4().hex[:8]}"
    r = await client.post(
        "/api/orchestration/consent?appId=inside-sales",
        json={
            "recipientId": rid,
            "channel": "wa",
            "status": "opted_in",
            "source": "manual",
            "evidence": {"who": "qa"},
        },
    )
    assert r.status_code == 201, r.text
    g = await client.get(
        f"/api/orchestration/consent/{rid}?appId=inside-sales"
    )
    assert g.status_code == 200
    rows = g.json()
    assert len(rows) == 1
    assert rows[0]["status"] == "opted_in"
    assert rows[0]["channel"] == "wa"


# ─── Node-type catalog ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_node_types_filtered_for_crm(client):
    r = await client.get("/api/orchestration/node_types?workflowType=crm")
    assert r.status_code == 200
    types = [t["nodeType"] for t in r.json()]
    assert "crm.send_wati" in types
    assert "core.webhook_out" in types
    assert "clinical.schedule_lab" not in types


@pytest.mark.asyncio
async def test_node_type_descriptor_includes_config_schema(client):
    r = await client.get("/api/orchestration/node_types?workflowType=crm")
    descs = {d["nodeType"]: d for d in r.json()}
    cond = descs["logic.conditional"]
    schema = cond["configSchema"]
    assert "properties" in schema
