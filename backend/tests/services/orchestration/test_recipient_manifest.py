"""Tests for the manifest guard: in-set passes, out-of-set raises."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from app.models.orchestration import (
    CohortDefinition,
    CohortDefinitionVersion,
)
from app.services.orchestration.errors import RecipientNotInManifestError
from app.services.orchestration.recipient_freezer import freeze_recipients
from app.services.orchestration.recipient_manifest import (
    assert_recipient_in_manifest,
)


@pytest_asyncio.fixture
async def frozen_run(db_session, seed_full_run, seed_tenant_user_app):
    run, *_ = seed_full_run
    tenant_id, user_id, app_id = seed_tenant_user_app
    cohort = CohortDefinition(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        slug=f"manifest-test-{uuid.uuid4().hex[:8]}",
        name="Manifest test",
        created_by=user_id,
    )
    db_session.add(cohort)
    await db_session.flush()
    version = CohortDefinitionVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        cohort_definition_id=cohort.id,
        version=1,
        source_ref="platform.leads",
        filters=[],
        payload_fields=["phone"],
        status="published",
    )
    db_session.add(version)
    await db_session.flush()
    await freeze_recipients(
        db_session,
        run=run,
        cohort_version=version,
        resolved_rows=[("L1", "9876543210"), ("L2", "9876500000")],
    )
    return run


@pytest.mark.asyncio
async def test_in_manifest_returns_row(db_session, frozen_run):
    recipient = await assert_recipient_in_manifest(
        db_session,
        run_id=frozen_run.id,
        recipient_id="L1",
    )
    assert recipient.phone_e164 == "+919876543210"
    assert recipient.recipient_id == "L1"
    assert recipient.run_id == frozen_run.id


@pytest.mark.asyncio
async def test_out_of_manifest_raises(db_session, frozen_run):
    with pytest.raises(RecipientNotInManifestError) as exc_info:
        await assert_recipient_in_manifest(
            db_session,
            run_id=frozen_run.id,
            recipient_id="LEAD_NOT_IN_COHORT",
        )
    assert exc_info.value.recipient_id == "LEAD_NOT_IN_COHORT"
    assert exc_info.value.run_id == frozen_run.id


@pytest.mark.asyncio
async def test_other_run_isolated(db_session, frozen_run, seed_tenant_user_app):
    # frozen_run has L1/L2 in its manifest. A different run starts empty —
    # the same recipient_id 'L1' must NOT resolve against it.
    tenant_id, user_id, app_id = seed_tenant_user_app
    fresh = await _make_empty_run(db_session, tenant_id, user_id, app_id)
    with pytest.raises(RecipientNotInManifestError):
        await assert_recipient_in_manifest(
            db_session,
            run_id=fresh.id,
            recipient_id="L1",
        )


async def _make_empty_run(db_session, tenant_id, user_id, app_id):
    from app.models.orchestration import Workflow, WorkflowVersion, WorkflowRun

    workflow = Workflow(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_type="crm",
        slug=f"empty-{uuid.uuid4().hex[:8]}",
        name="Empty",
        created_by=user_id,
    )
    db_session.add(workflow)
    await db_session.flush()
    version = WorkflowVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        version=1,
        definition={"nodes": [], "edges": []},
        status="published",
    )
    db_session.add(version)
    await db_session.flush()
    run = WorkflowRun(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        workflow_version_id=version.id,
        triggered_by="manual",
        status="running",
    )
    db_session.add(run)
    await db_session.flush()
    return run
