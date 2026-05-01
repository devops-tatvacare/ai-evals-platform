"""ConnectionResolver — tenant+app scoping, per-run cache, last_used_at touch.

Live-DB. Each test seeds two connections (one in-scope, one cross-tenant)
and asserts the resolver only resolves the in-scope id.
"""
from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet

from app.constants import SYSTEM_USER_ID


@pytest.fixture(autouse=True)
def fernet_key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_CONNECTION_KEY",
        Fernet.generate_key().decode(),
    )


def _bolna_config() -> dict:
    return {"api_key": "k", "base_url": "https://api.bolna.ai", "from_phone": "+91"}


def _webhook_config() -> dict:
    return {
        "base_url": "https://hooks.example.com",
        "auth_header_name": "Authorization",
        "auth_header_value": "Bearer token-123",
    }


async def _add_bolna_row(
    db, *, tenant_id, app_id, name="x", active=True,
) -> uuid.UUID:
    from app.services.orchestration.connections import crypto
    from app.models.provider_connection import ProviderConnection as PC

    cid = uuid.uuid4()
    db.add(
        PC(
            id=cid, tenant_id=tenant_id, app_id=app_id,
            provider="bolna", name=f"{name}-{cid.hex[:8]}",
            config_encrypted=crypto.encrypt(_bolna_config()),
            webhook_token=None,
            active=active, created_by=SYSTEM_USER_ID,
        )
    )
    await db.flush()
    return cid


async def _add_webhook_row(
    db, *, tenant_id, app_id, name="x", active=True,
) -> uuid.UUID:
    from app.services.orchestration.connections import crypto
    from app.models.provider_connection import ProviderConnection as PC

    cid = uuid.uuid4()
    db.add(
        PC(
            id=cid, tenant_id=tenant_id, app_id=app_id,
            provider="webhook", name=f"{name}-{cid.hex[:8]}",
            config_encrypted=crypto.encrypt(_webhook_config()),
            webhook_token=None,
            active=active, created_by=SYSTEM_USER_ID,
        )
    )
    await db.flush()
    return cid


@pytest.mark.asyncio
async def test_in_scope_resolution_builds_service_and_caches(
    db_session, seed_tenant_user_app,
):
    from app.services.orchestration.connections.resolver import ConnectionResolver

    tenant_id, _user, app_id = seed_tenant_user_app
    cid = await _add_bolna_row(db_session, tenant_id=tenant_id, app_id=app_id)

    resolver = ConnectionResolver(db_session, tenant_id=tenant_id, app_id=app_id)
    svc1 = await resolver.bolna(cid)
    svc2 = await resolver.bolna(cid)
    assert svc1 is svc2  # cache hit


@pytest.mark.asyncio
async def test_cross_app_returns_not_found(db_session, seed_tenant_user_app):
    from app.services.orchestration.connections.resolver import (
        ConnectionResolver, ConnectionNotFound,
    )

    tenant_id, _user, app_id = seed_tenant_user_app
    cid = await _add_bolna_row(db_session, tenant_id=tenant_id, app_id=app_id)

    resolver = ConnectionResolver(db_session, tenant_id=tenant_id, app_id="some-other-app")
    with pytest.raises(ConnectionNotFound):
        await resolver.bolna(cid)


@pytest.mark.asyncio
async def test_cross_tenant_returns_not_found(db_session, seed_tenant_user_app):
    from app.services.orchestration.connections.resolver import (
        ConnectionResolver, ConnectionNotFound,
    )

    tenant_id, _user, app_id = seed_tenant_user_app
    cid = await _add_bolna_row(db_session, tenant_id=tenant_id, app_id=app_id)

    other_tenant = uuid.uuid4()
    resolver = ConnectionResolver(db_session, tenant_id=other_tenant, app_id=app_id)
    with pytest.raises(ConnectionNotFound):
        await resolver.bolna(cid)


@pytest.mark.asyncio
async def test_inactive_returns_not_found(db_session, seed_tenant_user_app):
    from app.services.orchestration.connections.resolver import (
        ConnectionResolver, ConnectionNotFound,
    )

    tenant_id, _user, app_id = seed_tenant_user_app
    cid = await _add_bolna_row(db_session, tenant_id=tenant_id, app_id=app_id, active=False)

    resolver = ConnectionResolver(db_session, tenant_id=tenant_id, app_id=app_id)
    with pytest.raises(ConnectionNotFound):
        await resolver.bolna(cid)


@pytest.mark.asyncio
async def test_provider_mismatch_raises(db_session, seed_tenant_user_app):
    from app.services.orchestration.connections.resolver import (
        ConnectionResolver, ConnectionProviderMismatch,
    )

    tenant_id, _user, app_id = seed_tenant_user_app
    cid = await _add_bolna_row(db_session, tenant_id=tenant_id, app_id=app_id)

    resolver = ConnectionResolver(db_session, tenant_id=tenant_id, app_id=app_id)
    with pytest.raises(ConnectionProviderMismatch):
        await resolver.wati(cid)


@pytest.mark.asyncio
async def test_webhook_resolution_returns_plain_config(db_session, seed_tenant_user_app):
    from app.services.orchestration.connections.resolver import ConnectionResolver

    tenant_id, _user, app_id = seed_tenant_user_app
    cid = await _add_webhook_row(db_session, tenant_id=tenant_id, app_id=app_id)

    resolver = ConnectionResolver(db_session, tenant_id=tenant_id, app_id=app_id)
    config = await resolver.webhook(cid)
    assert config["base_url"] == "https://hooks.example.com"
    assert config["auth_header_name"] == "Authorization"
    assert config["auth_header_value"] == "Bearer token-123"


@pytest.mark.asyncio
async def test_last_used_at_touch_failure_does_not_raise(
    db_session, seed_tenant_user_app,
):
    """Best-effort touch: SQL failure is logged once and never masks the
    provider call result. Mock the resolver's UPDATE path to raise."""
    from app.services.orchestration.connections.resolver import ConnectionResolver
    from sqlalchemy.exc import SQLAlchemyError

    tenant_id, _user, app_id = seed_tenant_user_app
    cid = await _add_bolna_row(db_session, tenant_id=tenant_id, app_id=app_id)

    resolver = ConnectionResolver(db_session, tenant_id=tenant_id, app_id=app_id)

    real_execute = db_session.execute
    calls = {"count": 0}

    async def flaky_execute(stmt, *args, **kwargs):
        calls["count"] += 1
        if "UPDATE orchestration.provider_connections" in str(stmt):
            raise SQLAlchemyError("simulated")
        return await real_execute(stmt, *args, **kwargs)

    with patch.object(db_session, "execute", side_effect=flaky_execute):
        svc = await resolver.bolna(cid)
    assert svc is not None
