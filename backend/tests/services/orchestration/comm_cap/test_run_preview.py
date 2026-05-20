"""run_cap_preview: walks the frozen manifest, pre-flips capped state rows."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select, text

from app.models.comm_cap_policy import CommCapPolicy
from app.models.orchestration import (
    WorkflowRunRecipient,
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.run_preview import run_cap_preview


def _add_manifest(db_session, *, run, tenant_id, app_id, recipient_id, phone):
    db_session.add(
        WorkflowRunRecipient(
            run_id=run.id,
            tenant_id=tenant_id,
            app_id=app_id,
            recipient_id=recipient_id,
            phone_e164=phone,
            predicate_hash="0" * 64,
        )
    )
    db_session.add(
        WorkflowRunRecipientState(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=run.workflow_id,
            workflow_version_id=run.workflow_version_id,
            run_id=run.id,
            recipient_id=recipient_id,
            status="pending",
            payload={"contact": phone},
        )
    )


async def _seed_aged_action(
    db_session, *, run, node_step, tenant_id, app_id, phone, offset_seconds
):
    action_id = uuid.uuid4()
    db_session.add(
        WorkflowRunRecipientAction(
            id=action_id,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=run.workflow_id,
            workflow_version_id=run.workflow_version_id,
            run_id=run.id,
            node_step_id=node_step.id,
            recipient_id=f"R-{uuid.uuid4().hex[:8]}",
            channel="whatsapp",
            action_type="messaging.send_whatsapp_template",
            status="success",
            idempotency_key=f"idem-{uuid.uuid4().hex[:8]}",
            payload={"contact": phone},
        )
    )
    await db_session.flush()
    await db_session.execute(
        text(
            "UPDATE orchestration.workflow_run_recipient_actions "
            "SET created_at = now() + make_interval(secs => :offset) "
            "WHERE id = :id"
        ),
        {"offset": offset_seconds, "id": action_id},
    )
    await db_session.flush()


@pytest_asyncio.fixture
async def seeded_run(db_session, seed_full_run):
    run, _version, _workflow, node_step, tenant_id, app_id = seed_full_run
    return run, node_step, tenant_id, app_id


@pytest.mark.asyncio
async def test_no_policy_returns_zero(db_session, seeded_run):
    run, _node_step, tenant_id, app_id = seeded_run
    _add_manifest(
        db_session,
        run=run,
        tenant_id=tenant_id,
        app_id=app_id,
        recipient_id="R1",
        phone="+919876543210",
    )
    await db_session.flush()
    assert await run_cap_preview(db_session, run=run) == 0


@pytest.mark.asyncio
async def test_empty_manifest_returns_zero(db_session, seeded_run):
    run, _node_step, tenant_id, app_id = seeded_run
    db_session.add(
        CommCapPolicy(
            tenant_id=tenant_id, app_id=app_id, max_count=1, window_seconds=3600
        )
    )
    await db_session.flush()
    assert await run_cap_preview(db_session, run=run) == 0


@pytest.mark.asyncio
async def test_mixed_manifest_flips_only_over_cap_rows(db_session, seeded_run):
    run, node_step, tenant_id, app_id = seeded_run
    db_session.add(
        CommCapPolicy(
            tenant_id=tenant_id, app_id=app_id, max_count=1, window_seconds=3600
        )
    )
    # R1: already over cap (one prior action).
    over_phone = "+919876543210"
    _add_manifest(
        db_session,
        run=run,
        tenant_id=tenant_id,
        app_id=app_id,
        recipient_id="R1",
        phone=over_phone,
    )
    await _seed_aged_action(
        db_session,
        run=run,
        node_step=node_step,
        tenant_id=tenant_id,
        app_id=app_id,
        phone=over_phone,
        offset_seconds=-60,
    )
    # R2: under cap (no prior actions).
    under_phone = "+919876509876"
    _add_manifest(
        db_session,
        run=run,
        tenant_id=tenant_id,
        app_id=app_id,
        recipient_id="R2",
        phone=under_phone,
    )
    await db_session.flush()

    assert await run_cap_preview(db_session, run=run) == 1

    states = {
        s.recipient_id: s.status
        for s in (
            await db_session.execute(
                select(WorkflowRunRecipientState).where(
                    WorkflowRunRecipientState.run_id == run.id
                )
            )
        ).scalars().all()
    }
    assert states["R1"] == "skipped_capped"
    assert states["R2"] == "pending"
