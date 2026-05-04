"""Provider connection routes (auth-required).

Phase 10 commit 1. CRUD + test + rotate-token + schema + agent-variables.
All routes are tenant-scoped via ``Depends(get_auth_context)`` and
app-gated via ``ensure_registered_app_access`` against the connection's
``app_id``.

Public webhook routes (matched by per-connection ``webhook_token``) move in
commit 2 — see ``orchestration_webhooks.py``.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.database import get_db
from app.schemas.orchestration_connection import (
    AgentVariablesResponse,
    ConnectionCreateRequest,
    ConnectionResponse,
    ConnectionRotateTokenResponse,
    ConnectionTestResponse,
    ConnectionUpdateRequest,
    ProviderAgentsListResponse,
    ProviderSpecResponse,
)
from app.services.orchestration.api import agents as agents_service
from app.services.orchestration.api import connections as conn_service


router = APIRouter(prefix="/api/orchestration/connections", tags=["orchestration"])


# Routes whose paths could collide with the {connection_id} pattern must be
# declared before the generic ones (FastAPI matches in declaration order).


@router.get("/schema", response_model=ProviderSpecResponse)
async def get_provider_schema(
    provider: str = Query(..., description="One of: bolna, wati, aisensy, lsq, msg91, webhook"),
    auth: AuthContext = Depends(get_auth_context),
):
    """Auth-gated; ``auth`` is intentionally unused — the dependency exists
    to require a Bearer token before exposing provider field shapes."""
    _ = auth
    try:
        return conn_service.get_provider_schema(provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("", response_model=ConnectionResponse, status_code=201)
async def create_connection(
    body: ConnectionCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, body.app_id)
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
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    app_id: Optional[str] = Query(None, alias="appId"),
    provider: Optional[list[str]] = Query(None),
    include_inactive: bool = Query(False, alias="includeInactive"),
):
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
    return await conn_service.list_connections(
        db,
        tenant_id=auth.tenant_id,
        app_id=app_id,
        providers=provider or None,
        include_inactive=include_inactive,
    )


async def _load_and_gate_connection(
    db: AsyncSession, auth: AuthContext, connection_id: uuid.UUID,
):
    try:
        row = await conn_service.get_connection(
            db, tenant_id=auth.tenant_id, connection_id=connection_id,
        )
    except conn_service.ConnectionNotFound:
        raise HTTPException(status_code=404, detail="connection not found")
    await ensure_registered_app_access(db, auth, row["app_id"])
    return row


@router.get("/{connection_id}", response_model=ConnectionResponse)
async def get_connection(
    connection_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    return await _load_and_gate_connection(db, auth, connection_id)


@router.patch("/{connection_id}", response_model=ConnectionResponse)
async def update_connection(
    connection_id: uuid.UUID,
    body: ConnectionUpdateRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_connection(db, auth, connection_id)
    try:
        return await conn_service.update_connection(
            db,
            tenant_id=auth.tenant_id,
            connection_id=connection_id,
            name=body.name,
            active=body.active,
            config=body.config,
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
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_connection(db, auth, connection_id)
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
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_connection(db, auth, connection_id)
    return await conn_service.test_connection(
        db, tenant_id=auth.tenant_id, connection_id=connection_id,
    )


@router.post(
    "/{connection_id}/rotate-token", response_model=ConnectionRotateTokenResponse,
)
async def rotate_webhook_token(
    connection_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_connection(db, auth, connection_id)
    try:
        return await conn_service.rotate_webhook_token(
            db, tenant_id=auth.tenant_id, connection_id=connection_id,
        )
    except conn_service.ConnectionInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{connection_id}/agent-variables", response_model=AgentVariablesResponse)
async def get_agent_variables(
    connection_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    agent_id: Optional[str] = Query(None, alias="agentId"),
    template_slug: Optional[str] = Query(None, alias="templateSlug"),
):
    await _load_and_gate_connection(db, auth, connection_id)
    return await conn_service.get_agent_variables(
        db,
        tenant_id=auth.tenant_id,
        connection_id=connection_id,
        agent_id=agent_id,
        template_slug=template_slug,
    )


@router.get("/{connection_id}/agents", response_model=ProviderAgentsListResponse)
async def list_connection_agents(
    connection_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    refresh: bool = Query(False, description="Bypass the 30s cache."),
):
    """Phase 13/B.1 — Live agent listing for the Bolna picker.

    Soft-error contract: HTTP 200 even when the upstream call fails;
    the picker keeps working with manual entry while surfacing
    ``error`` inline.
    """
    row = await _load_and_gate_connection(db, auth, connection_id)
    if row["provider"] != "bolna":
        raise HTTPException(
            status_code=400,
            detail=f"connection {connection_id} is provider={row['provider']}, expected bolna",
        )
    return await agents_service.list_connection_bolna_agents(
        db,
        tenant_id=auth.tenant_id,
        app_id=row["app_id"],
        connection_id=connection_id,
        refresh=refresh,
    )
