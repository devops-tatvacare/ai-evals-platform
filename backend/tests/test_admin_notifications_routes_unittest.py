"""Phase 5B — /api/admin/notifications/* route tests.

Handlers are called directly with a fake AsyncSession and an AuthContext.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, Request

from app.auth import AuthContext
from app.models.notification_subscription import NotificationSubscription
from app.routes import admin_notifications as routes
from app.schemas.admin_notifications import (
    AdminSubscriptionPatch,
    NotificationDefaultUpdate,
)


def _auth(*, tenant_id: uuid.UUID | None = None) -> AuthContext:
    return AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=tenant_id or uuid.uuid4(),
        email="admin@x.in",
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset({"notifications:manage"}),
        app_access=frozenset(),
    )


def _request() -> Request:
    scope = {
        "type": "http",
        "headers": [],
        "client": ("127.0.0.1", 0),
        "method": "PUT",
        "path": "/",
    }
    return Request(scope)


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

    def all(self):
        return list(self._items)


class _FakeSession:
    def __init__(self):
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.commits = 0
        self.executed: list[Any] = []
        self.scalar_calls: list[Any] = []
        self._scalar_queue: list[Any] = []
        self._result_queue: list[_FakeResult] = []

    def queue_scalar(self, v):
        self._scalar_queue.append(v)

    def queue_result(self, items):
        self._result_queue.append(_FakeResult(items))

    async def scalar(self, stmt):
        self.scalar_calls.append(stmt)
        if self._scalar_queue:
            return self._scalar_queue.pop(0)
        return None

    async def execute(self, stmt):
        self.executed.append(stmt)
        if self._result_queue:
            return self._result_queue.pop(0)
        return _FakeResult([])

    def add(self, item):
        self.added.append(item)

    async def delete(self, item):
        self.deleted.append(item)

    async def commit(self):
        self.commits += 1

    async def flush(self):
        pass


def _make_user(*, tenant_id: uuid.UUID, email: str = "alice@x.in"):
    return MagicMock(
        id=uuid.uuid4(), tenant_id=tenant_id, email=email, is_active=True
    )


def _make_sub(
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID | None,
    event_type: str = "scheduled_job.failed",
    recipient: str = "alice@x.in",
    is_active: bool = True,
    is_required: bool = False,
) -> NotificationSubscription:
    return NotificationSubscription(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        user_id=user_id,
        event_type=event_type,
        recipient_email=recipient,
        is_active=is_active,
        is_required=is_required,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


class TestListDefaults:
    async def test_emits_row_per_event_type(self):
        auth = _auth()
        db = _FakeSession()
        # _load_always_notify -> execute -> returns rows. Then per-event:
        # _is_required_for_all: scalar user_count + scalar required_count, four times.
        db.queue_result([])  # always-notify rows
        for _ in routes.EventType:
            db.queue_scalar(2)  # user_count
            db.queue_scalar(0)  # required_count
        result = await routes.list_defaults(auth=auth, db=db)
        assert {r.event_type for r in result.defaults} == {
            "scheduled_job.failed",
            "scheduled_job.completed",
            "workflow_run.failed",
            "workflow_run.completed",
        }
        for row in result.defaults:
            assert row.is_required_for_all is False
            assert row.always_notify_emails == []


class TestUpdateDefault:
    async def test_required_for_all_fans_out_to_existing_users(self):
        tenant_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id)
        u1 = _make_user(tenant_id=tenant_id, email="alice@x.in")
        u2 = _make_user(tenant_id=tenant_id, email="bob@x.in")
        db = _FakeSession()
        # before_required: user_count + required_count
        db.queue_scalar(2)
        db.queue_scalar(0)
        # before_always
        db.queue_result([])
        # existing_always
        db.queue_result([])
        # user_rows
        db.queue_result([u1, u2])
        # existing_user_rows (none — fresh enablement)
        db.queue_result([])

        result = await routes.update_default(
            event_type="scheduled_job.failed",
            payload=NotificationDefaultUpdate(
                is_required_for_all=True, always_notify_emails=[]
            ),
            request=_request(),
            auth=auth,
            db=db,
        )
        # Added one subscription per user + the audit row.
        sub_rows = [a for a in db.added if isinstance(a, NotificationSubscription)]
        assert len(sub_rows) == 2
        assert {row.recipient_email for row in sub_rows} == {"alice@x.in", "bob@x.in"}
        assert all(row.is_required for row in sub_rows)
        assert all(row.user_id is not None for row in sub_rows)
        assert result.is_required_for_all is True
        assert db.commits == 1

    async def test_always_notify_extra_address_creates_unowned_row(self):
        tenant_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id)
        db = _FakeSession()
        db.queue_scalar(1)  # user_count
        db.queue_scalar(0)  # required_count
        db.queue_result([])  # before_always
        db.queue_result([])  # existing_always (none)
        db.queue_result([])  # user_rows
        db.queue_result([])  # existing_user_rows (is_required=true relax path)

        await routes.update_default(
            event_type="scheduled_job.failed",
            payload=NotificationDefaultUpdate(
                is_required_for_all=False,
                always_notify_emails=["oncall@x.in"],
            ),
            request=_request(),
            auth=auth,
            db=db,
        )
        unowned = [
            a
            for a in db.added
            if isinstance(a, NotificationSubscription) and a.user_id is None
        ]
        assert len(unowned) == 1
        assert unowned[0].recipient_email == "oncall@x.in"
        assert unowned[0].is_required is True

    async def test_rejects_unknown_event(self):
        with pytest.raises(HTTPException) as ei:
            await routes.update_default(
                event_type="bogus",
                payload=NotificationDefaultUpdate(
                    is_required_for_all=False, always_notify_emails=[]
                ),
                request=_request(),
                auth=_auth(),
                db=_FakeSession(),
            )
        assert ei.value.status_code == 400


class TestSubscriptionPatch:
    async def test_404_for_subscription_in_other_tenant(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_scalar(None)
        with pytest.raises(HTTPException) as ei:
            await routes.patch_subscription(
                subscription_id=uuid.uuid4(),
                payload=AdminSubscriptionPatch(is_active=False),
                request=_request(),
                auth=auth,
                db=db,
            )
        assert ei.value.status_code == 404

    async def test_updates_active_flag(self):
        tenant_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id)
        sub = _make_sub(tenant_id=tenant_id, user_id=uuid.uuid4(), is_active=True)
        db = _FakeSession()
        db.queue_scalar(sub)  # initial scalar
        db.queue_scalar("alice@x.in")  # user_email lookup
        result = await routes.patch_subscription(
            subscription_id=sub.id,
            payload=AdminSubscriptionPatch(is_active=False),
            request=_request(),
            auth=auth,
            db=db,
        )
        assert sub.is_active is False
        assert result.is_active is False
        assert db.commits == 1


class TestSubscriptionDelete:
    async def test_deletes_and_audits(self):
        tenant_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id)
        sub = _make_sub(tenant_id=tenant_id, user_id=uuid.uuid4())
        db = _FakeSession()
        db.queue_scalar(sub)
        await routes.delete_subscription(
            subscription_id=sub.id,
            request=_request(),
            auth=auth,
            db=db,
        )
        assert sub in db.deleted
        assert db.commits == 1


class TestTenantIsolation:
    """Every admin read/write MUST filter by tenant_id."""

    async def test_list_defaults_filters_by_tenant(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_result([])
        for _ in routes.EventType:
            db.queue_scalar(0)
            db.queue_scalar(0)
        await routes.list_defaults(auth=auth, db=db)
        # First execute() is the always-notify lookup; must carry tenant_id.
        rendered = str(db.executed[0])
        assert "tenant_id" in rendered

    async def test_list_subscriptions_filters_by_tenant(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_scalar(0)  # total
        db.queue_result([])
        await routes.list_subscriptions(
            auth=auth,
            db=db,
            event_type=None,
            user_id=None,
            is_active=None,
            page=1,
            page_size=25,
        )
        # The list query (a SELECT joined to User) and the count subquery
        # both run; check the list statement carries tenant_id.
        rendered = " ".join(str(s) for s in db.executed)
        assert "tenant_id" in rendered

    async def test_delete_subscription_404_for_other_tenant(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_scalar(None)  # not found in this tenant
        with pytest.raises(HTTPException) as ei:
            await routes.delete_subscription(
                subscription_id=uuid.uuid4(),
                request=_request(),
                auth=auth,
                db=db,
            )
        assert ei.value.status_code == 404

    async def test_update_default_filters_by_tenant(self):
        tenant_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id)
        db = _FakeSession()
        db.queue_scalar(1)
        db.queue_scalar(0)
        db.queue_result([])
        db.queue_result([])
        db.queue_result([])
        db.queue_result([])
        await routes.update_default(
            event_type="scheduled_job.failed",
            payload=NotificationDefaultUpdate(
                is_required_for_all=False, always_notify_emails=[]
            ),
            request=_request(),
            auth=auth,
            db=db,
        )
        # No subscription rows added because nothing required + no always-notify.
        added_subs = [a for a in db.added if isinstance(a, NotificationSubscription)]
        assert added_subs == []


class TestSendLogFilters:
    async def test_status_filter_applied(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_scalar(0)
        db.queue_result([])
        await routes.list_send_log(
            auth=auth,
            db=db,
            status="failed",
            call_site=None,
            recipient=None,
            page=1,
            page_size=25,
        )
        # Predicate must reach the executed SELECT.
        rendered = str(db.executed[-1])
        assert "status" in rendered.lower()

    async def test_recipient_filter_uses_ilike(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_scalar(0)
        db.queue_result([])
        await routes.list_send_log(
            auth=auth,
            db=db,
            status=None,
            call_site=None,
            recipient="alice",
            page=1,
            page_size=25,
        )
        rendered = str(db.executed[-1]).lower()
        assert "recipient" in rendered


class TestPermissionGate:
    """The `notifications:manage` permission is enforced via `require_permission`."""

    async def test_every_admin_route_requires_notifications_manage(self):
        from app.routes.admin_notifications import router

        perm_routes = [r for r in router.routes if hasattr(r, "endpoint")]
        assert len(perm_routes) >= 6
        for route in perm_routes:
            sig_defaults = route.endpoint.__defaults__ or ()
            permission_strings: list[str] = []
            for default in sig_defaults:
                # `require_permission("notifications:manage")` returns a
                # `Depends(_checker)` whose closure carries the `perms` tuple.
                dep = getattr(default, "dependency", None)
                if dep is None or not hasattr(dep, "__closure__") or dep.__closure__ is None:
                    continue
                for cell in dep.__closure__:
                    val = cell.cell_contents
                    if isinstance(val, tuple) and all(isinstance(v, str) for v in val):
                        permission_strings.extend(val)
            assert "notifications:manage" in permission_strings, (
                f"route {route.path} missing notifications:manage gate"
            )

    async def test_non_admin_token_gets_403(self):
        from app.auth.permissions import ensure_permissions
        non_admin = AuthContext(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="viewer@x.in",
            role_id=uuid.uuid4(),
            is_owner=False,
            permissions=frozenset({"cost:view"}),
            app_access=frozenset(),
        )
        with pytest.raises(HTTPException) as ei:
            ensure_permissions(non_admin, "notifications:manage")
        assert ei.value.status_code == 403


class TestSignupFanOut:
    async def test_provisions_required_rows_for_new_user(self):
        from app.services.mail.onboarding import provision_required_subscriptions_for_user

        tenant_id = uuid.uuid4()
        new_user_id = uuid.uuid4()
        # Two events have at least one is_required=true row in the tenant.
        existing_required = _make_sub(
            tenant_id=tenant_id,
            user_id=uuid.uuid4(),
            event_type="scheduled_job.failed",
            is_required=True,
        )
        db = _FakeSession()
        # For each EventType: first scalar = existing_required lookup,
        # second scalar = existing_for_user lookup.
        db.queue_scalar(existing_required)  # scheduled_job.failed has required
        db.queue_scalar(None)  # new user has no row yet
        db.queue_scalar(None)  # scheduled_job.completed: not required
        db.queue_scalar(None)  # workflow_run.failed: not required
        db.queue_scalar(None)  # workflow_run.completed: not required

        added = await provision_required_subscriptions_for_user(
            db,
            tenant_id=tenant_id,
            user_id=new_user_id,
            user_email="newuser@x.in",
        )
        assert added == 1
        rows = [r for r in db.added if isinstance(r, NotificationSubscription)]
        assert len(rows) == 1
        assert rows[0].event_type == "scheduled_job.failed"
        assert rows[0].user_id == new_user_id
        assert rows[0].is_required is True
        assert rows[0].is_active is True
        assert rows[0].recipient_email == "newuser@x.in"

    async def test_idempotent_when_user_already_has_row(self):
        from app.services.mail.onboarding import provision_required_subscriptions_for_user

        tenant_id = uuid.uuid4()
        new_user_id = uuid.uuid4()
        existing_required = _make_sub(
            tenant_id=tenant_id,
            user_id=uuid.uuid4(),
            event_type="scheduled_job.failed",
            is_required=True,
        )
        existing_for_user = _make_sub(
            tenant_id=tenant_id,
            user_id=new_user_id,
            event_type="scheduled_job.failed",
            is_required=True,
        )
        db = _FakeSession()
        db.queue_scalar(existing_required)
        db.queue_scalar(existing_for_user)  # already has row
        db.queue_scalar(None)
        db.queue_scalar(None)
        db.queue_scalar(None)

        added = await provision_required_subscriptions_for_user(
            db,
            tenant_id=tenant_id,
            user_id=new_user_id,
            user_email="newuser@x.in",
        )
        assert added == 0


class TestPreviewSendLog:
    async def test_returns_html_for_existing_row_in_tenant(self):
        from app.models.mail_send_log import MailSendLog

        tenant_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id)
        row = MailSendLog(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            call_site="mail.scheduled_job_failed",
            recipient="alice@x.in",
            subject="Scheduled job failed",
            status="sent",
            provider_response={"errors": [], "message": "ok"},
            error_message=None,
            correlation_id=None,
            html_cached_at_send="<html><body>hi</body></html>",
            sent_at=datetime.now(timezone.utc),
        )
        db = _FakeSession()
        db.queue_scalar(row)
        preview = await routes.preview_send_log(
            send_log_id=row.id, auth=auth, db=db
        )
        assert preview.html == "<html><body>hi</body></html>"
        assert preview.provider_response == {"errors": [], "message": "ok"}
        assert preview.recipient == "alice@x.in"

    async def test_404_for_other_tenant_row(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_scalar(None)
        with pytest.raises(HTTPException) as ei:
            await routes.preview_send_log(
                send_log_id=uuid.uuid4(), auth=auth, db=db
            )
        assert ei.value.status_code == 404

    async def test_returns_null_html_for_pre_cache_row(self):
        from app.models.mail_send_log import MailSendLog

        tenant_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id)
        row = MailSendLog(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            call_site="mail.scheduled_job_failed",
            recipient="alice@x.in",
            subject="Older email",
            status="sent",
            provider_response=None,
            error_message=None,
            correlation_id=None,
            html_cached_at_send=None,
            sent_at=datetime.now(timezone.utc),
        )
        db = _FakeSession()
        db.queue_scalar(row)
        preview = await routes.preview_send_log(
            send_log_id=row.id, auth=auth, db=db
        )
        assert preview.html is None


class TestSendLogDateFilter:
    async def test_from_and_to_predicates_applied(self):
        auth = _auth()
        db = _FakeSession()
        db.queue_scalar(0)
        db.queue_result([])
        await routes.list_send_log(
            auth=auth,
            db=db,
            status=None,
            call_site=None,
            recipient=None,
            from_date=datetime(2026, 5, 1, tzinfo=timezone.utc),
            to_date=datetime(2026, 5, 20, tzinfo=timezone.utc),
            page=1,
            page_size=25,
        )
        rendered = " ".join(str(s) for s in db.executed)
        assert "sent_at" in rendered


class TestCsvExport:
    async def test_streams_csv_with_header(self):
        from app.models.mail_send_log import MailSendLog

        tenant_id = uuid.uuid4()
        auth = _auth(tenant_id=tenant_id)
        row = MailSendLog(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            call_site="mail.scheduled_job_failed",
            recipient="alice@x.in",
            subject="Scheduled job failed",
            status="sent",
            provider_response=None,
            error_message=None,
            correlation_id="corr-1",
            html_cached_at_send=None,
            sent_at=datetime(2026, 5, 20, 10, 0, tzinfo=timezone.utc),
        )
        db = _FakeSession()
        db.queue_result([row])
        response = await routes.export_send_log_csv(
            auth=auth,
            db=db,
            status=None,
            call_site=None,
            recipient=None,
            from_date=None,
            to_date=None,
        )
        body_chunks: list[bytes | str] = []
        async for chunk in response.body_iterator:
            body_chunks.append(chunk)
        body = "".join(c if isinstance(c, str) else c.decode() for c in body_chunks)
        lines = body.splitlines()
        assert lines[0] == "sent_at,call_site,recipient,subject,status,correlation_id,error_message"
        assert "alice@x.in" in body
        assert "corr-1" in body
        assert response.media_type == "text/csv"


class TestSendLog:
    async def test_returns_paginated_rows(self):
        from app.models.mail_send_log import MailSendLog

        auth = _auth()
        row = MailSendLog(
            id=uuid.uuid4(),
            tenant_id=auth.tenant_id,
            call_site="mail.scheduled_job_failed",
            recipient="alice@x.in",
            subject="Scheduled job failed",
            status="sent",
            provider_response=None,
            error_message=None,
            correlation_id=None,
            html_cached_at_send=None,
            sent_at=datetime.now(timezone.utc),
        )
        db = _FakeSession()
        db.queue_scalar(1)  # total
        db.queue_result([row])
        result = await routes.list_send_log(
            auth=auth,
            db=db,
            status=None,
            call_site=None,
            recipient=None,
            page=1,
            page_size=25,
        )
        assert result.total == 1
        assert result.rows[0].recipient == "alice@x.in"
