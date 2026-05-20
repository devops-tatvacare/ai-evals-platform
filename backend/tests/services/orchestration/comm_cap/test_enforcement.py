"""enforce_comm_cap_or_skip: Proceed when no policy, skipped_capped when capped.

Phase 2 deliberately does NOT write to ``workflow_run_recipient_actions`` on a
cap skip — that table is the dispatch ledger (CHECK status IN
('pending','success','failed'), requires node_step_id, idempotency_key,
channel, action_type). The recipient-state row plus the run-level summary
cover the operator-visible audit.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.comm_cap_policy import CommCapPolicy
from app.models.orchestration import (
    WorkflowRunRecipient,
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.comm_cap.enforcement import (
    EnforcementResult,
    enforce_comm_cap_or_skip,
)


PHONE = "+919876543210"


@pytest_asyncio.fixture
async def seeded_run_with_recipient(db_session, seed_full_run):
    """Seed one frozen-manifest recipient + a pending state row for it."""
    run, _version, workflow, _node_step, tenant_id, app_id = seed_full_run
    recipient_id = f"R-{uuid.uuid4().hex[:8]}"

    recipient = WorkflowRunRecipient(
        run_id=run.id,
        tenant_id=tenant_id,
        app_id=app_id,
        recipient_id=recipient_id,
        phone_e164=PHONE,
        predicate_hash="0" * 64,
    )
    db_session.add(recipient)

    state = WorkflowRunRecipientState(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        workflow_version_id=run.workflow_version_id,
        run_id=run.id,
        recipient_id=recipient_id,
        status="pending",
        payload={"contact": PHONE},
    )
    db_session.add(state)
    await db_session.flush()
    return run, recipient, state


@pytest_asyncio.fixture
async def seed_action(db_session, seed_full_run):
    run, _version, workflow, node_step, tenant_id, app_id = seed_full_run

    async def _seed(*, phone: str, offset_seconds: int = 0) -> uuid.UUID:
        action_id = uuid.uuid4()
        action = WorkflowRunRecipientAction(
            id=action_id,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow.id,
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
        db_session.add(action)
        await db_session.flush()
        if offset_seconds:
            from sqlalchemy import text
            await db_session.execute(
                text(
                    "UPDATE orchestration.workflow_run_recipient_actions "
                    "SET created_at = now() + make_interval(secs => :offset) "
                    "WHERE id = :id"
                ),
                {"offset": offset_seconds, "id": action_id},
            )
            await db_session.flush()
        return action_id

    return _seed


@pytest.mark.asyncio
async def test_no_policy_proceeds(db_session, seeded_run_with_recipient):
    run, recipient, state = seeded_run_with_recipient
    result = await enforce_comm_cap_or_skip(
        db_session, recipient=recipient
    )
    assert isinstance(result, EnforcementResult)
    assert result.proceed is True
    assert result.reason is None
    assert state.status == "pending"


@pytest.mark.asyncio
async def test_capped_flips_state_to_skipped_capped(
    db_session, seeded_run_with_recipient, seed_action
):
    run, recipient, state = seeded_run_with_recipient
    policy = CommCapPolicy(
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        max_count=1,
        window_seconds=86400,
        is_active=True,
    )
    db_session.add(policy)
    await seed_action(phone=PHONE, offset_seconds=-60)
    await db_session.flush()

    result = await enforce_comm_cap_or_skip(
        db_session,
        recipient=recipient,
        stage="cap_runtime",
    )
    assert result.proceed is False
    assert result.reason == "cap_runtime"

    await db_session.refresh(state)
    assert state.status == "skipped_capped"


@pytest.mark.asyncio
async def test_cap_skip_does_not_write_actions_row(
    db_session, seeded_run_with_recipient, seed_action
):
    run, recipient, state = seeded_run_with_recipient
    policy = CommCapPolicy(
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        max_count=1,
        window_seconds=86400,
        is_active=True,
    )
    db_session.add(policy)
    await seed_action(phone=PHONE, offset_seconds=-60)
    await db_session.flush()

    actions_before = (
        await db_session.execute(
            select(WorkflowRunRecipientAction).where(
                WorkflowRunRecipientAction.run_id == run.id,
                WorkflowRunRecipientAction.recipient_id == recipient.recipient_id,
            )
        )
    ).scalars().all()

    preview_result = await enforce_comm_cap_or_skip(
        db_session,
        recipient=recipient,
        stage="cap_preview",
    )
    assert preview_result.proceed is False
    assert preview_result.reason == "cap_preview"

    actions_after = (
        await db_session.execute(
            select(WorkflowRunRecipientAction).where(
                WorkflowRunRecipientAction.run_id == run.id,
                WorkflowRunRecipientAction.recipient_id == recipient.recipient_id,
            )
        )
    ).scalars().all()

    assert len(actions_after) == len(actions_before)
