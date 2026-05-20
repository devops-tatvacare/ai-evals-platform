"""Integration: cap window rolls forward so previously-capped phones unblock.

Different from ``test_actions_outside_window_dont_count`` (which proves a stale
action doesn't count): here we exercise the transition. With one in-window
action a phone is capped; once that action falls outside the window, the same
phone is eligible again. Mirrors the production cap behaviour where caps reset
as old comms age out.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.models.comm_cap_policy import CommCapPolicy
from app.models.orchestration import WorkflowRunRecipientAction
from app.services.orchestration.comm_cap.policy_resolver import is_capped


PHONE = "+919876543210"


@pytest_asyncio.fixture
async def cap_with_window(db_session, seed_tenant_user_app):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    db_session.add(
        CommCapPolicy(
            tenant_id=tenant_id,
            app_id=app_id,
            max_count=1,
            window_seconds=10,
            is_active=True,
        )
    )
    await db_session.flush()
    return tenant_id, app_id


async def _seed_action(db_session, seed_full_run, *, phone: str, offset_seconds: int):
    run, _version, workflow, node_step, tenant_id, app_id = seed_full_run
    action_id = uuid.uuid4()
    db_session.add(
        WorkflowRunRecipientAction(
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


@pytest.mark.asyncio
async def test_capped_becomes_eligible_after_window(
    db_session, seed_full_run, cap_with_window
):
    tenant_id, app_id = cap_with_window

    await _seed_action(db_session, seed_full_run, phone=PHONE, offset_seconds=-1)
    assert (
        await is_capped(
            db_session, tenant_id=tenant_id, app_id=app_id, phone_e164=PHONE
        )
        is True
    )

    # Roll the only in-window action out by aging it past the cutoff.
    await db_session.execute(
        text(
            "UPDATE orchestration.workflow_run_recipient_actions "
            "SET created_at = now() + make_interval(secs => -30) "
            "WHERE contact_phone_e164 = :phone"
        ),
        {"phone": PHONE},
    )
    await db_session.flush()

    assert (
        await is_capped(
            db_session, tenant_id=tenant_id, app_id=app_id, phone_e164=PHONE
        )
        is False
    )
