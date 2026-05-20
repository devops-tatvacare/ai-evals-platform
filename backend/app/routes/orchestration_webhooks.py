"""Inbound orchestration webhooks — PUBLIC routes."""
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
from app.services.orchestration.adapters import (
    AdapterNotRegisteredError,
    resolve_adapter,
)


router = APIRouter(prefix="/api/orchestration/webhooks", tags=["orchestration-webhooks"])


def _check_secret(received: str, expected: str) -> None:
    """Raises 404 (not 401) on mismatch — never reveal whether a secret exists."""
    if not expected or not secrets.compare_digest(received, expected):
        raise HTTPException(status_code=404, detail="not found")


def _resolve_tenant_for_provider() -> tuple[uuid.UUID, str]:
    try:
        tenant_id = uuid.UUID(settings.ORCHESTRATION_DEFAULT_TENANT_ID)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=500, detail="orchestration default tenant id misconfigured")
    return tenant_id, settings.ORCHESTRATION_DEFAULT_APP_ID


async def _resolve_connection_by_token(
    db: AsyncSession, *, vendor: str, token: str,
) -> tuple[uuid.UUID, str]:
    """Look up an active connection by ``(provider, webhook_token)``.

    Returns ``(tenant_id, app_id)``. Raises 404 when token is missing,
    unknown, mapped to a different vendor, or the connection is inactive.
    """
    if not token:
        raise HTTPException(status_code=404, detail="not found")
    row = await db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.webhook_token == token,
            ProviderConnection.active.is_(True),
        )
    )
    if row is None or row.provider != vendor:
        raise HTTPException(status_code=404, detail="not found")
    return row.tenant_id, row.app_id


async def _dispatch_to_adapter(
    db: AsyncSession,
    *,
    capability: str,
    vendor: str,
    token: str,
    payload: dict[str, Any],
) -> dict[str, str]:
    try:
        adapter = resolve_adapter(capability=capability, vendor=vendor)
    except AdapterNotRegisteredError:
        raise HTTPException(status_code=404, detail="not found")
    tenant_id, app_id = await _resolve_connection_by_token(db, vendor=vendor, token=token)
    await adapter.handle_webhook(
        db, tenant_id=tenant_id, app_id=app_id, payload=payload,
    )
    await db.commit()
    return {"status": "ok"}


@router.post("/messaging/{vendor}/{token}", status_code=200)
async def messaging_webhook(
    vendor: str = Path(...),
    token: str = Path(...),
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    return await _dispatch_to_adapter(
        db, capability="messaging", vendor=vendor, token=token, payload=payload,
    )


@router.post("/voice/{vendor}/{token}", status_code=200)
async def voice_webhook(
    vendor: str = Path(...),
    token: str = Path(...),
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    return await _dispatch_to_adapter(
        db, capability="voice", vendor=vendor, token=token, payload=payload,
    )


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
