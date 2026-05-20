"""Phase 5A — /api/notification-subscriptions/* route tests.

Handlers are called directly with a fake AsyncSession and an AuthContext.
External SMTP is never touched; the mail facade is not invoked from these
routes (notification subscriptions are read/write only).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.auth import AuthContext
from app.models.mail_send_log import MailSendLog
from app.models.notification_subscription import NotificationSubscription
from app.routes import notification_subscriptions as nsub_routes
from app.schemas.notification_subscription import (
    RecipientUpdate,
    SubscriptionUpdate,
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _auth(
    *,
    tenant_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    email: str = "alice@tatvacare.in",
) -> AuthContext:
    return AuthContext(
        user_id=user_id or uuid.uuid4(),
        tenant_id=tenant_id or uuid.uuid4(),
        email=email,
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset(),
        app_access=frozenset(),
    )


class _FakeScalars:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)


class _FakeResult:
    def __init__(self, items=()):
        self._items = list(items)

    def scalars(self):
        return _FakeScalars(self._items)


class _FakeSession:
    """Minimal AsyncSession stand-in. Tests queue scalar + execute results."""

    def __init__(self):
        self.added: list[Any] = []
        self.commits = 0
        self._queued_scalars: list[Any] = []
        self._queued_results: list[_FakeResult] = []
        self.executed: list[Any] = []
        self.scalar_calls: list[Any] = []

    def queue_scalar(self, value):
        self._queued_scalars.append(value)

    def queue_result(self, items):
        self._queued_results.append(_FakeResult(items))

    async def scalar(self, stmt):
        self.scalar_calls.append(stmt)
        if self._queued_scalars:
            return self._queued_scalars.pop(0)
        return None

    async def execute(self, stmt):
        self.executed.append(stmt)
        if self._queued_results:
            return self._queued_results.pop(0)
        return _FakeResult([])

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        pass

    async def commit(self):
        self.commits += 1


def _make_subscription(
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    event_type: str,
    is_active: bool = True,
    is_required: bool = False,
    recipient_email: str = "alice@tatvacare.in",
) -> NotificationSubscription:
    return NotificationSubscription(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        user_id=user_id,
        event_type=event_type,
        recipient_email=recipient_email,
        is_active=is_active,
        is_required=is_required,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def _make_send_log(
    *,
    tenant_id: uuid.UUID,
    recipient: str,
    call_site: str = "mail.scheduled_job_failed",
    status: str = "sent",
    sent_at: datetime | None = None,
) -> MailSendLog:
    return MailSendLog(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        call_site=call_site,
        recipient=recipient,
        subject="Scheduled job failed",
        status=status,
        provider_response=None,
        error_message=None,
        correlation_id=None,
        html_cached_at_send=None,
        sent_at=sent_at or datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# GET /api/notification-subscriptions
# ---------------------------------------------------------------------------


class TestListEmailSettings:
    """Resolver merges existing rows with the canonical event-type registry."""

    @pytest.mark.asyncio
    async def test_returns_row_per_event_type_with_defaults(self):
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id, user_id=user_id, email="alice@x.in")
        existing = _make_subscription(
            tenant_id=tenant_id,
            user_id=user_id,
            event_type="scheduled_job.failed",
            is_active=True,
            recipient_email="alice@x.in",
        )
        db = _FakeSession()
        db.queue_result([existing])

        result = await nsub_routes.list_email_settings(auth=auth, db=db)

        assert result.recipient_email == "alice@x.in"
        types = {r.event_type for r in result.subscriptions}
        assert types == {
            "scheduled_job.failed",
            "scheduled_job.completed",
            "workflow_run.failed",
            "workflow_run.completed",
        }
        failed = next(r for r in result.subscriptions if r.event_type == "scheduled_job.failed")
        assert failed.is_active is True
        assert failed.group == "scheduled_job"

        not_subscribed = next(
            r for r in result.subscriptions if r.event_type == "workflow_run.failed"
        )
        assert not_subscribed.is_active is False
        assert not_subscribed.recipient_email == "alice@x.in"
        assert not_subscribed.group == "workflow"

    @pytest.mark.asyncio
    async def test_recipient_email_uses_existing_subscription_when_present(self):
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id, user_id=user_id, email="alice@x.in")
        existing = _make_subscription(
            tenant_id=tenant_id,
            user_id=user_id,
            event_type="scheduled_job.failed",
            recipient_email="alice+notify@x.in",
        )
        db = _FakeSession()
        db.queue_result([existing])

        result = await nsub_routes.list_email_settings(auth=auth, db=db)
        assert result.recipient_email == "alice+notify@x.in"


# ---------------------------------------------------------------------------
# PUT /api/notification-subscriptions/{event_type}
# ---------------------------------------------------------------------------


class TestUpsertSubscription:
    @pytest.mark.asyncio
    async def test_creates_row_when_missing(self):
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id, user_id=user_id, email="alice@x.in")
        db = _FakeSession()
        db.queue_scalar(None)  # no existing row

        result = await nsub_routes.upsert_subscription(
            event_type="scheduled_job.failed",
            payload=SubscriptionUpdate(is_active=True),
            auth=auth,
            db=db,
        )

        assert len(db.added) == 1
        added = db.added[0]
        assert added.tenant_id == tenant_id
        assert added.user_id == user_id
        assert added.event_type == "scheduled_job.failed"
        assert added.is_active is True
        assert added.recipient_email == "alice@x.in"
        assert db.commits == 1
        assert result.is_active is True
        assert result.event_type == "scheduled_job.failed"

    @pytest.mark.asyncio
    async def test_updates_existing_row(self):
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id, user_id=user_id)
        existing = _make_subscription(
            tenant_id=tenant_id,
            user_id=user_id,
            event_type="scheduled_job.failed",
            is_active=True,
        )
        db = _FakeSession()
        db.queue_scalar(existing)

        result = await nsub_routes.upsert_subscription(
            event_type="scheduled_job.failed",
            payload=SubscriptionUpdate(is_active=False),
            auth=auth,
            db=db,
        )

        assert existing.is_active is False
        assert len(db.added) == 0
        assert db.commits == 1
        assert result.is_active is False

    @pytest.mark.asyncio
    async def test_rejects_when_required(self):
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id, user_id=user_id)
        existing = _make_subscription(
            tenant_id=tenant_id,
            user_id=user_id,
            event_type="scheduled_job.failed",
            is_active=True,
            is_required=True,
        )
        db = _FakeSession()
        db.queue_scalar(existing)

        with pytest.raises(HTTPException) as ei:
            await nsub_routes.upsert_subscription(
                event_type="scheduled_job.failed",
                payload=SubscriptionUpdate(is_active=False),
                auth=auth,
                db=db,
            )
        assert ei.value.status_code == 409

    @pytest.mark.asyncio
    async def test_rejects_unknown_event_type(self):
        auth = _auth()
        db = _FakeSession()
        with pytest.raises(HTTPException) as ei:
            await nsub_routes.upsert_subscription(
                event_type="bogus.event",
                payload=SubscriptionUpdate(is_active=True),
                auth=auth,
                db=db,
            )
        assert ei.value.status_code == 400


# ---------------------------------------------------------------------------
# PUT /api/notification-subscriptions/recipient
# ---------------------------------------------------------------------------


class TestUpdateRecipient:
    @pytest.mark.asyncio
    async def test_bulk_updates_every_subscription_for_user(self):
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id, user_id=user_id, email="alice@x.in")
        s1 = _make_subscription(
            tenant_id=tenant_id,
            user_id=user_id,
            event_type="scheduled_job.failed",
            recipient_email="alice@x.in",
        )
        s2 = _make_subscription(
            tenant_id=tenant_id,
            user_id=user_id,
            event_type="workflow_run.failed",
            recipient_email="alice@x.in",
        )
        db = _FakeSession()
        db.queue_result([s1, s2])

        with patch.object(
            nsub_routes,
            "_load_tenant_allowed_domains",
            new=AsyncMock(return_value=[]),
        ):
            result = await nsub_routes.update_recipient(
                payload=RecipientUpdate(recipient_email="alice+notify@x.in"),
                auth=auth,
                db=db,
            )

        assert s1.recipient_email == "alice+notify@x.in"
        assert s2.recipient_email == "alice+notify@x.in"
        assert db.commits == 1
        assert result.recipient_email == "alice+notify@x.in"

    @pytest.mark.asyncio
    async def test_blocked_when_domain_not_allowed(self):
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id, user_id=user_id, email="alice@x.in")
        db = _FakeSession()

        with patch.object(
            nsub_routes,
            "_load_tenant_allowed_domains",
            new=AsyncMock(return_value=["@tatvacare.in"]),
        ):
            with pytest.raises(HTTPException) as ei:
                await nsub_routes.update_recipient(
                    payload=RecipientUpdate(recipient_email="alice@gmail.com"),
                    auth=auth,
                    db=db,
                )
        assert ei.value.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/notification-subscriptions/recent-sends
# ---------------------------------------------------------------------------


class TestRecentSends:
    @pytest.mark.asyncio
    async def test_returns_user_addressed_rows(self):
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id, user_id=user_id, email="alice@x.in")
        row = _make_send_log(tenant_id=tenant_id, recipient="alice@x.in")
        db = _FakeSession()
        db.queue_result([row])

        result = await nsub_routes.list_recent_sends(auth=auth, db=db, limit=50)

        assert len(result) == 1
        rendered = str(db.executed[0])
        # Tenant filter + recipient filter + 7-day window must all be applied.
        assert "tenant_id" in rendered
        assert "recipient" in rendered
        assert "sent_at" in rendered


class TestTenantIsolation:
    """Every user-self read MUST filter by tenant_id + user_id."""

    @pytest.mark.asyncio
    async def test_list_filters_by_tenant_and_user(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_result([])
        await nsub_routes.list_email_settings(auth=auth, db=db)
        rendered = str(db.executed[0])
        assert "tenant_id" in rendered
        assert "user_id" in rendered

    @pytest.mark.asyncio
    async def test_update_recipient_filters_by_tenant_and_user(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_result([])
        with patch.object(
            nsub_routes,
            "_load_tenant_allowed_domains",
            new=AsyncMock(return_value=[]),
        ):
            await nsub_routes.update_recipient(
                payload=RecipientUpdate(recipient_email="alice@x.in"),
                auth=auth,
                db=db,
            )
        rendered = str(db.executed[0])
        assert "tenant_id" in rendered
        assert "user_id" in rendered

    @pytest.mark.asyncio
    async def test_upsert_filters_by_tenant_and_user(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_scalar(None)
        await nsub_routes.upsert_subscription(
            event_type="scheduled_job.failed",
            payload=SubscriptionUpdate(is_active=True),
            auth=auth,
            db=db,
        )
        rendered = str(db.scalar_calls[0])
        assert "tenant_id" in rendered
        assert "user_id" in rendered


class TestUpdateRecipientNegative:
    @pytest.mark.asyncio
    async def test_pydantic_rejects_invalid_email_format(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            RecipientUpdate(recipient_email="not-an-email")
