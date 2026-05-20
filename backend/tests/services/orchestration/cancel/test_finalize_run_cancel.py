"""finalize-run-cancel: resolve connection via node config, call adapter, write audits."""
from __future__ import annotations

import uuid
from unittest.mock import patch

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.orchestration import (
    WorkflowRunCancelAudit,
    WorkflowRunRecipientAction,
)
from app.models.provider_connection import ProviderConnection
from app.services.orchestration.cancel.finalize_run_cancel import (
    run_finalize_run_cancel,
)
from app.services.orchestration.connections.crypto import encrypt


def _patched_bolna_200():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"state": "stopped"})

    transport = httpx.MockTransport(handler)
    return patch(
        "app.services.orchestration.adapters.bolna._make_client",
        return_value=httpx.AsyncClient(transport=transport),
    )


@pytest_asyncio.fixture
async def cancelled_run_with_bolna_actions(db_session, seed_full_run, monkeypatch):
    """A cancelled run whose node n1 is bound to a bolna connection, with two
    pending voice actions sharing one batch_id."""
    from cryptography.fernet import Fernet

    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_CONNECTION_KEY",
        Fernet.generate_key().decode(),
    )
    run, version, _workflow, node_step, tenant_id, app_id = seed_full_run

    conn = ProviderConnection(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        provider="bolna",
        name=f"bolna-{uuid.uuid4().hex[:8]}",
        config_encrypted=encrypt({"api_key": "tok", "base_url": "https://api.bolna.ai"}),
        active=True,
        created_by=run.triggered_by_user_id,
    )
    db_session.add(conn)

    version.definition = {
        "nodes": [
            {
                "id": node_step.node_id,
                "type": "voice.place_call",
                "config": {"connection_id": str(conn.id)},
            }
        ],
        "edges": [],
    }
    run.status = "cancelled"
    await db_session.flush()

    batch_id = f"batch-{uuid.uuid4().hex[:8]}"
    # In-flight Bolna calls: dispatch succeeded (status='success', queued at the
    # provider) but no terminal webhook yet (provider_terminal=False).
    for exec_id in ("e1", "e2"):
        db_session.add(
            WorkflowRunRecipientAction(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=run.workflow_id,
                workflow_version_id=run.workflow_version_id,
                run_id=run.id,
                node_step_id=node_step.id,
                recipient_id=f"R-{exec_id}",
                channel="voice",
                action_type="voice_queued",
                status="success",
                provider_status="queued",
                provider_terminal=False,
                idempotency_key=f"idem-{exec_id}-{uuid.uuid4().hex[:6]}",
                bolna_execution_id=exec_id,
                bolna_batch_id=batch_id,
                payload={"contact": "+919876500000"},
            )
        )
    # A call that already reached a terminal webhook must NOT be re-cancelled.
    db_session.add(
        WorkflowRunRecipientAction(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=run.workflow_id,
            workflow_version_id=run.workflow_version_id,
            run_id=run.id,
            node_step_id=node_step.id,
            recipient_id="R-done",
            channel="voice",
            action_type="voice_queued",
            status="success",
            provider_status="completed",
            provider_terminal=True,
            idempotency_key=f"idem-done-{uuid.uuid4().hex[:6]}",
            bolna_execution_id="e-done",
            bolna_batch_id=f"batch-other-{uuid.uuid4().hex[:6]}",
            payload={"contact": "+919876500001"},
        )
    )
    await db_session.flush()
    return run, tenant_id, batch_id


@pytest.mark.asyncio
async def test_writes_batch_cancel_audit_and_finalizes(
    db_session, cancelled_run_with_bolna_actions
):
    run, tenant_id, batch_id = cancelled_run_with_bolna_actions
    with _patched_bolna_200():
        await run_finalize_run_cancel(db_session, run_id=run.id, tenant_id=tenant_id)

    audits = (
        await db_session.execute(
            select(WorkflowRunCancelAudit).where(
                WorkflowRunCancelAudit.run_id == run.id
            )
        )
    ).scalars().all()
    assert len(audits) == 1  # two actions, one batch → one batch cancel
    assert audits[0].outcome == "cancelled"
    assert audits[0].batch_correlation_id == batch_id
    assert audits[0].provider_connection_id is not None

    await db_session.refresh(run)
    assert run.cancel_finalized_at is not None


@pytest.mark.asyncio
async def test_idempotent_skips_when_already_finalized(
    db_session, cancelled_run_with_bolna_actions
):
    run, tenant_id, _batch_id = cancelled_run_with_bolna_actions
    with _patched_bolna_200():
        await run_finalize_run_cancel(db_session, run_id=run.id, tenant_id=tenant_id)
        await run_finalize_run_cancel(db_session, run_id=run.id, tenant_id=tenant_id)

    audits = (
        await db_session.execute(
            select(WorkflowRunCancelAudit).where(
                WorkflowRunCancelAudit.run_id == run.id
            )
        )
    ).scalars().all()
    assert len(audits) == 1  # second call is a no-op (cancel_finalized_at guard)


@pytest.mark.asyncio
async def test_unknown_run_is_noop(db_session, seed_tenant_user_app):
    tenant_id, _user_id, _app_id = seed_tenant_user_app
    # Must not raise.
    await run_finalize_run_cancel(db_session, run_id=uuid.uuid4(), tenant_id=tenant_id)
