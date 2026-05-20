"""Per-connection webhook routing tests (Phase 10 commit 2).

Covers: happy path with a valid token, revoked (active=false) → 404,
unknown token → 404, cross-provider token mismatch → 404, and the
LSQ + generic-event routes still authenticate via env secret because
LSQ has supports_webhook=False in provider_specs.
"""
from __future__ import annotations

import secrets as _secrets
import uuid

import httpx
import pytest
from cryptography.fernet import Fernet

from app.constants import SYSTEM_USER_ID
from app.database import get_db
from app.main import app
from app.models.provider_connection import ProviderConnection
from app.models.orchestration import WorkflowRunRecipientAction


@pytest.fixture(autouse=True)
def fernet_key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_CONNECTION_KEY",
        Fernet.generate_key().decode(),
    )


def _override_db_with_session(db_session):
    async def _override():
        yield db_session
    app.dependency_overrides[get_db] = _override
    db_session.commit = db_session.flush  # type: ignore[assignment]


async def _add_connection(
    db, *, tenant_id, app_id, provider, token, active=True, name_hint="x",
) -> uuid.UUID:
    from app.services.orchestration.connections import crypto

    if provider == "wati":
        config = {"base_url": "https://w", "wati_tenant_id": "1", "api_token": "t"}
    elif provider == "bolna":
        config = {"api_key": "k", "base_url": "https://api.bolna.ai", "from_phone": "+91"}
    else:
        config = {"api_key": "k"}

    cid = uuid.uuid4()
    db.add(
        ProviderConnection(
            id=cid, tenant_id=tenant_id, app_id=app_id,
            provider=provider, name=f"{name_hint}-{cid.hex[:8]}",
            config_encrypted=crypto.encrypt(config),
            webhook_token=token, active=active,
            created_by=SYSTEM_USER_ID,
        )
    )
    await db.flush()
    return cid


@pytest.mark.asyncio
async def test_wati_webhook_with_valid_connection_token_dispatches(
    db_session, seed_full_run,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    token = _secrets.token_urlsafe(16)
    await _add_connection(
        db_session, tenant_id=tenant_id, app_id=app_id,
        provider="wati", token=token,
    )

    local_msg_id = f"lm-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, recipient_id="L-tok",
        channel="wati", action_type="wa_dispatched", status="success",
        idempotency_key=f"k-{uuid.uuid4().hex[:8]}",
        payload={}, response={"localMessageId": local_msg_id},
    ))
    await db_session.flush()

    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/api/orchestration/webhooks/wati/{token}",
                json={"eventType": "sentMessageDELIVERED_v2", "localMessageId": local_msg_id},
            )
        assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_wati_webhook_revoked_connection_returns_404(
    db_session, seed_tenant_user_app,
):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    token = _secrets.token_urlsafe(16)
    await _add_connection(
        db_session, tenant_id=tenant_id, app_id=app_id,
        provider="wati", token=token, active=False,
    )

    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/api/orchestration/webhooks/wati/{token}", json={},
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_wati_webhook_unknown_token_returns_404(db_session):
    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/api/orchestration/webhooks/wati/{_secrets.token_urlsafe(16)}",
                json={},
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_wati_webhook_rejects_token_from_other_provider(
    db_session, seed_tenant_user_app,
):
    """A bolna connection's token must NOT authenticate the wati route."""
    tenant_id, _user_id, app_id = seed_tenant_user_app
    token = _secrets.token_urlsafe(16)
    await _add_connection(
        db_session, tenant_id=tenant_id, app_id=app_id,
        provider="bolna", token=token,
    )

    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/api/orchestration/webhooks/wati/{token}", json={},
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_bolna_webhook_with_valid_connection_token_accepts(
    db_session, seed_full_run,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    token = _secrets.token_urlsafe(16)
    await _add_connection(
        db_session, tenant_id=tenant_id, app_id=app_id,
        provider="bolna", token=token,
    )

    # Pre-existing voice_queued action so the webhook handler has a row to flip.
    db_session.add(WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, recipient_id="L-bolna",
        channel="voice", action_type="voice_queued", status="success",
        idempotency_key=f"k-{uuid.uuid4().hex[:8]}",
        payload={}, response={"execution_id": "ex-1"},
    ))
    await db_session.flush()

    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/api/orchestration/webhooks/bolna/{token}",
                json={"execution_id": "ex-1", "status": "completed"},
            )
        # Status 200 even if handler doesn't find a matching execution — what
        # we're verifying here is that the per-connection token successfully
        # authenticates and the route does not 404.
        assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_lsq_webhook_still_uses_env_secret(db_session, seed_full_run, monkeypatch):
    """LSQ has supports_webhook=False; route still uses env-shared secret."""
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_DEFAULT_TENANT_ID", str(tenant_id),
    )
    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_DEFAULT_APP_ID", app_id,
    )
    monkeypatch.setattr("app.config.settings.LSQ_WEBHOOK_SECRET", "shh")

    _override_db_with_session(db_session)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            # Wrong secret → 404 (closed by _check_secret).
            r1 = await client.post(
                "/api/orchestration/webhooks/lsq/wrong", json={},
            )
            assert r1.status_code == 404
            # Correct secret + missing lead identifier → 400 (route reached).
            r2 = await client.post(
                "/api/orchestration/webhooks/lsq/shh", json={"foo": "bar"},
            )
            assert r2.status_code == 400
    finally:
        app.dependency_overrides.pop(get_db, None)
