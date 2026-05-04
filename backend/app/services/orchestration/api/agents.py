"""Phase 13 / B.1 — provider-agent listings backing the builder picker.

The builder needs to populate a Bolna agent dropdown without baking agent
ids into seed data (Phase 13 keystone #1). This module owns the read path:
load the connection, instantiate the provider service, fetch agents, cache
the result for 30 seconds so a single inspector session doesn't fan out
hundreds of upstream calls.

The cache lives in-process. Phase D will swap the rate-limit bucket in
front of the upstream client, but the cache itself is sufficient for the
single-replica prod topology — the moment we go multi-replica, the cache
becomes per-replica which is still safe (just slightly less efficient).
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.provider_connection import ProviderConnection
from app.services.orchestration.connections import crypto


_CACHE_TTL_SECONDS = 30.0


@dataclass(frozen=True)
class _CacheKey:
    connection_id: uuid.UUID
    bucket: str  # "bolna:agents" / "wati:templates"


@dataclass
class _CacheEntry:
    expires_at: float
    payload: list[dict[str, Any]]


_CACHE: dict[_CacheKey, _CacheEntry] = {}


def _cached(key: _CacheKey) -> Optional[list[dict[str, Any]]]:
    entry = _CACHE.get(key)
    if entry is None:
        return None
    if entry.expires_at < time.monotonic():
        _CACHE.pop(key, None)
        return None
    return entry.payload


def _store(key: _CacheKey, payload: list[dict[str, Any]]) -> None:
    _CACHE[key] = _CacheEntry(
        expires_at=time.monotonic() + _CACHE_TTL_SECONDS,
        payload=payload,
    )


def _bust(key: _CacheKey) -> None:
    _CACHE.pop(key, None)


async def _load_connection(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    connection_id: uuid.UUID,
    expected_provider: str,
) -> Optional[dict[str, Any]]:
    """Tenant + app-scoped connection load. Returns plaintext config or None.

    Mirrors the scoping used by ``ConnectionResolver`` so a misrouted
    connection (wrong tenant / wrong provider) never surfaces in the
    picker.
    """
    row = await db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.id == connection_id,
            ProviderConnection.tenant_id == tenant_id,
            ProviderConnection.app_id == app_id,
            ProviderConnection.active.is_(True),
            ProviderConnection.provider == expected_provider,
        )
    )
    if row is None:
        return None
    return crypto.decrypt(row.config_encrypted)


async def list_connection_bolna_agents(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    connection_id: uuid.UUID,
    refresh: bool = False,
) -> dict[str, Any]:
    """Return ``{provider, items, error}``. Soft-error contract per the
    connections route: HTTP stays 200 and ``error`` carries the upstream
    failure so the picker can keep working with manual entry.
    """
    key = _CacheKey(connection_id=connection_id, bucket="bolna:agents")
    if refresh:
        _bust(key)
    cached = _cached(key)
    if cached is not None:
        return {"provider": "bolna", "items": cached, "error": None}

    config = await _load_connection(
        db,
        tenant_id=tenant_id,
        app_id=app_id,
        connection_id=connection_id,
        expected_provider="bolna",
    )
    if config is None:
        return {
            "provider": "bolna",
            "items": [],
            "error": "Connection not found, archived, or not a Bolna connection.",
        }

    from app.services.orchestration.integrations.bolna import (
        BolnaService,
        BolnaServiceError,
    )

    try:
        service = BolnaService(
            base_url=str(config.get("base_url") or ""),
            api_key=str(config.get("api_key") or ""),
        )
    except ValueError as exc:
        return {"provider": "bolna", "items": [], "error": str(exc)}

    try:
        items = await service.list_agents()
    except BolnaServiceError as exc:
        return {"provider": "bolna", "items": [], "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 — soft error contract
        return {
            "provider": "bolna",
            "items": [],
            "error": f"Bolna upstream error: {exc.__class__.__name__}",
        }

    _store(key, items)
    return {"provider": "bolna", "items": items, "error": None}
