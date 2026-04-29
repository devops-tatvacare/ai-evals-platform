"""inside-sales route tests for refresh behavior.

Post LSQ-ETL retention change, the refresh endpoint supports three
explicit sync modes:

  * ``incremental`` (default) — one-shot delta on the last watermark.
  * ``date_range`` — explicit window bootstrap.
  * ``bootstrap`` — sugar for the canonical 90-day ``date_range`` seed.

There is no longer a forced 7-day hot window and no prune. Tests lock
those contracts.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.auth import AuthContext
from app.models.job import BackgroundJob
from app.routes import inside_sales as inside_sales_routes
from app.schemas.inside_sales import CollectionRefreshRequest


def _auth() -> AuthContext:
    return AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email='test@example.com',
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset({'inside-sales:view'}),
        app_access=frozenset({'inside-sales'}),
    )


def _ops_auth() -> AuthContext:
    return AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email='ops@example.com',
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset({'inside-sales:view', 'schedule:manage'}),
        app_access=frozenset({'inside-sales'}),
    )


class _FakeSession:
    def __init__(self):
        self.added: list[Any] = []
        self.commits = 0
        self.refreshes: list[Any] = []

    def add(self, item: Any) -> None:
        self.added.append(item)

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, item: Any) -> None:
        self.refreshes.append(item)


def _parse_dt(value: str) -> datetime:
    return datetime.strptime(value, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_refresh_collection_default_sync_mode_is_incremental():
    """No ``sync_mode`` in the body means a one-shot delta on top of the
    last successful watermark. No explicit dates should be sent."""
    auth = _auth()
    db = _FakeSession()
    body = CollectionRefreshRequest(event_codes='21,22')

    response = await inside_sales_routes.refresh_collection(
        source_family='calls',
        body=body,
        auth=auth,
        db=db,
    )

    assert db.commits == 1
    job = db.added[0]
    assert isinstance(job, BackgroundJob)
    params = job.params or {}
    assert params['sync_mode'] == 'incremental'
    assert 'date_from' not in params
    assert 'date_to' not in params
    assert params['event_codes'] == '21,22'
    assert params['is_scheduled_run'] is False
    assert response.sync_mode == 'incremental'


@pytest.mark.asyncio
async def test_refresh_collection_bootstrap_mode_emits_90_day_date_range():
    """``sync_mode=bootstrap`` is the plan's Phase 1 seed. The params must
    carry a 90-day ``date_range`` window ending now."""
    auth = _ops_auth()
    db = _FakeSession()
    body = CollectionRefreshRequest(sync_mode='bootstrap')

    await inside_sales_routes.refresh_collection(
        source_family='calls',
        body=body,
        auth=auth,
        db=db,
    )

    params = db.added[0].params
    assert params['sync_mode'] == 'date_range'
    date_from = _parse_dt(params['date_from'])
    date_to = _parse_dt(params['date_to'])
    now = datetime.now(timezone.utc)
    assert now - date_to <= timedelta(minutes=1)
    span = date_to - date_from
    assert timedelta(days=90) - timedelta(minutes=1) <= span <= timedelta(days=90) + timedelta(minutes=1)
    assert params['event_codes'] == '21,22'


@pytest.mark.asyncio
async def test_refresh_collection_date_range_mode_requires_dates():
    """``sync_mode=date_range`` without explicit dates must 400."""
    import fastapi
    auth = _ops_auth()
    db = _FakeSession()
    body = CollectionRefreshRequest(sync_mode='date_range')

    with pytest.raises(fastapi.HTTPException) as excinfo:
        await inside_sales_routes.refresh_collection(
            source_family='calls',
            body=body,
            auth=auth,
            db=db,
        )
    assert excinfo.value.status_code == 400


@pytest.mark.asyncio
async def test_refresh_collection_rejects_unknown_sync_mode():
    import fastapi
    auth = _auth()
    db = _FakeSession()
    body = CollectionRefreshRequest(sync_mode='weekly')

    with pytest.raises(fastapi.HTTPException) as excinfo:
        await inside_sales_routes.refresh_collection(
            source_family='calls',
            body=body,
            auth=auth,
            db=db,
        )
    assert excinfo.value.status_code == 400


@pytest.mark.asyncio
async def test_refresh_collection_bootstrap_requires_schedule_manage_permission():
    import fastapi

    auth = _auth()
    db = _FakeSession()
    body = CollectionRefreshRequest(sync_mode='bootstrap')

    with pytest.raises(fastapi.HTTPException) as excinfo:
        await inside_sales_routes.refresh_collection(
            source_family='calls',
            body=body,
            auth=auth,
            db=db,
        )
    assert excinfo.value.status_code == 403
    assert db.added == []


@pytest.mark.asyncio
async def test_refresh_collection_date_range_requires_schedule_manage_permission():
    import fastapi

    auth = _auth()
    db = _FakeSession()
    body = CollectionRefreshRequest(
        sync_mode='date_range',
        date_from='2026-04-01 00:00:00',
        date_to='2026-04-05 23:59:59',
    )

    with pytest.raises(fastapi.HTTPException) as excinfo:
        await inside_sales_routes.refresh_collection(
            source_family='calls',
            body=body,
            auth=auth,
            db=db,
        )
    assert excinfo.value.status_code == 403
    assert db.added == []


@pytest.mark.asyncio
async def test_get_collection_status_returns_durable_freshness_signal():
    """The status route reads from ``log_crm_source_sync`` so the UI can render
    correctly after a page reload. Verify it wires the service output to the
    ``CollectionSyncStatus`` schema field-for-field."""
    auth = _auth()
    db = _FakeSession()
    completed_at = datetime(2026, 4, 23, 9, 0, 0, tzinfo=timezone.utc)
    started_at = datetime(2026, 4, 23, 9, 30, 0, tzinfo=timezone.utc)
    fake_status = {
        'lastSuccessAt': completed_at,
        'lastAttemptAt': started_at,
        'lastStatus': 'failed',
        'lastError': 'A transaction is already begun on this Session.',
        'syncInProgress': False,
    }

    with patch.object(
        inside_sales_routes,
        'get_collection_sync_status',
        new=AsyncMock(return_value=fake_status),
    ) as status_mock:
        resp = await inside_sales_routes.get_collection_status(
            source_family='leads',
            auth=auth,
            db=db,
        )

    status_mock.assert_awaited_once_with(
        db,
        tenant_id=auth.tenant_id,
        app_id='inside-sales',
        source_family='leads',
    )
    assert resp.last_success_at == completed_at
    assert resp.last_attempt_at == started_at
    assert resp.last_status == 'failed'
    assert resp.last_error == 'A transaction is already begun on this Session.'
    assert resp.sync_in_progress is False


@pytest.mark.asyncio
async def test_get_collection_status_rejects_unknown_family():
    auth = _auth()
    db = _FakeSession()
    import fastapi
    with pytest.raises(fastapi.HTTPException) as excinfo:
        await inside_sales_routes.get_collection_status(
            source_family='bogus',
            auth=auth,
            db=db,
        )
    assert excinfo.value.status_code == 404


@pytest.mark.asyncio
async def test_refresh_collection_leads_family_omits_event_codes():
    auth = _auth()
    db = _FakeSession()
    body = CollectionRefreshRequest()

    response = await inside_sales_routes.refresh_collection(
        source_family='leads',
        body=body,
        auth=auth,
        db=db,
    )

    assert len(db.added) == 1
    job = db.added[0]
    params = job.params or {}
    assert params['source_family'] == 'leads'
    # Leads path never attaches event_codes.
    assert 'event_codes' not in params
    assert response.source_family == 'leads'


