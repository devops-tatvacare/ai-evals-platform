"""Per-run, tenant+app-scoped lookup that builds provider services.

A ``ConnectionResolver`` is constructed once per workflow run and passed
into ``NodeContext.connections``. Handlers call e.g.
``await ctx.connections.bolna(id)`` to materialize a service from the
encrypted config (Phase 10 commit 2 wires every CRM node through this).

Cache key is ``connection_id``; cache lifetime is the run. Cross-tenant
or cross-app rows are filtered out at SQL time and surface as
``ConnectionNotFound`` (HTTP 404 in the route layer).

``last_used_at`` is touched best-effort; failures are logged once and
never mask the provider call result (per phase-10 §1.3).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.provider_connection import ProviderConnection
from app.services.orchestration.connections.crypto import decrypt


_log = logging.getLogger(__name__)


class ConnectionNotFound(LookupError):
    """Raised when a connection_id is missing, inactive, or out-of-tenant/app scope."""


class ConnectionProviderMismatch(ValueError):
    """Raised when a connection is loaded with the wrong provider."""


class ConnectionResolver:
    """Tenant+app-scoped resolver with per-run service cache.

    Stateful instance — do not share across runs (cache is unbounded within
    the resolver's lifetime). Build one per node-context construction.
    """

    def __init__(self, db: AsyncSession, *, tenant_id: uuid.UUID, app_id: str):
        self._db = db
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._service_cache: dict[uuid.UUID, Any] = {}
        self._touched_ids: set[uuid.UUID] = set()

    async def _load(self, connection_id: uuid.UUID, expected_provider: str) -> dict[str, Any]:
        """SELECT + decrypt + last_used_at touch. Returns the plaintext config dict."""
        row = await self._db.scalar(
            select(ProviderConnection).where(
                ProviderConnection.id == connection_id,
                ProviderConnection.tenant_id == self._tenant_id,
                ProviderConnection.app_id == self._app_id,
                ProviderConnection.active.is_(True),
            )
        )
        if row is None:
            raise ConnectionNotFound(
                f"connection {connection_id} not found for tenant/app scope"
            )
        if row.provider != expected_provider:
            raise ConnectionProviderMismatch(
                f"connection {connection_id} has provider={row.provider!r}, "
                f"expected {expected_provider!r}"
            )
        config = decrypt(row.config_encrypted)
        await self._touch_last_used(connection_id)
        return config

    async def _touch_last_used(self, connection_id: uuid.UUID) -> None:
        """Best-effort. Log once per id per run on failure; never raise."""
        if connection_id in self._touched_ids:
            return
        self._touched_ids.add(connection_id)
        try:
            await self._db.execute(
                update(ProviderConnection)
                .where(ProviderConnection.id == connection_id)
                .values(last_used_at=datetime.now(timezone.utc))
            )
        except SQLAlchemyError as exc:  # pragma: no cover — best-effort
            _log.warning(
                "orchestration.connections.touch_last_used.failed connection_id=%s err=%s",
                connection_id, exc,
            )

    async def bolna(self, connection_id: uuid.UUID) -> Any:
        if connection_id in self._service_cache:
            return self._service_cache[connection_id]
        config = await self._load(connection_id, expected_provider="bolna")
        from app.services.orchestration.integrations.bolna import BolnaService
        svc = BolnaService(
            base_url=config["base_url"],
            api_key=config["api_key"],
        )
        self._service_cache[connection_id] = svc
        return svc

    async def wati(self, connection_id: uuid.UUID) -> Any:
        if connection_id in self._service_cache:
            return self._service_cache[connection_id]
        config = await self._load(connection_id, expected_provider="wati")
        from app.services.orchestration.integrations.wati import WatiService
        svc = WatiService(
            base_url=config["base_url"],
            wati_tenant_id=config["wati_tenant_id"],
            api_token=config["api_token"],
        )
        self._service_cache[connection_id] = svc
        return svc

    async def lsq(self, connection_id: uuid.UUID) -> Any:
        """Build an ``LsqWriter`` bound to the connection's per-tenant
        credentials (Phase 10 commit 2). Cached per-run."""
        if connection_id in self._service_cache:
            return self._service_cache[connection_id]
        config = await self._load(connection_id, expected_provider="lsq")
        from app.services.orchestration.integrations.lsq import LsqWriter
        svc = LsqWriter.with_config(config)
        self._service_cache[connection_id] = svc
        return svc

    async def aisensy(self, connection_id: uuid.UUID) -> dict[str, Any]:
        """AiSensy has no shared service class yet (commit 2 introduces one
        with WATI / AiSensy split). For now expose the decrypted config."""
        if connection_id in self._service_cache:
            return self._service_cache[connection_id]
        config = await self._load(connection_id, expected_provider="aisensy")
        self._service_cache[connection_id] = config
        return config

    async def msg91(self, connection_id: uuid.UUID) -> dict[str, Any]:
        if connection_id in self._service_cache:
            return self._service_cache[connection_id]
        config = await self._load(connection_id, expected_provider="msg91")
        self._service_cache[connection_id] = config
        return config

    async def webhook(self, connection_id: uuid.UUID) -> dict[str, Any]:
        if connection_id in self._service_cache:
            return self._service_cache[connection_id]
        config = await self._load(connection_id, expected_provider="webhook")
        self._service_cache[connection_id] = config
        return config

    async def get_config(
        self, connection_id: uuid.UUID, *, expected_provider: Optional[str] = None,
    ) -> dict[str, Any]:
        """Provider-agnostic accessor. Used by the SMS node which can bind to
        either aisensy or msg91 — the handler reads ``provider`` off the row
        before deciding how to dispatch."""
        row = await self._db.scalar(
            select(ProviderConnection).where(
                ProviderConnection.id == connection_id,
                ProviderConnection.tenant_id == self._tenant_id,
                ProviderConnection.app_id == self._app_id,
                ProviderConnection.active.is_(True),
            )
        )
        if row is None:
            raise ConnectionNotFound(
                f"connection {connection_id} not found for tenant/app scope"
            )
        if expected_provider is not None and row.provider != expected_provider:
            raise ConnectionProviderMismatch(
                f"connection {connection_id} has provider={row.provider!r}, "
                f"expected {expected_provider!r}"
            )
        config = decrypt(row.config_encrypted)
        config["__provider__"] = row.provider
        await self._touch_last_used(connection_id)
        return config
