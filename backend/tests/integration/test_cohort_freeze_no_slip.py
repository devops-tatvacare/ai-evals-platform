"""Golden no-slip test: an unenrolled recipient cannot be dispatched.

This is the canonical failure the cohort-freeze phase prevents. If the source
mutates after T0 (a brand-new lead `L99` suddenly matches the cohort filter),
the frozen manifest still contains only the original {L1} set and the dispatch
guard hard-rejects `L99` before any provider call fires.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.orchestration import (
    CohortDefinition,
    CohortDefinitionVersion,
    WorkflowRunRecipient,
    WorkflowRunRecipientState,
)
from app.services.orchestration.errors import RecipientNotInManifestError
from app.services.orchestration.recipient_freezer import freeze_recipients
from app.services.orchestration.recipient_manifest import assert_recipient_in_manifest


@pytest_asyncio.fixture
async def slip_scenario(db_session, seed_full_run, seed_tenant_user_app):
    """Set up the run, freeze {L1}, then plant L99 as a post-T0 slip row."""
    run, _version, workflow, *_ = seed_full_run
    tenant_id, user_id, app_id = seed_tenant_user_app
    cohort = CohortDefinition(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        slug=f"slip-test-{uuid.uuid4().hex[:8]}",
        name="Slip test",
        created_by=user_id,
    )
    db_session.add(cohort)
    await db_session.flush()
    cohort_version = CohortDefinitionVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        cohort_definition_id=cohort.id,
        version=1,
        source_ref="platform.leads",
        filters=[{"field": "phone", "op": "in", "value": ["+919876543210"]}],
        payload_fields=["phone"],
        status="published",
    )
    db_session.add(cohort_version)
    await db_session.flush()

    # T0: only L1 enrolled. The cohort source node writes the state row…
    state_l1 = WorkflowRunRecipientState(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        workflow_version_id=run.workflow_version_id,
        run_id=run.id,
        recipient_id="L1",
        status="pending",
        payload={"contact": "+919876543210"},
    )
    db_session.add(state_l1)
    await db_session.flush()
    # …and the freezer captures the (recipient_id, phone) snapshot.
    await freeze_recipients(
        db_session,
        run=run,
        cohort_version=cohort_version,
        resolved_rows=[("L1", "+919876543210")],
    )

    # Post-T0 slip: L99 lands in workflow_run_recipient_states via some
    # other path (a buggy re-enrolment, a stray INSERT, anything). The
    # frozen manifest must NOT contain L99.
    state_l99 = WorkflowRunRecipientState(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        workflow_version_id=run.workflow_version_id,
        run_id=run.id,
        recipient_id="L99",
        status="pending",
        payload={"contact": "+919876543210"},
    )
    db_session.add(state_l99)
    await db_session.flush()
    return run


@pytest.mark.asyncio
async def test_manifest_contains_only_t0_recipients(db_session, slip_scenario):
    run = slip_scenario
    rows = (
        await db_session.execute(
            select(WorkflowRunRecipient).where(WorkflowRunRecipient.run_id == run.id)
        )
    ).scalars().all()
    assert {r.recipient_id for r in rows} == {"L1"}


@pytest.mark.asyncio
async def test_enrolled_recipient_passes_guard(db_session, slip_scenario):
    run = slip_scenario
    row = await assert_recipient_in_manifest(
        db_session, run_id=run.id, recipient_id="L1"
    )
    assert row.phone_e164 == "+919876543210"


@pytest.mark.asyncio
async def test_slipped_recipient_blocked_by_guard(db_session, slip_scenario):
    run = slip_scenario
    with pytest.raises(RecipientNotInManifestError) as exc_info:
        await assert_recipient_in_manifest(
            db_session, run_id=run.id, recipient_id="L99"
        )
    assert exc_info.value.recipient_id == "L99"
