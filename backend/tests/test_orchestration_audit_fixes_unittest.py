"""Regression tests for the 2026-04-30 phase-1-6 audit findings.

Each test maps to one or more numbered audit items. Comments name them
explicitly so a future maintainer can trace a test back to the audit when
deciding whether a behaviour change is intentional.

Audit items covered:
  #1 Cron triggers route to ``fire-orchestration-trigger`` (not run-workflow).
  #2 Failed runs persist as ``failed`` even when the surrounding session
     rolls back (savepoint write).
  #3 LSQ webhook does NOT accept the WATI secret as a fallback.
  #4 Internal load helpers refuse foreign-tenant run/workflow ids.
  #5 WATI STOP only fires for inbound reply event types.
  #6 LSQ webhook normalizes payload into the ``recipients`` contract.
  #8 ``payload_columns`` regex rejects dotted column names.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.config import settings
from app.main import app
from app.services.orchestration.nodes._cohort_query_compiler import (
    CohortQueryCompileError,
    CohortQueryConfig,
)


# Pydantic v2 wraps ``ValueError`` raised inside a ``@field_validator`` as a
# ``ValidationError``; tests should accept either so the validation contract
# is what's asserted, not the exception class.
_ValidationFailure = (CohortQueryCompileError, ValidationError)
from app.services.orchestration.run_handler import run_workflow_job
from app.services.orchestration.webhook_handlers.lsq import (
    _normalize_lsq_payload,
)
from app.services.orchestration.webhook_handlers.wati import handle_wati_event


# ── #8: cohort-query payload_columns regex ───────────────────────────────────


def test_payload_columns_rejects_dotted_column_audit_item_8():
    """Dots are only legal for ``source_table``; plain columns must reject them.

    Pre-fix the same regex was reused everywhere, so config like
    ``payload_columns=['some.col']`` survived validation and emitted
    ``src.some.col`` SQL that failed at execution with a confusing
    "column does not exist" error.
    """
    with pytest.raises(_ValidationFailure):
        CohortQueryConfig(
            source_table="analytics.crm_lead_record",
            id_column="lead_id",
            payload_columns=["some.col"],
        )


def test_payload_columns_accepts_plain_identifier_audit_item_8():
    cfg = CohortQueryConfig(
        source_table="analytics.crm_lead_record",
        id_column="lead_id",
        payload_columns=["mobile", "lead_stage"],
    )
    assert cfg.payload_columns == ["mobile", "lead_stage"]


def test_filter_column_rejects_dot_audit_item_8():
    with pytest.raises(_ValidationFailure):
        # filter.column should never carry a dot; reject the whole config build.
        CohortQueryConfig.model_validate(
            {
                "source_table": "analytics.crm_lead_record",
                "id_column": "lead_id",
                "filters": [{"column": "x.y", "op": "eq", "value": 1}],
            }
        )


# ── #6: LSQ payload normalization ────────────────────────────────────────────


def test_lsq_normalizer_extracts_lead_id_from_top_level_audit_item_6():
    norm = _normalize_lsq_payload({"LeadId": "L-123", "Status": "MQL"})
    assert norm["recipients"] == [
        {"recipient_id": "L-123", "payload": {"LeadId": "L-123", "Status": "MQL"}}
    ]


def test_lsq_normalizer_extracts_from_nested_lead_envelope_audit_item_6():
    norm = _normalize_lsq_payload({"Lead": {"LeadId": "L-456"}, "EventName": "Stage"})
    assert len(norm["recipients"]) == 1
    assert norm["recipients"][0]["recipient_id"] == "L-456"


def test_lsq_normalizer_passes_through_explicit_recipients_audit_item_6():
    payload = {"recipients": [{"recipient_id": "L-1", "payload": {"x": 1}}]}
    norm = _normalize_lsq_payload(payload)
    assert norm["recipients"] == payload["recipients"]


def test_lsq_normalizer_returns_empty_recipients_when_no_lead_id_audit_item_6():
    norm = _normalize_lsq_payload({"foo": "bar"})
    assert norm["recipients"] == []


# ── #3: LSQ secret isolation ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_lsq_webhook_rejects_wati_secret_audit_item_3(monkeypatch):
    """LSQ must NOT accept the WATI secret. Pre-fix the route fell back to
    WATI_WEBHOOK_SECRET when LSQ_WEBHOOK_SECRET was unset, weakening the
    trust boundary for LSQ-event-driven automation."""
    monkeypatch.setattr(settings, "WATI_WEBHOOK_SECRET", "shh-wati")
    monkeypatch.setattr(settings, "LSQ_WEBHOOK_SECRET", "")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            "/api/orchestration/webhooks/lsq/shh-wati", json={"LeadId": "L-1"}
        )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_lsq_webhook_rejects_empty_secret_audit_item_3(monkeypatch):
    monkeypatch.setattr(settings, "WATI_WEBHOOK_SECRET", "shh-wati")
    monkeypatch.setattr(settings, "LSQ_WEBHOOK_SECRET", "")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            "/api/orchestration/webhooks/lsq/anything", json={"LeadId": "L-1"}
        )
    assert r.status_code == 404


# ── #5: WATI STOP detection only on reply events ─────────────────────────────


@pytest.mark.asyncio
async def test_wati_delivered_with_stop_in_body_does_not_opt_out_audit_item_5(
    db_session, seed_full_run,
):
    """A delivery receipt that echoes the outbound body containing 'STOP'
    (compliance footer) must not be misread as an opt-out."""
    from app.models.orchestration import WorkflowConsentRecord, WorkflowRunRecipientAction

    run, version, workflow, node_step, tenant_id, app_id = seed_full_run

    # Seed the parent dispatched action so the delivery event has something to attach to.
    local_msg_id = f"lm-{uuid.uuid4().hex[:6]}"
    db_session.add(WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id,
        recipient_id="L-stop-test",
        channel="wati", action_type="wa_dispatched", status="success",
        idempotency_key=f"k-{uuid.uuid4().hex[:6]}",
        payload={}, response={"localMessageId": local_msg_id},
    ))
    await db_session.flush()

    await handle_wati_event(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        payload={
            "eventType": "sentMessageDELIVERED_v2",
            "localMessageId": local_msg_id,
            # outbound message body has compliance footer — must NOT opt out.
            "messageBody": "Visit the link to learn more. Reply STOP to unsubscribe.",
        },
    )

    consent = (await db_session.execute(
        select(WorkflowConsentRecord).where(
            WorkflowConsentRecord.tenant_id == tenant_id,
            WorkflowConsentRecord.recipient_id == "L-stop-test",
        )
    )).scalars().all()
    assert consent == [], "delivery event must not flip consent to opted_out"

    # The normal action row IS written.
    delivered = (await db_session.execute(
        select(WorkflowRunRecipientAction).where(
            WorkflowRunRecipientAction.recipient_id == "L-stop-test",
            WorkflowRunRecipientAction.action_type == "wa_delivered",
        )
    )).scalars().all()
    assert len(delivered) == 1


@pytest.mark.asyncio
async def test_wati_inbound_reply_with_stop_does_opt_out_audit_item_5(
    db_session, seed_full_run,
):
    """An actual reply event containing STOP must still flip consent."""
    from app.models.orchestration import WorkflowConsentRecord, WorkflowRunRecipientAction

    run, version, workflow, node_step, tenant_id, app_id = seed_full_run

    local_msg_id = f"lm-{uuid.uuid4().hex[:6]}"
    db_session.add(WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id,
        recipient_id="L-reply-stop",
        channel="wati", action_type="wa_dispatched", status="success",
        idempotency_key=f"k-{uuid.uuid4().hex[:6]}",
        payload={}, response={"localMessageId": local_msg_id},
    ))
    await db_session.flush()

    await handle_wati_event(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        payload={
            "eventType": "messageReceived",
            "localMessageId": local_msg_id,
            "messageBody": "STOP",
        },
    )

    consent = (await db_session.execute(
        select(WorkflowConsentRecord).where(
            WorkflowConsentRecord.tenant_id == tenant_id,
            WorkflowConsentRecord.recipient_id == "L-reply-stop",
            WorkflowConsentRecord.status == "opted_out",
        )
    )).scalars().all()
    assert len(consent) == 1


# ── #4: tenant-scoped internal load helpers ──────────────────────────────────


@pytest.mark.asyncio
async def test_run_workflow_rejects_foreign_tenant_audit_item_4(
    db_session, seed_full_run,
):
    """A misrouted job pointing at a foreign tenant's run must NOT execute.

    Pre-fix the internal _load_run looked up by id only, so a job carrying
    tenant_id=B against run_id owned by tenant A could execute A's data.
    """
    run, _, _, _, _, _ = seed_full_run
    foreign_tenant = uuid.uuid4()

    result = await run_workflow_job(
        run.id, db_session, params={}, tenant_id=foreign_tenant,
    )
    assert result == {"status": "not_found"}


# ── #1 + #2: cron trigger handler and failure persistence are exercised by
# downstream integration tests. The unit-level guard tests below assert
# wiring is in place.


def test_fire_orchestration_trigger_is_registered_audit_item_1():
    """``fire-orchestration-trigger`` must be a registered job-type so the
    scheduler can dispatch cron-driven trigger fires."""
    from app.services import job_worker as jw
    assert "fire-orchestration-trigger" in jw.JOB_HANDLERS


def test_recover_stale_workflow_runs_is_exported_audit_item_2():
    from app.services import job_worker as jw
    assert hasattr(jw, "recover_stale_workflow_runs")


# ── #1: end-to-end cron-trigger fire produces a run + run-workflow job ──────


@pytest.mark.asyncio
async def test_fire_orchestration_trigger_creates_run_and_queues_run_workflow_audit_item_1(
    db_session, seed_full_run,
):
    """Calling the ``fire-orchestration-trigger`` handler directly must:
      1) insert one ``orchestration.workflow_runs`` row, and
      2) insert one queued ``platform.background_jobs`` row with
         ``job_type='run-workflow'`` and ``params.run_id`` matching #1.

    Pre-fix the scheduler enqueued ``run-workflow`` directly with
    ``params={trigger_id: ...}``; ``run-workflow`` rejected its own params
    for missing ``run_id`` and every cron campaign was inert.
    """
    from app.models.job import BackgroundJob
    from app.models.orchestration import WorkflowRun, WorkflowTrigger
    from app.services.job_worker import handle_fire_orchestration_trigger

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    workflow.current_published_version_id = version.id

    trigger = WorkflowTrigger(
        id=uuid.uuid4(),
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id,
        kind="cron", cron_expression="0 * * * *",
        active=True, params={}, created_by=run.triggered_by_user_id,
    )
    db_session.add(trigger)
    await db_session.flush()

    # Patch async_session inside the handler to yield our test session, with
    # commit aliased to flush so the outer rollback still cleans up.
    from app.services import job_worker as jw
    db_session.commit = db_session.flush  # type: ignore[assignment]
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _fake_session():
        yield db_session

    original = jw.async_session
    jw.async_session = _fake_session  # type: ignore[assignment]
    try:
        result = await handle_fire_orchestration_trigger(
            uuid.uuid4(),
            {"trigger_id": str(trigger.id)},
            tenant_id=tenant_id, user_id=run.triggered_by_user_id,
        )
    finally:
        jw.async_session = original  # type: ignore[assignment]

    assert result["status"] == "queued"
    new_run_id = uuid.UUID(result["run_id"])
    new_job_id = uuid.UUID(result["next_job_id"])

    # 1. workflow_runs row exists for this trigger.
    new_run = (await db_session.execute(
        select(WorkflowRun).where(WorkflowRun.id == new_run_id)
    )).scalar_one()
    assert new_run.tenant_id == tenant_id
    assert new_run.workflow_id == workflow.id
    assert new_run.workflow_version_id == version.id
    assert new_run.trigger_id == trigger.id
    assert new_run.triggered_by == "cron"
    assert new_run.status == "pending"

    # 2. run-workflow background job exists with params.run_id matching.
    new_job = (await db_session.execute(
        select(BackgroundJob).where(BackgroundJob.id == new_job_id)
    )).scalar_one()
    assert new_job.job_type == "run-workflow"
    assert new_job.status == "queued"
    assert (new_job.params or {}).get("run_id") == str(new_run_id)
    assert new_run.job_id == new_job_id


@pytest.mark.asyncio
async def test_fire_orchestration_trigger_skips_unpublished_workflow_audit_item_1(
    db_session, seed_full_run,
):
    """A trigger pointing at a workflow with no published version must skip
    rather than create a run that immediately fails."""
    from app.models.orchestration import WorkflowTrigger
    from app.services.job_worker import handle_fire_orchestration_trigger

    run, _version, workflow, _step, tenant_id, app_id = seed_full_run
    # Workflow is intentionally NOT published.
    workflow.current_published_version_id = None

    trigger = WorkflowTrigger(
        id=uuid.uuid4(),
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id,
        kind="cron", cron_expression="* * * * *",
        active=True, params={}, created_by=run.triggered_by_user_id,
    )
    db_session.add(trigger)
    await db_session.flush()

    from app.services import job_worker as jw
    db_session.commit = db_session.flush  # type: ignore[assignment]
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _fake_session():
        yield db_session

    original = jw.async_session
    jw.async_session = _fake_session  # type: ignore[assignment]
    try:
        result = await handle_fire_orchestration_trigger(
            uuid.uuid4(),
            {"trigger_id": str(trigger.id)},
            tenant_id=tenant_id, user_id=run.triggered_by_user_id,
        )
    finally:
        jw.async_session = original  # type: ignore[assignment]

    assert result["status"] == "workflow_not_publishable"
