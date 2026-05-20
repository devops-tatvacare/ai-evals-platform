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

from app.config import settings
from app.models.invite_link import IdentityInviteLink, InviteSignupMethod, InviteStatus
from app.routes import admin as admin_routes
from app.routes import auth as auth_routes
from app.services import invite_links as invite_link_service


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


def _make_invite(**overrides) -> IdentityInviteLink:
    # ``is_active`` was retained for Phase 1–3 dual-write; Phase 4 dropped
    # it. Tests still pass it for back-compat — silently swallow.
    overrides.pop('is_active', None)
    invite = IdentityInviteLink(
        tenant_id=overrides.pop('tenant_id', uuid.uuid4()),
        created_by=overrides.pop('created_by', uuid.uuid4()),
        token_hash=overrides.pop('token_hash', 'x' * 64),
        role_id=overrides.pop('role_id', uuid.uuid4()),
        max_uses=None,
        uses_count=0,
        expires_at=overrides.pop(
            'expires_at',
            datetime.now(timezone.utc) + timedelta(days=1),
        ),
    )
    invite.id = overrides.pop('id', uuid.uuid4())
    invite.label = overrides.pop('label', 'test invite')
    invite.created_at = overrides.pop('created_at', datetime.now(timezone.utc))
    invite.status = overrides.pop('status', InviteStatus.active)
    invite.signup_method = overrides.pop('signup_method', InviteSignupMethod.password)
    invite.revoked_at = overrides.pop('revoked_at', None)
    invite.revoked_by = overrides.pop('revoked_by', None)
    invite.revoked_by_email_snapshot = overrides.pop('revoked_by_email_snapshot', None)
    invite.created_by_email_snapshot = overrides.pop('created_by_email_snapshot', None)
    for key, value in overrides.items():
        setattr(invite, key, value)
    return invite


class InviteLinkUrlTests(unittest.TestCase):
    def test_invite_base_url_prefers_request_origin(self):
        request = SimpleNamespace(headers={'origin': 'http://192.168.10.188:5173'})

        base_url = admin_routes._invite_base_url(request)

        self.assertEqual(base_url, 'http://192.168.10.188:5173')

    def test_invite_base_url_falls_back_to_config(self):
        request = SimpleNamespace(headers={})
        original_base_url = settings.APP_BASE_URL
        settings.APP_BASE_URL = 'http://localhost:5173/'
        try:
            base_url = admin_routes._invite_base_url(request)
        finally:
            settings.APP_BASE_URL = original_base_url

        self.assertEqual(base_url, 'http://localhost:5173')


class CreateInviteLinkDualWriteTests(unittest.IsolatedAsyncioTestCase):
    """Create writes the lifecycle columns needed by the rebuilt invite flow."""

    async def test_create_persists_status_signup_method_and_creator_snapshot(self):
        captured: list[IdentityInviteLink] = []

        # ``db.add`` is sync; only flush/commit/refresh/scalar are async.
        db = MagicMock()
        db.add = MagicMock(side_effect=lambda obj: captured.append(obj))
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()

        body = admin_routes.CreateInviteLinkRequest(
            label='ops-team',
            role_id=str(uuid.uuid4()),
            max_uses=5,
            expires_in_hours=72,
        )
        db.scalar = AsyncMock(return_value=SimpleNamespace(id=uuid.UUID(body.role_id)))
        request = SimpleNamespace(headers={'origin': 'http://localhost:5173'})
        auth = _auth()

        with patch.object(
            admin_routes, 'write_audit_log', new_callable=AsyncMock
        ) as audit_mock:
            await admin_routes.create_invite_link(
                body=body,
                request=request,
                auth=auth,
                db=db,
            )

        self.assertEqual(len(captured), 1)
        invite = captured[0]
        self.assertEqual(invite.status, InviteStatus.active)
        self.assertEqual(invite.signup_method, InviteSignupMethod.password)
        self.assertEqual(invite.created_by_email_snapshot, 'admin@example.com')
        # ``is_active`` is server-default true; the ORM applies it on flush
        # which doesn't happen in this offline test, so we don't assert it.
        audit_mock.assert_awaited_once()


