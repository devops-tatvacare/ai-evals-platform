"""Inbound orchestration webhooks — PUBLIC routes.

These routes intentionally OMIT ``Depends(get_auth_context)``: this repo uses
route-level auth, so omitting the dependency is the auth-allowlist mechanism.
The only authentication is a URL-segment secret compared via ``secrets.compare_digest``.

v1 resolves tenant/app from a single env-configured pair
(``ORCHESTRATION_DEFAULT_TENANT_ID`` / ``ORCHESTRATION_DEFAULT_APP_ID``) per
deployment. Multi-tenant secret→tenant lookup is a v2 feature.
"""
from __future__ import annotations

import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db


router = APIRouter(prefix="/api/orchestration/webhooks", tags=["orchestration-webhooks"])


def _check_secret(received: str, expected: str) -> None:
    """Raises 404 (not 401) on mismatch — never reveal whether a secret exists."""
    if not expected or not secrets.compare_digest(received, expected):
        raise HTTPException(status_code=404, detail="not found")


def _resolve_tenant_for_provider() -> tuple[uuid.UUID, str]:
    """v1: single tenant + app per deployment. Override per-deployment via env."""
    try:
        tenant_id = uuid.UUID(settings.ORCHESTRATION_DEFAULT_TENANT_ID)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=500, detail="orchestration default tenant id misconfigured")
    return tenant_id, settings.ORCHESTRATION_DEFAULT_APP_ID


@router.post("/wati/{secret}", status_code=200)
async def wati_webhook(
    secret: str = Path(...),
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    _check_secret(secret, settings.WATI_WEBHOOK_SECRET)
    tenant_id, app_id = _resolve_tenant_for_provider()
    from app.services.orchestration.webhook_handlers.wati import handle_wati_event
    await handle_wati_event(db, tenant_id=tenant_id, app_id=app_id, payload=payload)
    await db.commit()
    return {"status": "ok"}


@router.post("/bolna/{secret}", status_code=200)
async def bolna_webhook(
    secret: str = Path(...),
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    _check_secret(secret, settings.BOLNA_WEBHOOK_SECRET)
    tenant_id, app_id = _resolve_tenant_for_provider()
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
    # when ``LSQ_WEBHOOK_SECRET`` is unset.
    _check_secret(secret, settings.LSQ_WEBHOOK_SECRET)
    tenant_id, app_id = _resolve_tenant_for_provider()
    from app.services.orchestration.webhook_handlers.generic_event import EventPayloadContractError
    from app.services.orchestration.webhook_handlers.lsq import handle_lsq_event
    try:
        created = await handle_lsq_event(db, tenant_id=tenant_id, app_id=app_id, payload=payload)
    except EventPayloadContractError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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
        fire_event,
    )
    try:
        runs = await fire_event(
            db, tenant_id=tenant_id, app_id=app_id,
            event_name=event_name, event_payload=payload,
        )
    except EventPayloadContractError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return {
        "status": "ok",
        "runs_created": len(runs),
        "run_ids": [str(r) for r in runs],
    }
