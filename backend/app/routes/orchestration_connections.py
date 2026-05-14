"""Provider connection routes (auth-required).

Phase 10 commit 1. CRUD + test + rotate-token + schema + agent-variables.
All routes are gated on ``require_permission('orchestration:manage')``,
tenant-scoped via the resulting ``AuthContext``, and app-gated via
``ensure_registered_app_access`` against the connection's ``app_id``.

Public webhook routes (matched by per-connection ``webhook_token``) move in
commit 2 — see ``orchestration_webhooks.py``.
"""
from __future__ import annotations

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext
from app.auth.app_scope import ensure_registered_app_access
from app.auth.permissions import require_permission
from app.database import get_db
from app.models.provider_connection import ProviderConnection
from app.services.access_control import can_access
from app.schemas.orchestration_connection import (
    AgentVariablesResponse,
    ConnectionCreateRequest,
    ConnectionResponse,
    ConnectionRotateTokenResponse,
    ConnectionTestResponse,
    ConnectionUpdateRequest,
    ProviderAgentsListResponse,
    ProviderSpecResponse,
    ProviderTemplatesListResponse,
)
from app.services.orchestration.api import agents as agents_service
from app.services.orchestration.api import connections as conn_service


router = APIRouter(prefix="/api/orchestration/connections", tags=["orchestration"])


# Routes whose paths could collide with the {connection_id} pattern must be
# declared before the generic ones (FastAPI matches in declaration order).


@router.get("/schema", response_model=ProviderSpecResponse)
async def get_provider_schema(
    provider: str = Query(..., description="One of: bolna, wati, aisensy, lsq, msg91, webhook"),
    auth: AuthContext = require_permission('orchestration:manage'),
):
    """Gated on ``orchestration:manage``; ``auth`` is intentionally unused —
    the dependency exists to require the permission before exposing provider
    field shapes."""
    _ = auth
    try:
        return conn_service.get_provider_schema(provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("", response_model=ConnectionResponse, status_code=201)
async def create_connection(
    body: ConnectionCreateRequest,
    request: Request,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, body.app_id)
    base_url = conn_service.resolve_base_url(request.headers.get("origin"))
    try:
        return await conn_service.create_connection(
            db,
            tenant_id=auth.tenant_id,
            app_id=body.app_id,
            provider=body.provider,
            name=body.name,
            config=body.config,
            active=body.active,
            created_by=auth.user_id,
            visibility=body.visibility,
            base_url=base_url,
        )
    except conn_service.ConnectionInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except conn_service.ConnectionConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        # provider_specs.get_spec(unknown) lands here.
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("", response_model=list[ConnectionResponse])
async def list_connections(
    request: Request,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
    app_id: Optional[str] = Query(None, alias="appId"),
    provider: Optional[list[str]] = Query(None),
    include_inactive: bool = Query(False, alias="includeInactive"),
    visibility: Literal["all", "private", "shared"] = Query("all"),
):
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
    base_url = conn_service.resolve_base_url(request.headers.get("origin"))
    return await conn_service.list_connections(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=app_id,
        providers=provider or None,
        include_inactive=include_inactive,
        visibility=visibility,
        base_url=base_url,
    )


async def _load_and_gate_connection(
    db: AsyncSession,
    auth: AuthContext,
    connection_id: uuid.UUID,
    *,
    action: Literal["read", "edit"] = "read",
):
    row = await db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.id == connection_id,
            ProviderConnection.tenant_id == auth.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="connection not found")
    await ensure_registered_app_access(db, auth, row.app_id)
    if not can_access(auth, row, action):
        if action == "read":
            raise HTTPException(status_code=404, detail="connection not found")
        raise HTTPException(status_code=403, detail="connection is read-only")
    return row


