"""Tests for recipient_freezer: phone normalisation, freeze write, idempotency."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.orchestration import (
    CohortDefinition,
    CohortDefinitionVersion,
    WorkflowRunRecipient,
)
from app.services.orchestration.recipient_freezer import (
    FreezeReceipt,
    freeze_recipients,
    normalise_phone_e164,
)


# ── Phone normalisation: pure-function tests ───────────────────


def test_normalise_phone_accepts_indian_local():
    assert normalise_phone_e164("9876543210", default_region="IN") == "+919876543210"


def test_normalise_phone_accepts_e164():
    assert normalise_phone_e164("+91 98765 43210") == "+919876543210"


def test_normalise_phone_returns_none_on_garbage():
    assert normalise_phone_e164("not-a-phone") is None


def test_normalise_phone_returns_none_on_empty():
    assert normalise_phone_e164("") is None
    assert normalise_phone_e164(None) is None


def test_normalise_phone_returns_none_on_invalid_e164():
    # 10 digits with leading + is not parseable as a real number
    assert normalise_phone_e164("+1234") is None


# ── Cohort version fixture ─────────────────────────────────────


@pytest_asyncio.fixture
async def cohort_version(db_session, seed_tenant_user_app):
    tenant_id, user_id, app_id = seed_tenant_user_app
    cohort = CohortDefinition(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        slug=f"freeze-test-{uuid.uuid4().hex[:8]}",
        name="Freeze test",
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
        filters=[{"field": "phone", "op": "in", "value": ["+919876543210"]}],
        payload_fields=["phone"],
        status="published",
    )
    db_session.add(version)
    await db_session.flush()
    return version


@pytest_asyncio.fixture
async def sample_recipient_rows():
    return [
        ("L1", "9876543210"),
        ("L2", "+91 98765 00000"),
    ]


# ── freeze_recipients integration tests ────────────────────────


@pytest.mark.asyncio
async def test_freeze_writes_manifest_rows(
    db_session, seed_full_run, cohort_version, sample_recipient_rows
):
    run, *_ = seed_full_run
    receipt: FreezeReceipt = await freeze_recipients(
        db_session,
        run=run,
        cohort_version=cohort_version,
        resolved_rows=sample_recipient_rows,
    )
    assert receipt.frozen_count == 2
    assert receipt.invalid_phone_count == 0
    rows = (
        await db_session.execute(
            select(WorkflowRunRecipient).where(WorkflowRunRecipient.run_id == run.id)
        )
    ).scalars().all()
    assert {r.phone_e164 for r in rows} == {"+919876543210", "+919876500000"}
    assert {r.recipient_id for r in rows} == {"L1", "L2"}
    assert all(r.predicate_hash == receipt.predicate_hash for r in rows)
    assert all(r.tenant_id == run.tenant_id for r in rows)
    assert all(r.app_id == run.app_id for r in rows)
    assert all(r.source_cohort_version_id == cohort_version.id for r in rows)


@pytest.mark.asyncio
async def test_freeze_drops_invalid_phones(
    db_session, seed_full_run, cohort_version
):
    run, *_ = seed_full_run
    rows = [
        ("L1", "9876543210"),
        ("L2", "not-a-phone"),
        ("L3", None),
        ("L4", ""),
    ]
    receipt = await freeze_recipients(
        db_session,
        run=run,
        cohort_version=cohort_version,
        resolved_rows=rows,
    )
    assert receipt.frozen_count == 1
    assert receipt.invalid_phone_count == 3
    manifest_rows = (
        await db_session.execute(
            select(WorkflowRunRecipient).where(WorkflowRunRecipient.run_id == run.id)
        )
    ).scalars().all()
    assert {r.recipient_id for r in manifest_rows} == {"L1"}


@pytest.mark.asyncio
async def test_freeze_is_idempotent(
    db_session, seed_full_run, cohort_version, sample_recipient_rows
):
    run, *_ = seed_full_run
    receipt1 = await freeze_recipients(
        db_session,
        run=run,
        cohort_version=cohort_version,
        resolved_rows=sample_recipient_rows,
    )
    receipt2 = await freeze_recipients(
        db_session,
        run=run,
        cohort_version=cohort_version,
        resolved_rows=sample_recipient_rows,
    )
    assert receipt1.predicate_hash == receipt2.predicate_hash
    rows = (
        await db_session.execute(
            select(WorkflowRunRecipient).where(WorkflowRunRecipient.run_id == run.id)
        )
    ).scalars().all()
    assert len(rows) == 2


