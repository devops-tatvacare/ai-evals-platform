"""LogClinicalActionOutbox table + ClinicalOutboxWriter idempotency tests.

Verifies the Phase 9 outbox table exists in analytics, ORM round-trip
works, the unique constraint is enforced, and the writer's
on_conflict_do_nothing path returns the existing row id rather than
duplicating.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.models.clinical_outbox import LogClinicalActionOutbox
from app.services.orchestration.integrations.clinical_outbox import ClinicalOutboxWriter


@pytest.mark.asyncio
async def test_log_clinical_action_outbox_table_exists(db_session):
    res = await db_session.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'analytics' "
            "  AND table_name = 'log_clinical_action_outbox'"
        )
    )
    assert res.scalar() == 1


@pytest.mark.asyncio
async def test_writer_inserts_pending_row(db_session, seed_tenant_user_app):
    tenant_id, _, app_id = seed_tenant_user_app
    writer = ClinicalOutboxWriter()
    row_id = await writer.enqueue(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="P-1",
        action_type="clinical.schedule_lab",
        idempotency_key=f"ik-{uuid.uuid4().hex[:8]}",
        payload={"test_code": "HBA1C"},
    )
    row = await db_session.get(LogClinicalActionOutbox, row_id)
    assert row is not None
    assert row.tenant_id == tenant_id
    assert row.status == "pending"
    assert row.payload == {"test_code": "HBA1C"}
    assert row.action_type == "clinical.schedule_lab"


@pytest.mark.asyncio
async def test_writer_is_idempotent_on_conflict(db_session, seed_tenant_user_app):
    """Second enqueue with the same idempotency_key must not duplicate the
    row — must return the existing row's id."""
    tenant_id, _, app_id = seed_tenant_user_app
    writer = ClinicalOutboxWriter()
    idem = f"ik-{uuid.uuid4().hex[:8]}"
    first_id = await writer.enqueue(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="P-2",
        action_type="clinical.assign_care_team_task",
        idempotency_key=idem,
        payload={"role": "care_manager"},
    )
    second_id = await writer.enqueue(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="P-2",
        action_type="clinical.assign_care_team_task",
        idempotency_key=idem,
        payload={"role": "physician"},  # different payload — must not overwrite
    )
    assert first_id == second_id

    rows = (await db_session.execute(
        text(
            "SELECT payload->>'role' AS role FROM analytics.log_clinical_action_outbox "
            "WHERE tenant_id = :t AND recipient_id = :r AND idempotency_key = :k"
        ),
        {"t": str(tenant_id), "r": "P-2", "k": idem},
    )).all()
    assert len(rows) == 1
    # The original payload is preserved — on_conflict_do_nothing did not
    # overwrite the first row.
    assert rows[0][0] == "care_manager"
