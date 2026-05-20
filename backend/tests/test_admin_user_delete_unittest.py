import sys
import uuid
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

fake_database = ModuleType('app.database')
fake_database.get_db = None
sys.modules.setdefault('app.database', fake_database)

from app.routes.admin import delete_user_permanently


def _auth():
    return SimpleNamespace(
        is_owner=True,
        permissions=frozenset({'user:delete'}),
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
    )


def _user(*, is_system: bool, role_name: str, user_id=None):
    return SimpleNamespace(
        id=user_id or uuid.uuid4(),
        email='target@example.com',
        display_name='Target User',
        tenant_id=uuid.uuid4(),
        role=SimpleNamespace(is_system=is_system, name=role_name),
    )


class DeleteUserPermanentlyTests(unittest.IsolatedAsyncioTestCase):
    async def test_non_owner_user_is_deleted(self):
        auth = _auth()
        user = _user(is_system=False, role_name='kaira-user')
        db = AsyncMock()
        db.scalar.return_value = user

        result = await delete_user_permanently(
            user_id=user.id,
            request=None,
            auth=auth,
            db=db,
        )

        self.assertEqual(result, {"deleted": True, "id": str(user.id)})
        db.delete.assert_awaited_once_with(user)
        db.commit.assert_awaited_once()

    async def test_owner_user_cannot_be_deleted(self):
        auth = _auth()
        user = _user(is_system=True, role_name='Owner')
        db = AsyncMock()
        db.scalar.return_value = user

        with self.assertRaises(HTTPException) as ctx:
            await delete_user_permanently(
                user_id=user.id,
                request=None,
                auth=auth,
                db=db,
            )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "Cannot delete the tenant owner")
        db.delete.assert_not_awaited()
