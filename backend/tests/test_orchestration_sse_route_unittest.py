"""Route-level tests for GET /api/orchestration/runs/{id}/stream."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import httpx
import pytest

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_USER_ID
from app.database import get_db
from app.main import app
from app.models.orchestration import Workflow, WorkflowRun, WorkflowRunNodeStep, WorkflowVersion


def _override_db(db_session):
    async def _g():
        yield db_session

    app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]


def _override_auth(tenant_id: uuid.UUID):
    auth = AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=tenant_id,
        email='test@orchestration.local',
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({'voice-rx', 'kaira-bot', 'inside-sales'}),
    )
    app.dependency_overrides[get_auth_context] = lambda: auth


async def _seed_streamable_run(db_session, *, tenant_id: uuid.UUID, app_id: str) -> WorkflowRun:
    workflow = Workflow(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_type='crm',
        slug=f'stream-{uuid.uuid4().hex[:8]}',
        name='Stream Test',
        created_by=SYSTEM_USER_ID,
    )
    db_session.add(workflow)
    await db_session.flush()

    version = WorkflowVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        version=1,
        definition={'nodes': [], 'edges': []},
        status='published',
    )
    db_session.add(version)
    await db_session.flush()

    run = WorkflowRun(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        workflow_version_id=version.id,
        triggered_by='manual',
        triggered_by_user_id=SYSTEM_USER_ID,
        status='running',
    )
    db_session.add(run)
    await db_session.flush()

    db_session.add(
        WorkflowRunNodeStep(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow.id,
            workflow_version_id=version.id,
            run_id=run.id,
            node_id='n1',
            node_type='source.cohort_query',
            status='completed',
            started_at=datetime.now(timezone.utc),
            completed_at=datetime.now(timezone.utc),
        )
    )
    await db_session.flush()
    return run


@pytest.mark.asyncio
async def test_sse_stream_returns_hello_and_forwarded_events(db_session, monkeypatch):
    tenant_id = uuid.UUID('00000000-0000-0000-0000-000000000001')
    run = await _seed_streamable_run(db_session, tenant_id=tenant_id, app_id='inside-sales')

    async def _fake_subscribe(_run_id, *, max_events=None, idle_timeout=30.0):
        assert str(_run_id) == str(run.id)
        assert max_events is None
        assert idle_timeout == 120.0
        yield {'type': 'node_step.completed', 'node_id': 'n1', 'outputs_summary': {'success': 2}}

    monkeypatch.setattr('app.routes.orchestration_sse.subscribe', _fake_subscribe)
    _override_db(db_session)
    _override_auth(tenant_id)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url='http://test'
        ) as client:
            r = await client.get(f'/api/orchestration/runs/{run.id}/stream')
        assert r.status_code == 200, r.text
        assert r.headers['content-type'].startswith('text/event-stream')
        assert f'event: hello\ndata: {json.dumps({"run_id": str(run.id)})}' in r.text
        assert 'event: node_step.completed' in r.text
        assert '"node_id": "n1"' in r.text
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_auth_context, None)


@pytest.mark.asyncio
async def test_sse_stream_404_for_foreign_tenant(db_session):
    run = await _seed_streamable_run(
        db_session,
        tenant_id=uuid.UUID('00000000-0000-0000-0000-000000000001'),
        app_id='inside-sales',
    )
    _override_db(db_session)
    _override_auth(uuid.uuid4())
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url='http://test'
        ) as client:
            r = await client.get(f'/api/orchestration/runs/{run.id}/stream')
        assert r.status_code == 404, r.text
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_auth_context, None)
