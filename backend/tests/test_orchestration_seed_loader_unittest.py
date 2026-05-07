"""Seed loader inserts system templates + system workflow exactly once (idempotent).

Live-DB tests because the loader uses ON CONFLICT-style natural-key lookups
that mock sessions can't model. Each test runs in a transaction that's
rolled back at teardown.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.constants import SYSTEM_TENANT_ID
from app.models.orchestration import (
    Workflow,
    WorkflowActionTemplate,
    WorkflowVersion,
)
from app.services.orchestration_seed import seed_orchestration_defaults


@pytest.mark.asyncio
async def test_seed_inserts_four_system_action_templates(db_session):
    await seed_orchestration_defaults(db_session)
    rows = (await db_session.execute(
        select(WorkflowActionTemplate).where(
            WorkflowActionTemplate.tenant_id.is_(None),
            WorkflowActionTemplate.app_id.is_(None),
        )
    )).scalars().all()
    slugs = sorted(t.slug for t in rows)
    assert "concierge_priority" in slugs
    assert "concierge_qualify" in slugs
    assert "concierge_nurture" in slugs
    assert "concierge_confirmation" in slugs


@pytest.mark.asyncio
async def test_seed_inserts_default_concierge_workflow(db_session):
    await seed_orchestration_defaults(db_session)
    wf = await db_session.scalar(
        select(Workflow).where(
            Workflow.tenant_id == SYSTEM_TENANT_ID,
            Workflow.slug == "mql-concierge-default",
        )
    )
    assert wf is not None
    assert wf.app_id == "inside-sales"
    assert wf.workflow_type == "crm"
    assert wf.current_published_version_id is not None

    v = await db_session.scalar(
        select(WorkflowVersion).where(
            WorkflowVersion.id == wf.current_published_version_id
        )
    )
    assert v is not None
    assert v.status == "published"
    assert v.version >= 1
    nodes = v.definition.get("nodes", [])
    assert any(n["id"] == "src_cohort" for n in nodes)
    assert any(n["id"] == "split_tier" for n in nodes)


@pytest.mark.asyncio
async def test_seed_is_idempotent_on_repeat(db_session):
    await seed_orchestration_defaults(db_session)
    await seed_orchestration_defaults(db_session)  # second run must NOT duplicate
    wfs = (await db_session.execute(
        select(Workflow).where(
            Workflow.tenant_id == SYSTEM_TENANT_ID,
            Workflow.slug == "mql-concierge-default",
        )
    )).scalars().all()
    assert len(list(wfs)) == 1

    templates = (await db_session.execute(
        select(WorkflowActionTemplate).where(
            WorkflowActionTemplate.tenant_id.is_(None),
            WorkflowActionTemplate.app_id.is_(None),
            WorkflowActionTemplate.slug == "concierge_priority",
        )
    )).scalars().all()
    assert len(list(templates)) == 1


@pytest.mark.asyncio
async def test_seed_publishes_new_version_on_definition_drift(db_session):
    """When the JSON fixture changes, the loader must create a new version
    rather than mutate the existing one (versions are immutable)."""
    await seed_orchestration_defaults(db_session)

    wf = await db_session.scalar(
        select(Workflow).where(
            Workflow.tenant_id == SYSTEM_TENANT_ID,
            Workflow.slug == "mql-concierge-default",
        )
    )
    assert wf is not None
    v1_id = wf.current_published_version_id
    versions_before = (await db_session.execute(
        select(WorkflowVersion).where(WorkflowVersion.workflow_id == wf.id)
        .order_by(WorkflowVersion.version)
    )).scalars().all()
    latest_before = versions_before[-1]

    # Simulate fixture drift by manually inserting a "drifted" definition path
    # via the upsert helper.
    from app.services.orchestration_seed import _upsert_seeded_workflow
    drifted_spec = {
        "name": "Default MQL Concierge",
        "slug": "mql-concierge-default",
        "workflow_type": "crm",
        "app_id": "inside-sales",
        "description": "drifted",
        "definition": {"nodes": [{"id": "drift", "type": "sink.complete"}], "edges": []},
    }
    await _upsert_seeded_workflow(db_session, drifted_spec)

    await db_session.refresh(wf)
    assert wf.current_published_version_id != v1_id

    versions = (await db_session.execute(
        select(WorkflowVersion).where(WorkflowVersion.workflow_id == wf.id)
        .order_by(WorkflowVersion.version)
    )).scalars().all()
    assert len(list(versions)) == len(versions_before) + 1
    assert versions[-1].version == latest_before.version + 1
