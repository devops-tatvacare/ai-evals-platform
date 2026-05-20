"""policy_resolver: get_active_policy, count_recent_comms, is_capped."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.models.comm_cap_policy import CommCapPolicy
from app.models.orchestration import WorkflowRunRecipientAction
from app.services.orchestration.comm_cap.policy_resolver import (
    count_recent_comms,
    get_active_policy,
    is_capped,
)


PHONE = "+919876543210"


@pytest_asyncio.fixture
async def seed_comm_cap_policy(db_session, seed_tenant_user_app):
    """Returns a callable that inserts a CommCapPolicy row."""
    tenant_id, _user_id, app_id = seed_tenant_user_app

    async def _seed(
        *,
        max_count: int,
        window_seconds: int,
        is_active: bool = True,
        tenant_id_override: uuid.UUID | None = None,
        app_id_override: str | None = None,
    ) -> CommCapPolicy:
        policy = CommCapPolicy(
            tenant_id=tenant_id_override or tenant_id,
            app_id=app_id_override or app_id,
            max_count=max_count,
            window_seconds=window_seconds,
            is_active=is_active,
        )
        db_session.add(policy)
        await db_session.flush()
        return policy

    return _seed


@pytest_asyncio.fixture
async def seed_action(db_session, seed_full_run):
    """Insert a WorkflowRunRecipientAction with `phone` in payload['contact'],
    optionally shifted in time via ``offset_seconds`` (negative = past)."""
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
async def test_no_policy_means_not_capped(db_session, seed_tenant_user_app):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    assert (
        await is_capped(
            db_session,
            tenant_id=tenant_id,
            app_id=app_id,
            phone_e164=PHONE,
        )
        is False
    )


@pytest.mark.asyncio
async def test_inactive_policy_means_not_capped(
    db_session, seed_tenant_user_app, seed_comm_cap_policy
):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_comm_cap_policy(max_count=1, window_seconds=86400, is_active=False)
    assert (
        await is_capped(
            db_session,
            tenant_id=tenant_id,
            app_id=app_id,
            phone_e164=PHONE,
        )
        is False
    )


@pytest.mark.asyncio
async def test_under_limit_is_not_capped(
    db_session, seed_tenant_user_app, seed_comm_cap_policy, seed_action
):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_comm_cap_policy(max_count=3, window_seconds=86400)
    await seed_action(phone=PHONE, offset_seconds=-3600)  # 1h ago
    assert (
        await is_capped(
            db_session,
            tenant_id=tenant_id,
            app_id=app_id,
            phone_e164=PHONE,
        )
        is False
    )


@pytest.mark.asyncio
async def test_at_or_over_limit_is_capped(
    db_session, seed_tenant_user_app, seed_comm_cap_policy, seed_action
):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_comm_cap_policy(max_count=2, window_seconds=86400)
    for offset in (-100, -200):
        await seed_action(phone=PHONE, offset_seconds=offset)
    assert (
        await is_capped(
            db_session,
            tenant_id=tenant_id,
            app_id=app_id,
            phone_e164=PHONE,
        )
        is True
    )


@pytest.mark.asyncio
async def test_actions_outside_window_dont_count(
    db_session, seed_tenant_user_app, seed_comm_cap_policy, seed_action
):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_comm_cap_policy(max_count=1, window_seconds=3600)  # 1h
    await seed_action(phone=PHONE, offset_seconds=-7200)  # 2h ago
    assert (
        await is_capped(
            db_session,
            tenant_id=tenant_id,
            app_id=app_id,
            phone_e164=PHONE,
        )
        is False
    )


@pytest.mark.asyncio
async def test_count_recent_comms_returns_int(
    db_session, seed_tenant_user_app, seed_action
):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_action(phone=PHONE, offset_seconds=-10)
    count = await count_recent_comms(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        phone_e164=PHONE,
        window_seconds=3600,
    )
    assert count == 1


@pytest.mark.asyncio
async def test_get_active_policy_returns_only_active(
    db_session, seed_tenant_user_app, seed_comm_cap_policy
):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_comm_cap_policy(max_count=5, window_seconds=86400, is_active=True)
    policy = await get_active_policy(db_session, tenant_id=tenant_id, app_id=app_id)
    assert policy is not None
    assert policy.max_count == 5


@pytest.mark.asyncio
async def test_other_tenants_policy_does_not_affect_us(
    db_session, seed_tenant_user_app, seed_comm_cap_policy, seed_action
):
    """Cap on tenant A's app does not apply when we ask about tenant B."""
    tenant_id, _user_id, app_id = seed_tenant_user_app
    other_tenant = uuid.uuid4()
    await seed_comm_cap_policy(
        max_count=1,
        window_seconds=86400,
        tenant_id_override=other_tenant,
    )
    await seed_action(phone=PHONE, offset_seconds=-60)
    assert (
        await is_capped(
            db_session, tenant_id=tenant_id, app_id=app_id, phone_e164=PHONE
        )
        is False
    )


@pytest.mark.asyncio
async def test_other_apps_actions_do_not_count(
    db_session, seed_tenant_user_app, seed_comm_cap_policy, seed_action
):
    """Actions logged under app X do not consume the cap of app Y."""
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_comm_cap_policy(max_count=1, window_seconds=86400)
    await seed_action(phone=PHONE, offset_seconds=-60)  # written under app_id
    other_app = f"{app_id}-other"
    assert (
        await is_capped(
            db_session, tenant_id=tenant_id, app_id=other_app, phone_e164=PHONE
        )
        is False
    )


@pytest.mark.asyncio
async def test_other_phones_actions_do_not_count(
    db_session, seed_tenant_user_app, seed_comm_cap_policy, seed_action
):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_comm_cap_policy(max_count=1, window_seconds=86400)
    await seed_action(phone=PHONE, offset_seconds=-60)
    assert (
        await is_capped(
            db_session,
            tenant_id=tenant_id,
            app_id=app_id,
            phone_e164="+12025550100",
        )
        is False
    )


@pytest.mark.asyncio
async def test_capped_at_boundary_one_below_max(
    db_session, seed_tenant_user_app, seed_comm_cap_policy, seed_action
):
    """count == max_count - 1 must be eligible; count == max_count must be capped."""
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_comm_cap_policy(max_count=3, window_seconds=86400)
    for offset in (-30, -20):
        await seed_action(phone=PHONE, offset_seconds=offset)
    assert (
        await is_capped(
            db_session, tenant_id=tenant_id, app_id=app_id, phone_e164=PHONE
        )
        is False
    )
    await seed_action(phone=PHONE, offset_seconds=-10)
    assert (
        await is_capped(
            db_session, tenant_id=tenant_id, app_id=app_id, phone_e164=PHONE
        )
        is True
    )


@pytest.mark.asyncio
async def test_actions_without_contact_payload_do_not_count(
    db_session, seed_tenant_user_app, seed_comm_cap_policy, seed_full_run
):
    """Generated column is NULL when payload lacks 'contact'; such actions
    must not consume the cap for any phone."""
    tenant_id, _user_id, app_id = seed_tenant_user_app
    await seed_comm_cap_policy(max_count=1, window_seconds=86400)

    run, _version, workflow, node_step, _tenant, _app = seed_full_run
    from app.models.orchestration import WorkflowRunRecipientAction
    db_session.add(
        WorkflowRunRecipientAction(
            id=uuid.uuid4(),
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
            payload={},  # no 'contact' key — generated column resolves to NULL
        )
    )
    await db_session.flush()
    assert (
        await is_capped(
            db_session, tenant_id=tenant_id, app_id=app_id, phone_e164=PHONE
        )
        is False
    )
