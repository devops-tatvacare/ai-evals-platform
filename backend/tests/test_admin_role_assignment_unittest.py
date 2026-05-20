import sys
import unittest
import uuid
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

fake_database = ModuleType('app.database')
fake_database.get_db = None
sys.modules.setdefault('app.database', fake_database)

from app.routes.admin import UpdateUserRequest, _resolve_tenant_role, update_user


def _auth():
    return SimpleNamespace(
        is_owner=True,
        permissions=frozenset(),
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
    )


class ResolveTenantRoleTests(unittest.IsolatedAsyncioTestCase):
    async def test_malformed_role_id_is_400_without_a_db_hit(self):
        db = AsyncMock()
        with self.assertRaises(HTTPException) as ctx:
            await _resolve_tenant_role(db, 'not-a-uuid', uuid.uuid4())
        self.assertEqual(ctx.exception.status_code, 400)
        db.scalar.assert_not_awaited()

    async def test_missing_or_cross_tenant_role_is_404(self):
        db = AsyncMock()
        db.scalar.return_value = None
        with self.assertRaises(HTTPException) as ctx:
            await _resolve_tenant_role(db, str(uuid.uuid4()), uuid.uuid4())
        self.assertEqual(ctx.exception.status_code, 404)
        db.scalar.assert_awaited_once()

    async def test_in_tenant_role_is_returned(self):
        role = SimpleNamespace(id=uuid.uuid4())
        db = AsyncMock()
        db.scalar.return_value = role
        self.assertIs(await _resolve_tenant_role(db, str(role.id), uuid.uuid4()), role)


class UpdateUserRoleValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_update_user_rejects_malformed_role_id_with_400(self):
        db = AsyncMock()
        db.scalar.return_value = SimpleNamespace(
            id=uuid.uuid4(), role_id=uuid.uuid4(), display_name='X', is_active=True,
        )
        with self.assertRaises(HTTPException) as ctx:
            await update_user(
                user_id=uuid.uuid4(),
                body=UpdateUserRequest(roleId='not-a-uuid'),
                request=None,
                auth=_auth(),
                db=db,
            )
        self.assertEqual(ctx.exception.status_code, 400)
