"""Phase 3 — signup-invite mail flow.

Covers `_maybe_send_invite_email` (domain gate + emailStatus values) and the
`POST /api/admin/invite-links` route's audit augmentation. SMTP is patched
at `aiosmtplib.send`; the tenant-domain gate is patched at its consumer.
"""
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

fake_database = ModuleType('app.database')
fake_database.get_db = None
sys.modules.setdefault('app.database', fake_database)

from app.routes import admin as admin_routes
from app.services.mail.call_sites import CallSite
from app.services.mail.sender import MailNotConfigured, MailSendError


def _auth(**overrides):
    return SimpleNamespace(
        is_owner=False,
        permissions=frozenset({'invite_link:manage'}),
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        email='admin@example.com',
        role_id=uuid.uuid4(),
        app_access=frozenset(),
        **overrides,
    )


def _fake_db():
    db = MagicMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


class MaybeSendInviteEmailTests(unittest.IsolatedAsyncioTestCase):
    """`_maybe_send_invite_email` returns the right emailStatus across branches."""

    async def test_no_recipient_returns_not_requested(self):
        db = _fake_db()

        status = await admin_routes._maybe_send_invite_email(
            db,
            tenant_id=uuid.uuid4(),
            recipient_email=None,
            user_name=None,
            invite_url='https://example.test/signup?invite=tok',
            inviter_email='admin@example.com',
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            correlation_id=str(uuid.uuid4()),
        )

        self.assertEqual(status, 'not_requested')
        db.commit.assert_not_called()

    async def test_disallowed_domain_returns_recipient_rejected_without_send(self):
        db = _fake_db()

        async def _reject(email, tenant_id, db):
            raise HTTPException(403, detail='Email domain not allowed.')

        with patch.object(admin_routes, '_check_allowed_domains', side_effect=_reject), \
             patch.object(admin_routes, 'send_mail', new=AsyncMock()) as send_mail_mock:
            status = await admin_routes._maybe_send_invite_email(
                db,
                tenant_id=uuid.uuid4(),
                recipient_email='blocked@unallowed.com',
                user_name=None,
                invite_url='https://example.test/signup?invite=tok',
                inviter_email='admin@example.com',
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                correlation_id=str(uuid.uuid4()),
            )

        self.assertEqual(status, 'recipient_rejected')
        send_mail_mock.assert_not_called()

    async def test_send_success_returns_sent(self):
        db = _fake_db()

        with patch.object(admin_routes, '_check_allowed_domains', new=AsyncMock()), \
             patch.object(admin_routes, 'send_mail', new=AsyncMock()) as send_mail_mock:
            status = await admin_routes._maybe_send_invite_email(
                db,
                tenant_id=uuid.uuid4(),
                recipient_email='ok@allowed.com',
                user_name='Jane',
                invite_url='https://example.test/signup?invite=tok',
                inviter_email='admin@example.com',
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                correlation_id=str(uuid.uuid4()),
            )

        self.assertEqual(status, 'sent')
        send_mail_mock.assert_awaited_once()
        kwargs = send_mail_mock.await_args.kwargs
        self.assertEqual(kwargs['call_site'], CallSite.SIGNUP_INVITE)
        self.assertEqual(kwargs['recipient'], 'ok@allowed.com')
        self.assertEqual(kwargs['context']['user_name'], 'Jane')
        self.assertIn('IST', kwargs['context']['expires_at_display'])
        db.commit.assert_awaited()

    async def test_smtp_not_configured_returns_not_configured(self):
        db = _fake_db()

        with patch.object(admin_routes, '_check_allowed_domains', new=AsyncMock()), \
             patch.object(
                 admin_routes,
                 'send_mail',
                 new=AsyncMock(side_effect=MailNotConfigured('missing SMTP_HOST')),
             ):
            status = await admin_routes._maybe_send_invite_email(
                db,
                tenant_id=uuid.uuid4(),
                recipient_email='ok@allowed.com',
                user_name=None,
                invite_url='https://example.test/signup?invite=tok',
                inviter_email='admin@example.com',
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                correlation_id=str(uuid.uuid4()),
            )

        self.assertEqual(status, 'not_configured')

    async def test_smtp_failure_returns_failed_and_commits_log_row(self):
        db = _fake_db()

        with patch.object(admin_routes, '_check_allowed_domains', new=AsyncMock()), \
             patch.object(
                 admin_routes,
                 'send_mail',
                 new=AsyncMock(side_effect=MailSendError('relay refused')),
             ):
            status = await admin_routes._maybe_send_invite_email(
                db,
                tenant_id=uuid.uuid4(),
                recipient_email='ok@allowed.com',
                user_name=None,
                invite_url='https://example.test/signup?invite=tok',
                inviter_email='admin@example.com',
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                correlation_id=str(uuid.uuid4()),
            )

        self.assertEqual(status, 'failed')
        # mail_send_log row written by send_mail() needs the commit to persist.
        db.commit.assert_awaited()

    async def test_user_name_defaults_to_email_local_part(self):
        db = _fake_db()

        with patch.object(admin_routes, '_check_allowed_domains', new=AsyncMock()), \
             patch.object(admin_routes, 'send_mail', new=AsyncMock()) as send_mail_mock:
            await admin_routes._maybe_send_invite_email(
                db,
                tenant_id=uuid.uuid4(),
                recipient_email='priya.shah@allowed.com',
                user_name=None,
                invite_url='https://example.test/signup?invite=tok',
                inviter_email='admin@example.com',
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                correlation_id=str(uuid.uuid4()),
            )

        self.assertEqual(
            send_mail_mock.await_args.kwargs['context']['user_name'],
            'priya.shah',
        )


