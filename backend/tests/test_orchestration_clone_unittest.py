"""Clone-system-workflow service tests.

Direct service-layer tests against db_session — bypasses the route layer
because conftest does not currently ship an authenticated_client fixture.
The route's only logic on top of the service is permission gating and
HTTPException translation, both covered by routes_unittest.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.orchestration import Workflow, WorkflowVersion
from app.services.orchestration.api.clone import (
    CloneError,
    clone_system_workflow,
)
from app.services.orchestration_seed import seed_orchestration_defaults


@pytest.mark.asyncio
async def test_clone_creates_tenant_copy_with_v1_published(db_session, seed_tenant_user_app):
    tenant_id, user_id, app_id = seed_tenant_user_app
    await seed_orchestration_defaults(db_session)

    src = await db_session.scalar(
        select(Workflow).where(
            Workflow.tenant_id == SYSTEM_TENANT_ID,
            Workflow.slug == "mql-concierge-default",
        )
    )
    assert src is not None

    cloned = await clone_system_workflow(
        db_session,
        tenant_id=tenant_id,
        source_workflow_id=src.id,
        new_slug=f"my-concierge-{uuid.uuid4().hex[:8]}",
        new_name="My Concierge",
        target_app_id=app_id,
        created_by=user_id,
    )
    assert cloned is not None
    assert cloned.tenant_id == tenant_id
    assert cloned.app_id == app_id
    assert cloned.workflow_type == src.workflow_type
    assert cloned.name == "My Concierge"
    assert cloned.current_published_version_id is not None
    assert cloned.id != src.id

    cloned_v = await db_session.scalar(
        select(WorkflowVersion).where(
            WorkflowVersion.id == cloned.current_published_version_id
        )
    )
    assert cloned_v is not None
    assert cloned_v.version == 1
    assert cloned_v.status == "published"

    # Definition is a deep copy of the source's published definition.
    src_v = await db_session.scalar(
        select(WorkflowVersion).where(WorkflowVersion.id == src.current_published_version_id)
    )
    assert cloned_v.definition == src_v.definition


@pytest.mark.asyncio
async def test_clone_returns_none_for_unknown_source(db_session, seed_tenant_user_app):
    """A source UUID that doesn't reference any system workflow returns None.

    This is the same code path that filters non-system-tenant workflows
    (the SELECT requires both id == source_workflow_id AND
    tenant_id == SYSTEM_TENANT_ID).
    """
    tenant_id, user_id, app_id = seed_tenant_user_app

    result = await clone_system_workflow(
        db_session,
        tenant_id=tenant_id,
        source_workflow_id=uuid.uuid4(),
        new_slug=f"clone-{uuid.uuid4().hex[:8]}",
        new_name="Clone",
        target_app_id=app_id,
        created_by=user_id,
    )
    assert result is None


@pytest.mark.asyncio
async def test_clone_raises_when_source_has_no_published_version(db_session, seed_tenant_user_app):
    """A system workflow with no published version cannot be cloned."""
    tenant_id, user_id, app_id = seed_tenant_user_app

    bare_wf = Workflow(
        id=uuid.uuid4(),
        tenant_id=SYSTEM_TENANT_ID, app_id=app_id,
        workflow_type="crm",
        slug=f"bare-{uuid.uuid4().hex[:8]}",
        name="Bare",
        created_by=SYSTEM_USER_ID,
    )
    db_session.add(bare_wf)
    await db_session.flush()

    with pytest.raises(CloneError, match="no published version"):
        await clone_system_workflow(
            db_session,
            tenant_id=tenant_id,
            source_workflow_id=bare_wf.id,
            new_slug=f"clone-{uuid.uuid4().hex[:8]}",
            new_name="Clone",
            target_app_id=app_id,
            created_by=user_id,
        )
