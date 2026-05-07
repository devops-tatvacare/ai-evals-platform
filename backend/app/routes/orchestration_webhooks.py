"""Inbound orchestration webhooks — PUBLIC routes.

These routes intentionally OMIT ``Depends(get_auth_context)``: this repo uses
route-level auth, so omitting the dependency is the auth-allowlist mechanism.

Phase 10 commit 2 routes inbound provider callbacks (Bolna voice, WATI
WhatsApp) per-connection: the trailing URL segment is the
``orchestration.provider_connections.webhook_token`` for an active row,
which carries its own ``tenant_id`` + ``app_id``. Revoking the
connection (``active=False``) makes the URL dead instantly. Unknown
tokens fail closed with 404.

LSQ does not issue per-connection callbacks — its webhook is for inbound
event ingest, not status callbacks — and ``provider_specs`` marks
``supports_webhook=False`` for LSQ. The LSQ + generic event routes
therefore continue to authenticate via the original env-shared secret +
``ORCHESTRATION_DEFAULT_TENANT_ID`` resolver.
"""
from __future__ import annotations

import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.provider_connection import ProviderConnection


router = APIRouter(prefix="/api/orchestration/webhooks", tags=["orchestration-webhooks"])


def _check_secret(received: str, expected: str) -> None:
    """Raises 404 (not 401) on mismatch — never reveal whether a secret exists."""
    if not expected or not secrets.compare_digest(received, expected):
        raise HTTPException(status_code=404, detail="not found")


def _resolve_tenant_for_provider() -> tuple[uuid.UUID, str]:
    """Env-secret fallback used by LSQ + generic-event webhooks (no per-connection token)."""
    try:
        tenant_id = uuid.UUID(settings.ORCHESTRATION_DEFAULT_TENANT_ID)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=500, detail="orchestration default tenant id misconfigured")
    return tenant_id, settings.ORCHESTRATION_DEFAULT_APP_ID


async def _resolve_connection_by_token(
    db: AsyncSession, *, provider: str, token: str,
) -> tuple[uuid.UUID, str]:
    """Look up an active connection by ``(provider, webhook_token)``.

    Returns ``(tenant_id, app_id)`` on success. Raises 404 when the
    token is missing, unknown, mapped to a different provider, or the
    connection is inactive.
    """
    if not token:
        raise HTTPException(status_code=404, detail="not found")
    row = await db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.webhook_token == token,
            ProviderConnection.active.is_(True),
        )
    )
    if row is None or row.provider != provider:
        raise HTTPException(status_code=404, detail="not found")
    return row.tenant_id, row.app_id


@router.post("/wati/{token}", status_code=200)
async def wati_webhook(
    token: str = Path(...),
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    tenant_id, app_id = await _resolve_connection_by_token(db, provider="wati", token=token)
    from app.services.orchestration.webhook_handlers.wati import handle_wati_event
    await handle_wati_event(db, tenant_id=tenant_id, app_id=app_id, payload=payload)
    await db.commit()
    return {"status": "ok"}


@router.post("/bolna/{token}", status_code=200)
async def bolna_webhook(
    token: str = Path(...),
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    tenant_id, app_id = await _resolve_connection_by_token(db, provider="bolna", token=token)
    from app.services.orchestration.webhook_handlers.bolna import handle_bolna_event
    await handle_bolna_event(db, tenant_id=tenant_id, app_id=app_id, payload=payload)
    await db.commit()
    return {"status": "ok"}


@router.post("/lsq/{secret}", status_code=200)
async def lsq_webhook(
    secret: str = Path(...),
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # LSQ has its OWN secret. Do not fall back to WATI_WEBHOOK_SECRET — that
    # would let anyone holding the WATI secret hit the LSQ trust boundary
    # and trigger LSQ-event workflows. ``_check_secret`` fails closed (404)
    # when ``LSQ_WEBHOOK_SECRET`` is unset. LSQ is intentionally NOT
    # per-connection — provider_specs marks supports_webhook=False.
    _check_secret(secret, settings.LSQ_WEBHOOK_SECRET)
    tenant_id, app_id = _resolve_tenant_for_provider()
    from app.services.orchestration.webhook_handlers.generic_event import (
        EventPayloadContractError,
        EventTriggerConfigurationError,
    )
    from app.services.orchestration.webhook_handlers.lsq import handle_lsq_event
    try:
        created = await handle_lsq_event(db, tenant_id=tenant_id, app_id=app_id, payload=payload)
    except EventPayloadContractError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except EventTriggerConfigurationError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return {"status": "ok", "runs_created": len(created)}


@router.post("/event/{event_name}/{secret}", status_code=200)
async def generic_event_webhook(
    event_name: str = Path(...),
    secret: str = Path(...),
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _check_secret(secret, settings.ORCHESTRATION_EVENT_WEBHOOK_SECRET)
    tenant_id, app_id = _resolve_tenant_for_provider()
    from app.services.orchestration.webhook_handlers.generic_event import (
        EventPayloadContractError,
        EventTriggerConfigurationError,
        fire_event,
    )
    try:
        runs = await fire_event(
            db, tenant_id=tenant_id, app_id=app_id,
            event_name=event_name, event_payload=payload,
        )
    except EventPayloadContractError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except EventTriggerConfigurationError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return {
        "status": "ok",
        "runs_created": len(runs),
        "run_ids": [str(r) for r in runs],
    }
