"""Read-only Sherlock Part routes — replaces the legacy tool_calls trace surface."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.auth.permissions import require_any_permission
from app.database import get_db
from app.models.sherlock_runtime import SherlockPart
from app.models.user import User
from app.schemas.sherlock_parts import (
    SherlockPartListResponse,
    SherlockPartRow,
    SherlockSessionPartsResponse,
)


router = APIRouter(prefix='/api/sherlock', tags=['sherlock'])

# Mirrors the frontend ADMIN_ACCESS_PERMISSIONS gate on /admin — these tenant-wide
# trace surfaces expose every user's tool calls, so they must be admin-only.
_ADMIN_VIEW_PERMS = (
    'user:create', 'user:delete', 'user:deactivate', 'user:reset_password',
    'invite_link:manage', 'schedule:manage',
)


def _row_to_model(row: SherlockPart, user_label: str | None = None) -> SherlockPartRow:
    return SherlockPartRow(
        id=row.id,
        seq=row.seq,
        type=row.type,
        call_id=row.call_id,
        chat_session_id=str(row.chat_session_id),
        app_id=row.app_id,
        user_id=str(row.user_id),
        user_label=user_label,
        payload=row.payload,
        created_at=row.created_at,
    )


async def _user_labels(db: AsyncSession, user_ids: set) -> dict:
    """Map user_id → clean display name (falls back to email)."""
    if not user_ids:
        return {}
    rows = (await db.execute(
        select(User.id, User.display_name, User.email).where(User.id.in_(user_ids))
    )).all()
    return {uid: (name or email) for uid, name, email in rows}


@router.get('/parts', response_model=SherlockPartListResponse)
async def list_parts(
    app_id: Optional[str] = Query(None, alias='appId'),
    part_type: Optional[str] = Query(None, alias='type'),
    call_id: Optional[str] = Query(None, alias='callId'),
    session_id: Optional[uuid.UUID] = Query(None, alias='sessionId'),
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = require_any_permission(*_ADMIN_VIEW_PERMS),
    db: AsyncSession = Depends(get_db),
):
    # Tenant-wide admin trace: every user's parts in the tenant, scoped to apps
    # the admin can access. Never filters by user_id.
    scoped_app_ids: frozenset[str] | None = frozenset(auth.app_access)
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        scoped_app_ids = None

    base = select(SherlockPart).where(SherlockPart.tenant_id == auth.tenant_id)
    if scoped_app_ids is not None:
        base = base.where(SherlockPart.app_id.in_(scoped_app_ids))
    if app_id is not None:
        base = base.where(SherlockPart.app_id == app_id)
    if part_type is not None:
        base = base.where(SherlockPart.type == part_type)
    if call_id is not None:
        base = base.where(SherlockPart.call_id == call_id)
    if session_id is not None:
        base = base.where(SherlockPart.chat_session_id == session_id)
    if since is not None:
        base = base.where(SherlockPart.created_at >= since)
    if until is not None:
        base = base.where(SherlockPart.created_at < until)

    total_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(total_q)).scalar_one()

    page = base.order_by(SherlockPart.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(page)).scalars().all()
    labels = await _user_labels(db, {row.user_id for row in rows})
    return SherlockPartListResponse(
        items=[_row_to_model(row, labels.get(row.user_id)) for row in rows],
        total=int(total),
        limit=limit,
        offset=offset,
    )


@router.get('/parts/by-call/{call_id}', response_model=SherlockPartRow)
async def get_part_by_call_id(
    call_id: str,
    app_id: Optional[str] = Query(None, alias='appId'),
    auth: AuthContext = require_any_permission(*_ADMIN_VIEW_PERMS),
    db: AsyncSession = Depends(get_db),
):
    """Resolve a ToolPart by its SDK call_id — tenant-wide admin deep-link target."""
    scoped_app_ids: frozenset[str] | None = frozenset(auth.app_access)
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        scoped_app_ids = None

    stmt = select(SherlockPart).where(
        SherlockPart.tenant_id == auth.tenant_id,
        SherlockPart.call_id == call_id,
        SherlockPart.type == 'tool',
    )
    if scoped_app_ids is not None:
        stmt = stmt.where(SherlockPart.app_id.in_(scoped_app_ids))
    if app_id is not None:
        stmt = stmt.where(SherlockPart.app_id == app_id)
    stmt = stmt.order_by(SherlockPart.created_at.desc()).limit(1)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='tool part not found')
    labels = await _user_labels(db, {row.user_id})
    return _row_to_model(row, labels.get(row.user_id))


@router.get('/sessions/{session_id}/parts', response_model=SherlockSessionPartsResponse)
async def list_session_parts(
    session_id: uuid.UUID,
    app_id: Optional[str] = Query(None, alias='appId'),
    after_seq: int = Query(0, ge=0, alias='afterSeq'),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Full Part stream for one chat session — used by the chat widget on hydration."""
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)

    stmt = select(SherlockPart).where(
        SherlockPart.tenant_id == auth.tenant_id,
        SherlockPart.user_id == auth.user_id,
        SherlockPart.chat_session_id == session_id,
        SherlockPart.seq > after_seq,
    )
    if app_id is not None:
        stmt = stmt.where(SherlockPart.app_id == app_id)
    stmt = stmt.order_by(SherlockPart.seq)
    rows = (await db.execute(stmt)).scalars().all()
    last_seq = rows[-1].seq if rows else after_seq
    return SherlockSessionPartsResponse(
        session_id=str(session_id),
        last_event_seq=last_seq,
        parts=[_row_to_model(row) for row in rows],
    )
