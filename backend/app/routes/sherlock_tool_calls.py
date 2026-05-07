"""Read-only Sherlock tool-call routes (auth-required).

Phase 15.1d — feeds the platform Logs page's Sherlock tab plus its
sub-route detail page. Two endpoints:

  - ``GET  /api/sherlock/tool-calls``        — paginated list, no payloads
  - ``GET  /api/sherlock/tool-calls/{id}``   — full row with arguments + SQL

Tenant **and** user-scoped: Sherlock sessions are per-user (the chat
handler stamps ``tenant_id`` + ``user_id`` on every row), so cross-user
reads are intentionally invisible. The list endpoint additionally filters
by ``auth.app_access`` so a tenant admin without app A's grant can't see
tool calls fired in app A's context.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.database import get_db
from app.schemas.sherlock import (
    SherlockToolCallDetail,
    SherlockToolCallListResponse,
    SherlockToolCallRow,
)
from app.services.sherlock.api import tool_calls as svc


router = APIRouter(prefix="/api/sherlock", tags=["sherlock"])


@router.get("/tool-calls", response_model=SherlockToolCallListResponse)
async def list_tool_calls(
    app_id: Optional[str] = Query(None, alias="appId"),
    tool_name: Optional[str] = Query(None, alias="toolName"),
    status: Optional[str] = None,
    session_id: Optional[str] = Query(None, alias="sessionId"),
    db_session_id: Optional[uuid.UUID] = Query(None, alias="dbSessionId"),
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    scoped_app_ids: frozenset[str] | None = frozenset(auth.app_access)
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        scoped_app_ids = None
    items, total = await svc.list_tool_calls(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_ids=scoped_app_ids,
        app_id=app_id,
        tool_name=tool_name,
        status=status,
        session_id=session_id,
        db_session_id=db_session_id,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    return SherlockToolCallListResponse(
        items=[SherlockToolCallRow.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/tool-calls/distinct-tool-names", response_model=list[str])
async def distinct_tool_names(
    app_id: Optional[str] = Query(None, alias="appId"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    scoped_app_ids: frozenset[str] | None = frozenset(auth.app_access)
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        scoped_app_ids = None
    return await svc.list_distinct_tool_names(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_ids=scoped_app_ids,
        app_id=app_id,
    )


@router.get("/tool-calls/{tool_call_id}", response_model=SherlockToolCallDetail)
async def get_tool_call(
    tool_call_id: uuid.UUID,
    app_id: Optional[str] = Query(None, alias="appId"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    scoped_app_ids: frozenset[str] | None = frozenset(auth.app_access)
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        scoped_app_ids = None
    row = await svc.get_tool_call(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        tool_call_id=tool_call_id,
        app_ids=scoped_app_ids,
        app_id=app_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="tool call not found")
    return SherlockToolCallDetail.model_validate(row)
