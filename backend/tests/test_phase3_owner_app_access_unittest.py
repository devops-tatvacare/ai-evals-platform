"""Phase 3 regression — Owner users get truthful ``app_access`` at
auth-load time, and seeding grants Owner a ``role_app_access`` row per
active app. ``ScopeGuard`` keeps a single source of truth
(``auth.app_access``) with no Owner-only bypass.
"""
from __future__ import annotations

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from app.auth.permissions import load_role_permissions


class _ScalarOneOrNoneResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _ScalarsAllResult:
    """Mimic SQLAlchemy's ``execute`` -> ``scalars().all()`` chain."""

    def __init__(self, values):
        self._values = list(values)

    def scalars(self):
        return self

    def all(self):
        return list(self._values)


class _AllResult:
    """Mimic SQLAlchemy's ``execute`` -> ``all()`` (no ``scalars()`` wrap)."""

    def __init__(self, values):
        self._values = list(values)

    def all(self):
        return list(self._values)


class LoadRolePermissionsOwnerExpansion(unittest.IsolatedAsyncioTestCase):
    """``load_role_permissions`` expands Owner app_access to every active
    app. Non-owner roles are untouched — they only carry the app slugs
    explicitly granted via ``role_app_access``."""

    async def test_owner_role_app_slugs_include_every_active_app(self):
        role_id = uuid.uuid4()
        owner_role = SimpleNamespace(
            id=role_id,
            name='Owner',
            is_system=True,
            permissions=[],
            app_access=[
                # A pre-existing grant; Owner must still cover every active
                # app even if its ``role_app_access`` rows are a subset.
                SimpleNamespace(app=SimpleNamespace(slug='kaira-bot')),
            ],
        )

        db = AsyncMock()
        db.execute.side_effect = [
            _ScalarOneOrNoneResult(owner_role),
            # Active apps query returns three slugs.
            _ScalarsAllResult(['kaira-bot', 'voice-rx', 'inside-sales']),
        ]

        role, perms, app_slugs = await load_role_permissions(db, role_id)

        self.assertIs(role, owner_role)
        self.assertEqual(perms, [])
        # Owner sees every active app, with the existing grant preserved.
        self.assertEqual(
            sorted(app_slugs),
            ['inside-sales', 'kaira-bot', 'voice-rx'],
        )
        # Two queries were issued: one for the role, one for active apps.
        self.assertEqual(db.execute.await_count, 2)

    async def test_non_owner_role_app_slugs_are_exactly_the_grants(self):
        role_id = uuid.uuid4()
        role = SimpleNamespace(
            id=role_id,
            name='Analyst',
            is_system=False,
            permissions=[SimpleNamespace(permission='reports:read')],
            app_access=[
                SimpleNamespace(app=SimpleNamespace(slug='kaira-bot')),
            ],
        )

        db = AsyncMock()
        db.execute.side_effect = [_ScalarOneOrNoneResult(role)]

        _role, perms, app_slugs = await load_role_permissions(db, role_id)

        self.assertEqual(perms, ['reports:read'])
        self.assertEqual(list(app_slugs), ['kaira-bot'])
        # Non-owner: no active-apps lookup.
        self.assertEqual(db.execute.await_count, 1)

    async def test_system_role_named_other_than_owner_does_not_expand(self):
        """Safety: only the ``is_system and name == 'Owner'`` tuple triggers
        the expansion. A hypothetical other system role must be treated like
        any other grant-based role."""
        role_id = uuid.uuid4()
        role = SimpleNamespace(
            id=role_id,
            name='AuditorBot',
            is_system=True,
            permissions=[],
            app_access=[
                SimpleNamespace(app=SimpleNamespace(slug='kaira-bot')),
            ],
        )

        db = AsyncMock()
        db.execute.side_effect = [_ScalarOneOrNoneResult(role)]

        _role, _perms, app_slugs = await load_role_permissions(db, role_id)

        self.assertEqual(list(app_slugs), ['kaira-bot'])
        self.assertEqual(db.execute.await_count, 1)


class SeedOwnerRoleAppAccessBackfill(unittest.IsolatedAsyncioTestCase):
    """``seed_owner_role`` creates the Owner role AND backfills
    ``role_app_access`` rows for every active app. Idempotent across
    re-runs."""

    async def _drive_seed_owner_role(
        self,
        *,
        existing_role,
        active_app_ids,
        existing_grants,
    ):
        from app.services.seed_defaults import seed_owner_role

        session = AsyncMock()
        session.add = Mock()

        new_role_id = uuid.uuid4()

        async def _flush():
            if session.add.called:
                last_added = session.add.call_args.args[0]
                # If the AccessRole object was just added, assign it an id.
                if getattr(last_added, 'id', None) is None and hasattr(last_added, 'name'):
                    last_added.id = new_role_id

        session.flush.side_effect = _flush

        session.execute.side_effect = [
            _ScalarOneOrNoneResult(existing_role),
            _AllResult([(app_id,) for app_id in active_app_ids]),
            _AllResult([(grant,) for grant in existing_grants]),
        ]

        role_id = await seed_owner_role(session, uuid.uuid4())
        return session, role_id, new_role_id

    async def test_seed_owner_role_creates_role_and_grants_every_active_app(self):
        active_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
        session, role_id, new_role_id = await self._drive_seed_owner_role(
            existing_role=None,
            active_app_ids=active_ids,
            existing_grants=[],
        )

        # Owner role was created plus three AccessRoleApplicationGrant rows.
        added = [call.args[0] for call in session.add.call_args_list]
        roles = [obj for obj in added if getattr(obj, 'name', None) == 'Owner']
        grants = [obj for obj in added if hasattr(obj, 'app_id')]
        self.assertEqual(len(roles), 1)
        self.assertEqual(
            sorted(g.app_id for g in grants),
            sorted(active_ids),
        )
        self.assertEqual(role_id, new_role_id)

    async def test_seed_owner_role_is_idempotent_when_grants_already_exist(self):
        existing_role = SimpleNamespace(
            id=uuid.uuid4(),
            name='Owner',
            is_system=True,
        )
        active_ids = [uuid.uuid4(), uuid.uuid4()]
        session, role_id, _ = await self._drive_seed_owner_role(
            existing_role=existing_role,
            active_app_ids=active_ids,
            # Every active app is already granted.
            existing_grants=active_ids,
        )

        # AccessRole reused, no new AccessRoleApplicationGrant row added.
        self.assertEqual(role_id, existing_role.id)
        added_grants = [
            call.args[0]
            for call in session.add.call_args_list
            if hasattr(call.args[0], 'app_id')
        ]
        self.assertEqual(added_grants, [])

    async def test_seed_owner_role_only_adds_missing_grants(self):
        existing_role = SimpleNamespace(
            id=uuid.uuid4(),
            name='Owner',
            is_system=True,
        )
        already, missing = uuid.uuid4(), uuid.uuid4()
        session, _, _ = await self._drive_seed_owner_role(
            existing_role=existing_role,
            active_app_ids=[already, missing],
            existing_grants=[already],
        )

        added_grants = [
            call.args[0]
            for call in session.add.call_args_list
            if hasattr(call.args[0], 'app_id')
        ]
        self.assertEqual([g.app_id for g in added_grants], [missing])


if __name__ == '__main__':
    unittest.main()