class CreateInviteLinkAuditTests(unittest.IsolatedAsyncioTestCase):
    """`POST /api/admin/invite-links` augments the audit row with email outcome."""

    async def test_send_mail_invoked_with_tenant_id_isolates_log_writes(self):
        """Tenant-scoped: a send for tenant A must call send_mail with tenant A's id,
        never another tenant's. The mail_send_log row is tenant-stamped via send_mail."""
        db = _fake_db()
        tenant_a = uuid.uuid4()
        tenant_b = uuid.uuid4()

        with patch.object(admin_routes, '_check_allowed_domains', new=AsyncMock()), \
             patch.object(admin_routes, 'send_mail', new=AsyncMock()) as send_mail_mock:
            await admin_routes._maybe_send_invite_email(
                db, tenant_id=tenant_a,
                recipient_email='a@allowed.com', user_name=None,
                invite_url='https://example.test/signup?invite=tok-a',
                inviter_email='admin-a@example.com',
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                correlation_id=str(uuid.uuid4()),
            )
            await admin_routes._maybe_send_invite_email(
                db, tenant_id=tenant_b,
                recipient_email='b@allowed.com', user_name=None,
                invite_url='https://example.test/signup?invite=tok-b',
                inviter_email='admin-b@example.com',
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                correlation_id=str(uuid.uuid4()),
            )

        self.assertEqual(send_mail_mock.await_count, 2)
        first_tenant = send_mail_mock.await_args_list[0].kwargs['tenant_id']
        second_tenant = send_mail_mock.await_args_list[1].kwargs['tenant_id']
        self.assertEqual(first_tenant, tenant_a)
        self.assertEqual(second_tenant, tenant_b)
        self.assertNotEqual(first_tenant, second_tenant)

    async def test_audit_after_state_includes_email_recipient_and_status(self):
        from app.routes import admin as admin_module
        db = _fake_db()
        auth = _auth()

        body = admin_routes.CreateInviteLinkRequest(
            label='ops-team',
            role_id=str(uuid.uuid4()),
            max_uses=5,
            expires_in_hours=24,
            recipient_email='ok@allowed.com',
            user_name='Jane',
        )
        db.scalar = AsyncMock(return_value=SimpleNamespace(id=uuid.UUID(body.role_id)))
        request = SimpleNamespace(
            headers={'origin': 'http://localhost:5173'},
            client=SimpleNamespace(host='127.0.0.1'),
        )

        captured_audits: list[dict] = []

        async def _capture_audit(_db, **kwargs):
            captured_audits.append(kwargs)

        with patch.object(admin_module, 'write_audit_log', side_effect=_capture_audit), \
             patch.object(
                 admin_module,
                 '_maybe_send_invite_email',
                 new=AsyncMock(return_value='sent'),
             ), \
             patch.object(
                 admin_module,
                 'create_refresh_token',
                 return_value=('raw', 'h' * 64),
             ):
            response = await admin_module.create_invite_link(
                body=body, request=request, auth=auth, db=db,
            )

        self.assertEqual(response['emailStatus'], 'sent')
        self.assertEqual(len(captured_audits), 1)
        after = captured_audits[0]['after_state']
        self.assertEqual(after['email_recipient'], 'ok@allowed.com')
        self.assertEqual(after['email_status'], 'sent')


if __name__ == '__main__':
    unittest.main()
