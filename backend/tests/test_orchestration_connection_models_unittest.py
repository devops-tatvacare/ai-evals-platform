"""ProviderConnection ORM round-trip + uniqueness + partial-index assertions.

Live-DB via the existing ``db_session`` fixture. Each test rolls back at
teardown so test data does not persist.
"""
from __future__ import annotations

import secrets
import uuid

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models.provider_connection import ProviderConnection


@pytest.fixture(autouse=True)
def fernet_key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_CONNECTION_KEY",
        Fernet.generate_key().decode(),
    )


def _encrypted_blob() -> bytes:
    from app.services.orchestration.connections.crypto import encrypt
    return encrypt({"api_key": "abc", "base_url": "https://x", "from_phone": "+91"})


@pytest.mark.asyncio
async def test_round_trip(db_session, seed_tenant_user_app):
    tenant_id, user_id, app_id = seed_tenant_user_app
    cid = uuid.uuid4()
    db_session.add(
        ProviderConnection(
            id=cid, tenant_id=tenant_id, app_id=app_id,
            provider="bolna", name=f"bolna-{cid.hex[:8]}",
            config_encrypted=_encrypted_blob(),
            webhook_token=secrets.token_urlsafe(32),
            active=True, created_by=user_id,
        )
    )
    await db_session.flush()
    loaded = await db_session.scalar(
        select(ProviderConnection).where(ProviderConnection.id == cid)
    )
    assert loaded is not None
    assert loaded.provider == "bolna"
    assert loaded.active is True


@pytest.mark.asyncio
async def test_unique_scope_provider_name(db_session, seed_tenant_user_app):
    tenant_id, user_id, app_id = seed_tenant_user_app
    name = f"dup-{uuid.uuid4().hex[:8]}"
    db_session.add(
        ProviderConnection(
            id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
            provider="bolna", name=name,
            config_encrypted=_encrypted_blob(),
            webhook_token=secrets.token_urlsafe(32),
            active=True, created_by=user_id,
        )
    )
    await db_session.flush()
    db_session.add(
        ProviderConnection(
            id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
            provider="bolna", name=name,
            config_encrypted=_encrypted_blob(),
            webhook_token=secrets.token_urlsafe(32),
            active=True, created_by=user_id,
        )
    )
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_webhook_token_partial_unique_allows_multiple_nulls(
    db_session, seed_tenant_user_app,
):
    """Partial unique index ``WHERE webhook_token IS NOT NULL`` lets two
    LSQ-style outbound-only rows coexist with NULL tokens."""
    tenant_id, user_id, app_id = seed_tenant_user_app
    db_session.add(
        ProviderConnection(
            id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
            provider="lsq", name=f"lsq-a-{uuid.uuid4().hex[:8]}",
            config_encrypted=_encrypted_blob(),
            webhook_token=None,
            active=True, created_by=user_id,
        )
    )
    db_session.add(
        ProviderConnection(
            id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
            provider="lsq", name=f"lsq-b-{uuid.uuid4().hex[:8]}",
            config_encrypted=_encrypted_blob(),
            webhook_token=None,
            active=True, created_by=user_id,
        )
    )
    await db_session.flush()  # both NULL — should not collide


@pytest.mark.asyncio
async def test_webhook_token_unique_when_set(db_session, seed_tenant_user_app):
    tenant_id, user_id, app_id = seed_tenant_user_app
    token = secrets.token_urlsafe(32)
    db_session.add(
        ProviderConnection(
            id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
            provider="bolna", name=f"a-{uuid.uuid4().hex[:8]}",
            config_encrypted=_encrypted_blob(),
            webhook_token=token,
            active=True, created_by=user_id,
        )
    )
    await db_session.flush()
    db_session.add(
        ProviderConnection(
            id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
            provider="wati", name=f"b-{uuid.uuid4().hex[:8]}",
            config_encrypted=_encrypted_blob(),
            webhook_token=token,  # duplicate
            active=True, created_by=user_id,
        )
    )
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_partial_active_index_present(db_session):
    """Migration 0022 creates a partial index used by lookups for active
    rows. Assert the index exists so future migrations don't drop it
    silently."""
    rows = (await db_session.execute(text(
        """
        SELECT indexname FROM pg_indexes
         WHERE schemaname = 'orchestration'
           AND tablename = 'provider_connections'
        """
    ))).all()
    names = {r[0] for r in rows}
    assert "uq_provider_connections_webhook_token" in names
    assert "idx_provider_connections_tenant_app_provider_active" in names
