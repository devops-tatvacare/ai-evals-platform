"""Admin Sherlock parts surface: tenant-wide, admin-gated, clean user labels."""
import uuid

import pytest
from fastapi import HTTPException

from app.auth import AuthContext
from app.auth.permissions import ensure_any_permission
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.chat import ChatSession
from app.models.sherlock_runtime import SherlockPart
from app.routes.sherlock_parts import _ADMIN_VIEW_PERMS, list_parts


def _admin_auth(app_id: str) -> AuthContext:
    # A DIFFERENT user than the part owner — proves tenant-wide, not user-scoped.
    return AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=SYSTEM_TENANT_ID,
        email='admin@example.com',
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({app_id}),
    )


@pytest.mark.asyncio
async def test_list_parts_is_tenant_wide_with_clean_user_label(db_session):
    app_id = f'sw-{uuid.uuid4().hex[:8]}'
    session = ChatSession(
        tenant_id=SYSTEM_TENANT_ID, user_id=SYSTEM_USER_ID, app_id=app_id,
        server_session_id='sherlock', title='t',
    )
    db_session.add(session)
    await db_session.flush()
    db_session.add(SherlockPart(
        id=f'p-{uuid.uuid4().hex}', chat_session_id=session.id, tenant_id=SYSTEM_TENANT_ID,
        user_id=SYSTEM_USER_ID, app_id=app_id, seq=1, type='tool', call_id='call_x',
        payload={'type': 'tool', 'tool': 'submit_sql',
                 'state': {'status': 'completed', 'started_at': 100, 'ended_at': 282}},
    ))
    await db_session.commit()

    resp = await list_parts(
        app_id=None, part_type='tool', call_id=None, session_id=None,
        since=None, until=None, limit=100, offset=0,
        auth=_admin_auth(app_id), db=db_session,
    )
    rows = [r for r in resp.items if r.app_id == app_id]
    assert len(rows) == 1
    assert rows[0].user_id == str(SYSTEM_USER_ID)
    assert rows[0].user_label == 'System'  # clean name, never the uuid


def test_non_admin_is_rejected():
    viewer = AuthContext(
        user_id=uuid.uuid4(), tenant_id=SYSTEM_TENANT_ID, email='v@example.com',
        role_id=uuid.uuid4(), is_owner=False, permissions=frozenset(), app_access=frozenset(),
    )
    with pytest.raises(HTTPException) as exc:
        ensure_any_permission(viewer, *_ADMIN_VIEW_PERMS)
    assert exc.value.status_code == 403
