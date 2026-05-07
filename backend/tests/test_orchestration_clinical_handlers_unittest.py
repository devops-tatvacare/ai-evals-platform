"""Per-handler tests for the 5 clinical.* node handlers.

Each handler shares the same shape:
  - dispatches an action via NodeContext.dispatch_actions
  - on success: enqueues a row in analytics.log_clinical_action_outbox
  - on no_op (already-dispatched idempotency match): returns success edge
    without re-enqueueing
  - on outbox failure: returns failed edge

We exercise the happy path for each (the templated EMR write also
validates payload substitution).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.clinical_outbox import LogClinicalActionOutbox
from app.models.orchestration import WorkflowRunNodeStep
from app.services.orchestration.cohort_stream import CohortStream
from app.services.orchestration.integrations.clinical_outbox import (
    ClinicalOutboxWriter,
)
from app.services.orchestration.node_context import NodeContext, ServiceRegistry


def _build_ctx(db_session, run, version, workflow, node_step, services):
    return NodeContext(
        db=db_session,
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        workflow_id=workflow.id,
        workflow_version_id=version.id,
        run_id=run.id,
        node_step_id=node_step.id,
        current_node_id="n_clin",
        services=services,
        job_id=None,
    )


async def _new_node_step(db_session, run, version, workflow, tenant_id, app_id, node_type):
    step = WorkflowRunNodeStep(
        id=uuid.uuid4(),
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id,
        node_id="n_clin",
        node_type=node_type,
        status="running",
        started_at=datetime.now(timezone.utc),
    )
    db_session.add(step)
    await db_session.flush()
    return step


@pytest.fixture
def services():
    reg = ServiceRegistry()
    reg.clinical_outbox = ClinicalOutboxWriter()
    return reg


@pytest.mark.asyncio
async def test_schedule_lab_enqueues_outbox(db_session, seed_full_run, services):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    step = await _new_node_step(
        db_session, run, version, workflow, tenant_id, app_id, "clinical.schedule_lab",
    )
    from app.services.orchestration.nodes.clinical_schedule_lab import _Config, _Handler

    cfg = _Config(test_code="HBA1C", test_name="HbA1c", frequency="quarterly")
    cohort = CohortStream([("P-1", {}), ("P-2", {})])
    ctx = _build_ctx(db_session, run, version, workflow, step, services)

    result = await _Handler().execute(cohort, cfg, ctx)
    assert {o.recipient_id for o in result.by_output_id["success"]} == {"P-1", "P-2"}
    assert result.by_output_id["exhausted"] == []

    rows = (await db_session.execute(
        select(LogClinicalActionOutbox.recipient_id, LogClinicalActionOutbox.payload)
        .where(LogClinicalActionOutbox.action_type == "clinical.schedule_lab")
        .where(LogClinicalActionOutbox.recipient_id.in_(["P-1", "P-2"]))
    )).all()
    assert len(rows) == 2
    assert all(r[1]["test_code"] == "HBA1C" for r in rows)


@pytest.mark.asyncio
async def test_assign_care_team_task_enqueues_outbox(db_session, seed_full_run, services):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    step = await _new_node_step(
        db_session, run, version, workflow, tenant_id, app_id,
        "clinical.assign_care_team_task",
    )
    from app.services.orchestration.nodes.clinical_assign_care_team_task import (
        _Config, _Handler,
    )

    cfg = _Config(role="care_manager", task_label="Outreach", cadence="once", sla_hours=24)
    cohort = CohortStream([("P-A", {}), ("P-B", {})])
    ctx = _build_ctx(db_session, run, version, workflow, step, services)

    result = await _Handler().execute(cohort, cfg, ctx)
    assert {o.recipient_id for o in result.by_output_id["success"]} == {"P-A", "P-B"}

    rows = (await db_session.execute(
        select(LogClinicalActionOutbox.payload).where(
            LogClinicalActionOutbox.action_type == "clinical.assign_care_team_task",
            LogClinicalActionOutbox.recipient_id.in_(["P-A", "P-B"]),
        )
    )).scalars().all()
    assert len(rows) == 2
    assert all(p["role"] == "care_manager" for p in rows)


@pytest.mark.asyncio
async def test_send_pro_assessment_enqueues_outbox(db_session, seed_full_run, services):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    step = await _new_node_step(
        db_session, run, version, workflow, tenant_id, app_id,
        "clinical.send_pro_assessment",
    )
    from app.services.orchestration.nodes.clinical_send_pro_assessment import (
        _Config, _Handler,
    )

    cfg = _Config(instrument="DDS", delivery_channel="wa")
    cohort = CohortStream([("P-X", {})])
    ctx = _build_ctx(db_session, run, version, workflow, step, services)

    result = await _Handler().execute(cohort, cfg, ctx)
    assert {o.recipient_id for o in result.by_output_id["success"]} == {"P-X"}

    payload = await db_session.scalar(
        select(LogClinicalActionOutbox.payload).where(
            LogClinicalActionOutbox.action_type == "clinical.send_pro_assessment",
            LogClinicalActionOutbox.recipient_id == "P-X",
        )
    )
    assert payload == {"instrument": "DDS", "delivery_channel": "wa"}


@pytest.mark.asyncio
async def test_emr_write_renders_template_against_payload(db_session, seed_full_run, services):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    step = await _new_node_step(
        db_session, run, version, workflow, tenant_id, app_id, "clinical.emr_write",
    )
    from app.services.orchestration.nodes.clinical_emr_write import _Config, _Handler

    cfg = _Config(
        note_type="care_plan_update",
        template="DM2 watch — HbA1c {{hba1c_latest}}, prior {{hba1c_prior}}.",
    )
    cohort = CohortStream([("P-EMR", {"hba1c_latest": 8.2, "hba1c_prior": 7.9})])
    ctx = _build_ctx(db_session, run, version, workflow, step, services)

    result = await _Handler().execute(cohort, cfg, ctx)
    assert {o.recipient_id for o in result.by_output_id["success"]} == {"P-EMR"}

    payload = await db_session.scalar(
        select(LogClinicalActionOutbox.payload).where(
            LogClinicalActionOutbox.action_type == "clinical.emr_write",
            LogClinicalActionOutbox.recipient_id == "P-EMR",
        )
    )
    assert payload["note"] == "DM2 watch — HbA1c 8.2, prior 7.9."
    assert payload["note_type"] == "care_plan_update"


@pytest.mark.asyncio
async def test_escalation_uptier_enqueues_outbox(db_session, seed_full_run, services):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    step = await _new_node_step(
        db_session, run, version, workflow, tenant_id, app_id,
        "clinical.escalation_uptier",
    )
    from app.services.orchestration.nodes.clinical_escalation_uptier import (
        _Config, _Handler,
    )

    cfg = _Config(target_role="physician", urgency="48h", reason="HbA1c >= 9.0")
    cohort = CohortStream([("P-ESC", {})])
    ctx = _build_ctx(db_session, run, version, workflow, step, services)

    result = await _Handler().execute(cohort, cfg, ctx)
    assert {o.recipient_id for o in result.by_output_id["success"]} == {"P-ESC"}

    payload = await db_session.scalar(
        select(LogClinicalActionOutbox.payload).where(
            LogClinicalActionOutbox.action_type == "clinical.escalation_uptier",
            LogClinicalActionOutbox.recipient_id == "P-ESC",
        )
    )
    assert payload == {
        "target_role": "physician",
        "urgency": "48h",
        "reason": "HbA1c >= 9.0",
    }


@pytest.mark.asyncio
async def test_handler_raises_when_outbox_writer_unwired(db_session, seed_full_run):
    """Each clinical handler must surface a clear error when the
    ServiceRegistry is missing clinical_outbox — never silent skip."""
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    step = await _new_node_step(
        db_session, run, version, workflow, tenant_id, app_id, "clinical.schedule_lab",
    )
    from app.services.orchestration.nodes.clinical_schedule_lab import _Config, _Handler

    services = ServiceRegistry()  # clinical_outbox is None
    cohort = CohortStream([("P-1", {})])
    ctx = _build_ctx(db_session, run, version, workflow, step, services)

    with pytest.raises(RuntimeError, match="ClinicalOutboxWriter"):
        await _Handler().execute(cohort, _Config(test_code="HBA1C", test_name="HbA1c"), ctx)
