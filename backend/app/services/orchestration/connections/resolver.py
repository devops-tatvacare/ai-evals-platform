"""Per-run, tenant+app-scoped lookup that resolves provider connections to decrypted config."""
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
    """Tenant+app-scoped resolver with per-run config cache."""

    def __init__(self, db: AsyncSession, *, tenant_id: uuid.UUID, app_id: str):
        self._db = db
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._config_cache: dict[uuid.UUID, dict[str, Any]] = {}
        self._touched_ids: set[uuid.UUID] = set()

    async def _load(self, connection_id: uuid.UUID, expected_provider: str) -> dict[str, Any]:
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

    async def webhook(self, connection_id: uuid.UUID) -> dict[str, Any]:
        if connection_id in self._config_cache:
            return self._config_cache[connection_id]
        config = await self._load(connection_id, expected_provider="webhook")
        self._config_cache[connection_id] = config
        return config

    async def get_config(
        self, connection_id: uuid.UUID, *, expected_provider: Optional[str] = None,
    ) -> dict[str, Any]:
        """Provider-agnostic accessor — adapters call this and shape the config themselves."""
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
