"""inside-sales route tests for boundary-aware refresh behavior."""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.auth import AuthContext
from app.models.job import Job
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


def _job(auth: AuthContext) -> Job:
    return Job(
        id=uuid.uuid4(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id='inside-sales',
        job_type='sync-external-source',
        status='queued',
        priority=100,
        queue_class='standard',
        attempt_count=0,
        max_attempts=3,
        params={
            'app_id': 'inside-sales',
            'source_family': 'calls',
            'source_system': 'lsq',
            'sync_mode': 'date_range',
            'date_from': '2026-04-01 00:00:00',
            'date_to': '2026-04-05 23:59:59',
            'is_scheduled_run': False,
        },
        progress={'current': 0, 'total': 0, 'message': 'Boundary sync queued'},
    )


@pytest.mark.asyncio
async def test_refresh_collection_uses_boundary_sync_for_out_of_window_request():
    auth = _auth()
    db = _FakeSession()
    job = _job(auth)
    body = CollectionRefreshRequest(
        date_from='2026-04-01 00:00:00',
        date_to='2026-04-05 23:59:59',
        event_codes='21,22',
    )

    with patch.object(inside_sales_routes, 'is_inside_hot_window', return_value=False), patch.object(
        inside_sales_routes,
        'validate_ondemand_window',
        return_value=None,
    ) as validate_window, patch.object(
        inside_sales_routes,
        'find_or_enqueue_ondemand_sync',
        new=AsyncMock(return_value=job),
    ) as enqueue_sync, patch.object(
        inside_sales_routes,
        'build_manual_refresh_job_params',
        side_effect=AssertionError('manual refresh helper should not be used'),
    ):
        response = await inside_sales_routes.refresh_collection(
            source_family='calls',
            body=body,
            auth=auth,
            db=db,
        )

    validate_window.assert_called_once()
    enqueue_sync.assert_awaited_once_with(
        db,
        tenant_id=auth.tenant_id,
        app_id='inside-sales',
        source_family='calls',
        date_from='2026-04-01 00:00:00',
        date_to='2026-04-05 23:59:59',
        user_id=auth.user_id,
        event_codes='21,22',
    )
    assert response.job_id == str(job.id)
    assert response.sync_mode == 'date_range'
    assert response.status == 'queued'
    assert db.added == []
    assert db.commits == 1
    assert db.refreshes == [job]