@router.get("/{connection_id}", response_model=ConnectionResponse)
async def get_connection(
    connection_id: uuid.UUID,
    request: Request,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    row = await _load_and_gate_connection(db, auth, connection_id)
    base_url = conn_service.resolve_base_url(request.headers.get("origin"))
    return conn_service.serialize_connection(row, base_url)


@router.patch("/{connection_id}", response_model=ConnectionResponse)
async def update_connection(
    connection_id: uuid.UUID,
    body: ConnectionUpdateRequest,
    request: Request,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_connection(db, auth, connection_id, action="edit")
    base_url = conn_service.resolve_base_url(request.headers.get("origin"))
    try:
        return await conn_service.update_connection(
            db,
            tenant_id=auth.tenant_id,
            connection_id=connection_id,
            name=body.name,
            active=body.active,
            config=body.config,
            visibility=body.visibility,
            base_url=base_url,
        )
    except conn_service.ConnectionInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except conn_service.ConnectionConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except conn_service.ConnectionNotFound:
        raise HTTPException(status_code=404, detail="connection not found")


@router.delete("/{connection_id}", status_code=204)
async def archive_connection(
    connection_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_connection(db, auth, connection_id, action="edit")
    try:
        await conn_service.archive_connection(
            db, tenant_id=auth.tenant_id, connection_id=connection_id,
        )
    except conn_service.ConnectionNotFound:
        raise HTTPException(status_code=404, detail="connection not found")
    return Response(status_code=204)


@router.post("/{connection_id}/test", response_model=ConnectionTestResponse)
async def test_connection(
    connection_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_connection(db, auth, connection_id, action="edit")
    return await conn_service.test_connection(
        db, tenant_id=auth.tenant_id, connection_id=connection_id,
    )


@router.post(
    "/{connection_id}/rotate-token", response_model=ConnectionRotateTokenResponse,
)
async def rotate_webhook_token(
    connection_id: uuid.UUID,
    request: Request,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_connection(db, auth, connection_id, action="edit")
    base_url = conn_service.resolve_base_url(request.headers.get("origin"))
    try:
        return await conn_service.rotate_webhook_token(
            db,
            tenant_id=auth.tenant_id,
            connection_id=connection_id,
            base_url=base_url,
        )
    except conn_service.ConnectionInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{connection_id}/agent-variables", response_model=AgentVariablesResponse)
async def get_agent_variables(
    connection_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
    agent_id: Optional[str] = Query(None, alias="agentId"),
    template_name: Optional[str] = Query(None, alias="templateName"),
):
    await _load_and_gate_connection(db, auth, connection_id)
    return await conn_service.get_agent_variables(
        db,
        tenant_id=auth.tenant_id,
        connection_id=connection_id,
        agent_id=agent_id,
        template_name=template_name,
    )


@router.get("/{connection_id}/agents", response_model=ProviderAgentsListResponse)
async def list_connection_agents(
    connection_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
    refresh: bool = Query(False, description="Bypass the 30s cache."),
):
    """Phase 13/B.1 — Live agent listing for the Bolna picker.

    Soft-error contract: HTTP 200 even when the upstream call fails;
    the picker keeps working with manual entry while surfacing
    ``error`` inline.
    """
    row = await _load_and_gate_connection(db, auth, connection_id)
    if row.provider != "bolna":
        raise HTTPException(
            status_code=400,
            detail=f"connection {connection_id} is provider={row.provider}, expected bolna",
        )
    return await agents_service.list_connection_bolna_agents(
        db,
        tenant_id=auth.tenant_id,
        app_id=row.app_id,
        connection_id=connection_id,
        refresh=refresh,
    )


@router.get("/{connection_id}/templates", response_model=ProviderTemplatesListResponse)
async def list_connection_templates(
    connection_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
    refresh: bool = Query(False, description="Bypass the 30s cache."),
):
    """Phase 13/C.1 — Live template listing for the WATI picker.

    Same soft-error envelope as the agents endpoint.
    """
    row = await _load_and_gate_connection(db, auth, connection_id)
    if row.provider != "wati":
        raise HTTPException(
            status_code=400,
            detail=f"connection {connection_id} is provider={row.provider}, expected wati",
        )
    return await agents_service.list_connection_wati_templates(
        db,
        tenant_id=auth.tenant_id,
        app_id=row.app_id,
        connection_id=connection_id,
        refresh=refresh,
    )
