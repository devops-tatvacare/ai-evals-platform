"""Read-only service for ``analytics.log_sherlock_tool_call``.

Powers ``GET /api/sherlock/tool-calls`` and ``GET /api/sherlock/tool-calls/{id}``
(Phase 15.1d — platform Logs page Sherlock tab). All queries are
tenant + user scoped; Sherlock sessions are per-user, so cross-user reads
inside the same tenant are intentionally blocked.

The list endpoint omits heavy JSONB / SQL payloads to keep the response
small; the detail endpoint returns the full row.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_log import LogSherlockToolCall


def _summarize_args(arguments: Optional[dict[str, Any]]) -> Optional[str]:
    """Top-level keys joined by ', ' — a glanceable hint without exposing
    the payload. Returns None for null / empty / non-dict values so the FE
    can render an em-dash."""
    if not isinstance(arguments, dict) or not arguments:
        return None
    keys = list(arguments.keys())[:8]
    return ", ".join(keys)


async def list_tool_calls(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_ids: Optional[frozenset[str]] = None,
    app_id: Optional[str] = None,
    tool_name: Optional[str] = None,
    status: Optional[str] = None,
    session_id: Optional[str] = None,
    db_session_id: Optional[uuid.UUID] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """Tenant + user-scoped tool-call log. Returns ``(items, total)``.

    ``app_ids`` is the caller's ``auth.app_access`` set; pass ``None`` to
    skip the app gate (we don't expose that path to the public route — it's
    a service-internal escape hatch).
    """
    base = select(
        LogSherlockToolCall.id,
        LogSherlockToolCall.session_id,
        LogSherlockToolCall.db_session_id,
        LogSherlockToolCall.app_id,
        LogSherlockToolCall.tool_name,
        LogSherlockToolCall.status,
        LogSherlockToolCall.error_message,
        LogSherlockToolCall.execution_ms,
        LogSherlockToolCall.row_count,
        LogSherlockToolCall.llm_model,
        LogSherlockToolCall.cache_hit,
        LogSherlockToolCall.arguments,
        LogSherlockToolCall.created_at,
    ).where(
        LogSherlockToolCall.tenant_id == tenant_id,
        LogSherlockToolCall.user_id == user_id,
    )

    if app_ids is not None:
        if not app_ids:
            return [], 0
        base = base.where(LogSherlockToolCall.app_id.in_(app_ids))
    if app_id is not None:
        base = base.where(LogSherlockToolCall.app_id == app_id)
    if tool_name:
        base = base.where(LogSherlockToolCall.tool_name == tool_name)
    if status:
        base = base.where(LogSherlockToolCall.status == status)
    if session_id:
        base = base.where(LogSherlockToolCall.session_id == session_id)
    if db_session_id is not None:
        base = base.where(LogSherlockToolCall.db_session_id == db_session_id)
    if since is not None:
        base = base.where(LogSherlockToolCall.created_at >= since)
    if until is not None:
        base = base.where(LogSherlockToolCall.created_at < until)

    total = (await db.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar_one()

    page = base.order_by(LogSherlockToolCall.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(page)).all()
    items = [
        {
            "id": r.id,
            "session_id": r.session_id,
            "db_session_id": r.db_session_id,
            "app_id": r.app_id,
            "tool_name": r.tool_name,
            "status": r.status,
            "error_message": r.error_message,
            "execution_ms": r.execution_ms,
            "row_count": r.row_count,
            "llm_model": r.llm_model,
            "cache_hit": r.cache_hit,
            "args_summary": _summarize_args(r.arguments),
            "created_at": r.created_at,
        }
        for r in rows
    ]
    return items, int(total)


async def get_tool_call(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    tool_call_id: uuid.UUID,
    app_ids: Optional[frozenset[str]] = None,
    app_id: Optional[str] = None,
) -> Optional[LogSherlockToolCall]:
    """Single-row fetch for the sub-route detail page.

    Returns ``None`` if the row doesn't exist OR doesn't belong to the
    caller's tenant + user (so a leaked id from another user surfaces as
    a 404, not a 403). When ``app_ids`` is supplied, the row's ``app_id``
    must also be in the set.
    """
    stmt = select(LogSherlockToolCall).where(
        LogSherlockToolCall.id == tool_call_id,
        LogSherlockToolCall.tenant_id == tenant_id,
        LogSherlockToolCall.user_id == user_id,
    )
    if app_ids is not None:
        if not app_ids:
            return None
        stmt = stmt.where(LogSherlockToolCall.app_id.in_(app_ids))
    if app_id is not None:
        stmt = stmt.where(LogSherlockToolCall.app_id == app_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def list_distinct_tool_names(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_ids: Optional[frozenset[str]] = None,
    app_id: Optional[str] = None,
) -> list[str]:
    """Distinct tool names the caller has invoked. Powers the Sherlock tab
    tool-name Combobox so the list is grounded in real data instead of a
    hand-maintained constant."""
    stmt = select(LogSherlockToolCall.tool_name).where(
        LogSherlockToolCall.tenant_id == tenant_id,
        LogSherlockToolCall.user_id == user_id,
    )
    if app_ids is not None:
        if not app_ids:
            return []
        stmt = stmt.where(LogSherlockToolCall.app_id.in_(app_ids))
    if app_id is not None:
        stmt = stmt.where(LogSherlockToolCall.app_id == app_id)
    stmt = stmt.distinct().order_by(LogSherlockToolCall.tool_name.asc())
    return [r[0] for r in (await db.execute(stmt)).all()]