class RevokeInviteLinkTests(unittest.IsolatedAsyncioTestCase):
    """Phase 1 §4: revoke is now a state transition. ACTIVE → REVOKED writes
    ``status``/``revoked_at``/``revoked_by``/snapshot; non-ACTIVE → 409."""

    async def test_revoke_active_invite_writes_status_and_audit_columns(self):
        auth = _auth()
        invite = _make_invite(tenant_id=auth.tenant_id, status=InviteStatus.active)

        db = AsyncMock()
        db.scalar.return_value = invite
        db.commit = AsyncMock()

        # Phase 2: revoke now lives in the service module; patch the audit
        # symbol there.
        with patch.object(
            invite_link_service, 'write_audit_log', new_callable=AsyncMock
        ) as audit_mock:
            result = await admin_routes.revoke_invite_link_v2(
                link_id=invite.id,
                request=object(),
                auth=auth,
                db=db,
            )

        # Phase 2: revoke v2 returns the updated invite envelope.
        self.assertEqual(result['id'], str(invite.id))
        self.assertEqual(result['status'], InviteStatus.revoked.value)
        self.assertEqual(invite.status, InviteStatus.revoked)
        self.assertIsNotNone(invite.revoked_at)
        self.assertEqual(invite.revoked_by, auth.user_id)
        self.assertEqual(invite.revoked_by_email_snapshot, auth.email)
        audit_mock.assert_awaited_once()

    async def test_revoke_already_revoked_returns_409(self):
        auth = _auth()
        invite = _make_invite(
            tenant_id=auth.tenant_id,
            status=InviteStatus.revoked,
            is_active=False,
            revoked_at=datetime.now(timezone.utc),
        )

        db = AsyncMock()
        db.scalar.return_value = invite

        with self.assertRaises(HTTPException) as ctx:
            await admin_routes.revoke_invite_link_v2(
                link_id=invite.id,
                request=object(),
                auth=auth,
                db=db,
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn('already revoked', ctx.exception.detail)

    async def test_revoke_expired_invite_returns_409(self):
        auth = _auth()
        invite = _make_invite(
            tenant_id=auth.tenant_id,
            status=InviteStatus.expired,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )

        db = AsyncMock()
        db.scalar.return_value = invite

        with self.assertRaises(HTTPException) as ctx:
            await admin_routes.revoke_invite_link_v2(
                link_id=invite.id,
                request=object(),
                auth=auth,
                db=db,
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn('already expired', ctx.exception.detail)


class CreatorEmailFallbackTests(unittest.TestCase):
    """Phase 1 §4: list query is OUTER JOIN now; ``_resolve_creator_email``
    falls back to the snapshot then the fallback string when the creator
    user has been deleted."""

    def test_live_email_wins_when_present(self):
        invite = _make_invite(created_by_email_snapshot='snapshot@example.com')
        self.assertEqual(
            admin_routes._resolve_creator_email(invite, 'live@example.com'),
            'live@example.com',
        )

    def test_snapshot_used_when_creator_deleted(self):
        invite = _make_invite(created_by_email_snapshot='snapshot@example.com')
        self.assertEqual(
            admin_routes._resolve_creator_email(invite, None),
            'snapshot@example.com',
        )

    def test_fallback_string_when_no_snapshot(self):
        # Pre-migration orphan rows have neither live email nor snapshot.
        invite = _make_invite(created_by_email_snapshot=None)
        self.assertEqual(
            admin_routes._resolve_creator_email(invite, None),
            admin_routes._INVITE_CREATOR_FALLBACK,
        )

    def test_invite_response_carries_resolved_email(self):
        invite = _make_invite()
        resp = admin_routes._invite_response(invite, 'resolved@example.com')
        self.assertEqual(resp['createdByEmail'], 'resolved@example.com')


class InviteResponseShapeTests(unittest.TestCase):
    """Phase 2 §5: response gains the new lifecycle fields."""

    def test_active_invite_response_includes_new_fields(self):
        invite = _make_invite()
        resp = admin_routes._invite_response(invite, 'admin@example.com')
        self.assertEqual(resp['status'], 'active')
        self.assertEqual(resp['signupMethod'], 'password')
        self.assertIsNone(resp['revokedAt'])
        self.assertIsNone(resp['revokedBy'])
        self.assertIsNone(resp['revokedByEmail'])
        self.assertEqual(resp['createdBy'], str(invite.created_by))

    def test_revoked_invite_response_includes_revoke_audit(self):
        actor = uuid.uuid4()
        revoked_at = datetime.now(timezone.utc)
        invite = _make_invite(
            status=InviteStatus.revoked,
            is_active=False,
            revoked_at=revoked_at,
            revoked_by=actor,
            revoked_by_email_snapshot='actor@example.com',
        )
        resp = admin_routes._invite_response(invite, 'admin@example.com')
        self.assertEqual(resp['status'], 'revoked')
        self.assertEqual(resp['revokedAt'], revoked_at.isoformat())
        self.assertEqual(resp['revokedBy'], str(actor))
        self.assertEqual(resp['revokedByEmail'], 'actor@example.com')


class CreateInviteLinkSsoRejectTests(unittest.IsolatedAsyncioTestCase):
    """Phase 2 §8: SSO invites are 501 until the redemption path lands."""

    async def test_sso_signup_method_is_rejected_with_501(self):
        body = admin_routes.CreateInviteLinkRequest(
            label='sso-attempt',
            role_id=str(uuid.uuid4()),
            signup_method='sso',
        )
        with self.assertRaises(HTTPException) as ctx:
            await admin_routes.create_invite_link(
                body=body,
                request=SimpleNamespace(headers={}),
                auth=_auth(),
                db=AsyncMock(),
            )
        self.assertEqual(ctx.exception.status_code, 501)
        self.assertIn('SSO', ctx.exception.detail)


class HardDeleteInviteLinkTests(unittest.IsolatedAsyncioTestCase):
    """Canonical hard-delete is terminal-only and audited."""

    async def test_hard_delete_active_invite_returns_409(self):
        auth = _auth()
        invite = _make_invite(tenant_id=auth.tenant_id, status=InviteStatus.active)
        db = AsyncMock()
        db.scalar.return_value = invite

        with self.assertRaises(HTTPException) as ctx:
            await admin_routes.hard_delete_invite_link(
                link_id=invite.id,
                request=object(),
                auth=auth,
                db=db,
            )
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn('revoke it first', ctx.exception.detail)

    async def test_hard_delete_terminal_invite_calls_db_delete(self):
        auth = _auth()
        invite = _make_invite(
            tenant_id=auth.tenant_id,
            status=InviteStatus.revoked,
            is_active=False,
            revoked_at=datetime.now(timezone.utc),
        )
        db = AsyncMock()
        db.scalar.return_value = invite

        with patch.object(
            invite_link_service, 'write_audit_log', new_callable=AsyncMock
        ) as audit_mock:
            result = await admin_routes.hard_delete_invite_link(
                link_id=invite.id,
                request=object(),
                auth=auth,
                db=db,
            )

        self.assertEqual(result, {'deleted': True, 'id': str(invite.id)})
        audit_mock.assert_awaited_once()
        # ``db.delete`` is the cascade trigger; ``_uses`` rows go via FK.
        db.delete.assert_awaited_once()
        db.commit.assert_awaited_once()

    async def test_hard_delete_allows_stale_expired_row(self):
        auth = _auth()
        invite = _make_invite(
            tenant_id=auth.tenant_id,
            status=InviteStatus.active,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        db = AsyncMock()
        db.scalar.return_value = invite

        with patch.object(
            invite_link_service, 'write_audit_log', new_callable=AsyncMock
        ) as audit_mock:
            result = await admin_routes.hard_delete_invite_link(
                link_id=invite.id,
                request=object(),
                auth=auth,
                db=db,
            )

        self.assertEqual(invite.status, InviteStatus.expired)
        self.assertEqual(result, {'deleted': True, 'id': str(invite.id)})
        audit_mock.assert_awaited_once()
        db.delete.assert_awaited_once()


class ListInviteLinkUsesTests(unittest.IsolatedAsyncioTestCase):
    """Phase 2 §3: ``GET /uses`` returns redemptions, IP hashes truncated."""

    async def test_list_uses_returns_truncated_ip_hash_and_user_email(self):
        auth = _auth()
        invite = _make_invite(tenant_id=auth.tenant_id)
        from app.models.invite_link_use import IdentityInviteLinkUse

        use = IdentityInviteLinkUse(
            invite_link_id=invite.id,
            user_id=uuid.uuid4(),
            user_email_snapshot='redeemer@example.com',
            ip_hash='abcdef0123456789' * 4,  # 64 chars
        )
        use.id = uuid.uuid4()
        use.used_at = datetime.now(timezone.utc)

        db = AsyncMock()
        # First scalar() loads the parent invite; the service then runs an
        # execute() that returns the use row.
        db.scalar.return_value = invite
        execute_result = MagicMock()
        execute_result.scalars.return_value.all.return_value = [use]
        db.execute.return_value = execute_result

        result = await admin_routes.list_invite_link_uses(
            link_id=invite.id,
            auth=auth,
            db=db,
        )

        self.assertEqual(len(result['items']), 1)
        item = result['items'][0]
        self.assertEqual(item['userEmail'], 'redeemer@example.com')
        # 12 chars + ellipsis — never the full hash.
        self.assertEqual(len(item['ipHashPrefix']), 13)
        self.assertTrue(item['ipHashPrefix'].endswith('…'))


class CanonicalDeleteRouteTests(unittest.IsolatedAsyncioTestCase):
    """Phase 4: ``DELETE /{link_id}`` now means hard-delete; the legacy
    soft-revoke alias is gone. Active invites 409, terminal invites
    delete and cascade ``_uses``."""

    async def test_canonical_delete_active_invite_returns_409(self):
        auth = _auth()
        invite = _make_invite(tenant_id=auth.tenant_id, status=InviteStatus.active)
        db = AsyncMock()
        db.scalar.return_value = invite

        with self.assertRaises(HTTPException) as ctx:
            await admin_routes.hard_delete_invite_link(
                link_id=invite.id,
                request=object(),
                auth=auth,
                db=db,
            )
        self.assertEqual(ctx.exception.status_code, 409)


class ValidateInviteStatusCorrectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_validate_invite_rejects_and_persists_stale_expired_row(self):
        invite = _make_invite(
            status=InviteStatus.active,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        db = AsyncMock()
        db.scalar.return_value = invite

        validated_invite, tenant = await auth_routes._validate_invite('token', db)

        self.assertIsNone(validated_invite)
        self.assertIsNone(tenant)
        self.assertEqual(invite.status, InviteStatus.expired)
        db.commit.assert_awaited_once()


class ListInviteLinksFilterTests(unittest.IsolatedAsyncioTestCase):
    async def test_terminal_filter_includes_rows_corrected_during_request(self):
        auth = _auth()
        stale_terminal = _make_invite(
            tenant_id=auth.tenant_id,
            status=InviteStatus.active,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            label='stale-expired',
            created_by_email_snapshot='creator@example.com',
        )
        still_active = _make_invite(
            tenant_id=auth.tenant_id,
            status=InviteStatus.active,
            label='still-active',
            created_by_email_snapshot='active@example.com',
        )

        execute_result = MagicMock()
        execute_result.all.return_value = [
            (stale_terminal, None),
            (still_active, None),
        ]
        db = AsyncMock()
        db.execute.return_value = execute_result

        rows = await admin_routes.list_invite_links(
            status='terminal',
            auth=auth,
            db=db,
        )

        self.assertEqual([row['label'] for row in rows], ['stale-expired'])
        self.assertEqual(rows[0]['status'], InviteStatus.expired.value)
        db.commit.assert_awaited_once()


class LazyStatusCorrectionTests(unittest.IsolatedAsyncioTestCase):
    """Phase 2 §7.2: rows still labelled ``active`` whose timer ran out
    (or whose ``max_uses`` is hit) are silently corrected on read."""

    async def test_correction_demotes_expired_active_row(self):
        invite = _make_invite(
            status=InviteStatus.active,
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        result = await invite_link_service.lazily_persist_status_corrections(
            [invite]
        )
        self.assertEqual(result[0].status, InviteStatus.expired)

    async def test_correction_demotes_exhausted_active_row(self):
        invite = _make_invite(
            status=InviteStatus.active,
            max_uses=2,
            uses_count=2,
        )
        result = await invite_link_service.lazily_persist_status_corrections(
            [invite]
        )
        self.assertEqual(result[0].status, InviteStatus.exhausted)

    async def test_correction_skips_already_terminal_rows(self):
        invite = _make_invite(
            status=InviteStatus.revoked,
            is_active=False,
            revoked_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
        result = await invite_link_service.lazily_persist_status_corrections(
            [invite]
        )
        # Stays revoked even though it's also expired by clock.
        self.assertEqual(result[0].status, InviteStatus.revoked)


class RevokeInviteStatusCorrectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_revoke_stale_expired_row_returns_409_with_correct_status(self):
        auth = _auth()
        invite = _make_invite(
            tenant_id=auth.tenant_id,
            status=InviteStatus.active,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        db = AsyncMock()
        db.scalar.return_value = invite

        with self.assertRaises(HTTPException) as ctx:
            await admin_routes.revoke_invite_link_v2(
                link_id=invite.id,
                request=object(),
                auth=auth,
                db=db,
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn('already expired', ctx.exception.detail)
        self.assertEqual(invite.status, InviteStatus.expired)
        db.commit.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
