"""Shared pytest fixtures for backend tests."""
from __future__ import annotations

import os
import uuid
from unittest.mock import AsyncMock, Mock

import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth import AuthContext


# ── Auth fixtures ──────────────────────────────────────────────

@pytest.fixture
def tenant_id():
    return uuid.uuid4()


@pytest.fixture
def user_id():
    return uuid.uuid4()


@pytest.fixture
def auth(tenant_id, user_id):
    """Standard auth context with owner privileges and all app access."""
    return AuthContext(
        user_id=user_id,
        tenant_id=tenant_id,
        email='test@example.com',
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({'voice-rx', 'kaira-bot', 'inside-sales'}),
    )


@pytest.fixture
def auth_for_app():
    """Factory: auth context scoped to specific apps."""
    def _make(*app_ids: str, is_owner: bool = False):
        return AuthContext(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email='test@example.com',
            role_id=uuid.uuid4(),
            is_owner=is_owner,
            permissions=frozenset(),
            app_access=frozenset(app_ids),
        )
    return _make


# ── Database fixtures ──────────────────────────────────────────

class FakeResult:
    """Simulates SQLAlchemy result objects."""
    def __init__(self, *, rows=None, scalar_value=None, first_row=None):
        self._rows = rows or []
        self._scalar_value = scalar_value
        self._first_row = first_row

    def all(self):
        return list(self._rows)

    def scalars(self):
        return self

    def scalar(self):
        return self._scalar_value

    def first(self):
        return self._first_row


@pytest.fixture
def fake_db():
    """AsyncMock that behaves like an async SQLAlchemy session."""
    session = AsyncMock()
    session.execute.return_value = FakeResult()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.flush = AsyncMock()
    return session


class FakeAnalyticsSession:
    """Context manager that yields a fake analytics DB session."""
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.fixture
def fake_analytics_db():
    """Fake analytics database session with context manager."""
    db = Mock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


@pytest.fixture
def fake_analytics_session(fake_analytics_db):
    """Returns a FakeAnalyticsSession wrapping fake_analytics_db."""
    return FakeAnalyticsSession(fake_analytics_db)


# ── Live-DB fixtures (orchestration & schema tests) ─────────────
#
# Most existing tests are unittest+AsyncMock (see fake_db above). The orchestration
# subsystem (docs/plans/orchestration/) needs to assert against real Postgres to
# verify schema/FK/CHECK/partial-index behaviour — mocks can't catch the bug class
# the unqualified-SQL/model scanners are designed to flag. These fixtures connect
# to the live local docker postgres (postgres:5432 inside the backend container,
# localhost:5432 from the host). They are opt-in: only tests that depend on
# `db_session` engage live-DB I/O.

def _resolve_test_database_url() -> str:
    """DATABASE_URL is set inside the backend container; default for host runs."""
    url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if url:
        return url
    return "postgresql+asyncpg://evals_user:evals_pass@localhost:5432/ai_evals_platform"


# Keep direct asyncpg call sites (e.g. orchestration SSE LISTEN/NOTIFY) on the
# same live Postgres target as the db_session fixture.
os.environ.setdefault("TEST_DATABASE_URL", _resolve_test_database_url())


@pytest_asyncio.fixture
async def db_engine():
    """Module-scoped-style async engine. Disposed at test end."""
    engine = create_async_engine(_resolve_test_database_url(), future=True, pool_pre_ping=True)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    """Async session bound to the live local docker DB.

    Each test runs inside an outer transaction plus a nested savepoint. Tests
    may call ``commit()`` and keep working within the same test, but teardown
    still rolls back the outer transaction so no rows leak into later tests.
    """
    connection = await db_engine.connect()
    outer = await connection.begin()
    Session = async_sessionmaker(bind=connection, expire_on_commit=False, class_=AsyncSession)
    session = Session()
    await session.begin_nested()

    @event.listens_for(session.sync_session, "after_transaction_end")
    def _restart_savepoint(sync_session, transaction):
        parent = getattr(transaction, "parent", None) or getattr(transaction, "_parent", None)
        if transaction.nested and (parent is None or not parent.nested):
            sync_session.begin_nested()

    try:
        yield session
    finally:
        event.remove(session.sync_session, "after_transaction_end", _restart_savepoint)
        await session.close()
        if outer.is_active:
            await outer.rollback()
        await connection.close()


@pytest_asyncio.fixture
async def seed_tenant_user_app(db_session):
    """Reuse the seeded SYSTEM_TENANT_ID + SYSTEM_USER_ID as FK targets.

    Test data inserted referencing these IDs is rolled back at session teardown.
    Returns (tenant_id, user_id, app_id).
    """
    from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
    return SYSTEM_TENANT_ID, SYSTEM_USER_ID, "test-orchestration"


@pytest_asyncio.fixture
async def seed_full_run(db_session, seed_tenant_user_app):
    """Seed a workflow + version + run + node_step so action/state/override tests can FK to them.

    Returns (run, version, workflow, node_step, tenant_id, app_id).
    """
    import uuid as _uuid
    from datetime import datetime as _datetime, timezone as _timezone

    from app.models.orchestration import (
        Workflow,
        WorkflowVersion,
        WorkflowRun,
        WorkflowRunNodeStep,
    )

    tenant_id, user_id, app_id = seed_tenant_user_app
    workflow = Workflow(
        id=_uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_type="crm", slug=f"test-full-run-{_uuid.uuid4().hex[:8]}",
        name="Full Run", created_by=user_id,
    )
    db_session.add(workflow)
    await db_session.flush()

    version = WorkflowVersion(
        id=_uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, version=1,
        definition={"nodes": [], "edges": []}, status="published",
    )
    db_session.add(version)
    await db_session.flush()

    run = WorkflowRun(
        id=_uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        triggered_by="manual", triggered_by_user_id=user_id,
        status="running",
    )
    db_session.add(run)
    await db_session.flush()

    node_step = WorkflowRunNodeStep(
        id=_uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_id="n1", node_type="source.event_trigger",
        status="completed", started_at=_datetime.now(_timezone.utc),
        completed_at=_datetime.now(_timezone.utc),
    )
    db_session.add(node_step)
    await db_session.flush()
    return run, version, workflow, node_step, tenant_id, app_id
