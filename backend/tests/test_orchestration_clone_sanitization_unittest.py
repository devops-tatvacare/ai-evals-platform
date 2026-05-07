"""Phase 10 commit 1: clone-sanitization for ``connection_id`` bindings.

When tenant T clones a system workflow, every credential-backed
``connection_id`` in the copied definition is stripped unless the id points
at a row visible to (T, target_app_id). If anything was stripped, the
cloned workflow is created as a draft (no current_published_version).
"""
from __future__ import annotations

import secrets
import uuid
from copy import deepcopy

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.orchestration import Workflow, WorkflowVersion
from app.models.provider_connection import ProviderConnection
from app.services.orchestration.api.clone import clone_system_workflow


@pytest.fixture(autouse=True)
def fernet_key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_CONNECTION_KEY",
        Fernet.generate_key().decode(),
    )


def _encrypted() -> bytes:
    from app.services.orchestration.connections.crypto import encrypt
    return encrypt({"api_key": "k", "base_url": "https://api.bolna.ai", "from_phone": "+91"})


async def _seed_system_workflow_with_connection(
    db, *, system_connection_id: uuid.UUID, app_id: str,
) -> Workflow:
    wf = Workflow(
        id=uuid.uuid4(), tenant_id=SYSTEM_TENANT_ID, app_id=app_id,
        workflow_type="crm", slug=f"sys-{uuid.uuid4().hex[:8]}",
        name="System Source", created_by=SYSTEM_USER_ID,
    )
    db.add(wf)
    await db.flush()

    definition = {
        "nodes": [
            {
                "id": "src",
                "type": "source.cohort_query",
                "config": {"source_table": "x", "id_column": "id"},
            },
            {
                "id": "bolna",
                "type": "crm.place_bolna_call",
                "config": {
                    "template_slug": "concierge_confirmation",
                    "phone_field": "phone",
                    "connection_id": str(system_connection_id),
                },
            },
        ],
        "edges": [],
    }
    v = WorkflowVersion(
        id=uuid.uuid4(), tenant_id=SYSTEM_TENANT_ID, app_id=app_id,
        workflow_id=wf.id, version=1, definition=definition,
        status="published",
    )
    db.add(v)
    await db.flush()
    wf.current_published_version_id = v.id
    await db.flush()
    return wf


@pytest.mark.asyncio
async def test_clone_strips_system_connection_id_and_returns_draft(
    db_session, seed_tenant_user_app,
):
    """The system workflow lives under app_id=``system-app`` and the tenant
    target is ``test-orchestration``. The connection_id in the source
    definition is therefore foreign to (target_tenant, target_app_id) and
    gets stripped, forcing the clone into draft."""
    tenant_id, user_id, target_app_id = seed_tenant_user_app
    source_app_id = "system-app"  # ≠ target_app_id

    sys_conn_id = uuid.uuid4()
    db_session.add(
        ProviderConnection(
            id=sys_conn_id, tenant_id=SYSTEM_TENANT_ID, app_id=source_app_id,
            provider="bolna", name=f"sys-{uuid.uuid4().hex[:8]}",
            config_encrypted=_encrypted(),
            webhook_token=secrets.token_urlsafe(32),
            active=True, created_by=SYSTEM_USER_ID,
        )
    )
    await db_session.flush()
    src_wf = await _seed_system_workflow_with_connection(
        db_session, system_connection_id=sys_conn_id, app_id=source_app_id,
    )

    cloned = await clone_system_workflow(
        db_session,
        tenant_id=tenant_id,
        source_workflow_id=src_wf.id,
        new_slug=f"clone-{uuid.uuid4().hex[:8]}",
        new_name="Clone",
        target_app_id=target_app_id,
        created_by=user_id,
    )
    assert cloned is not None
    # Rebind required → draft, no current_published_version_id.
    assert cloned.current_published_version_id is None

    cloned_v = await db_session.scalar(
        select(WorkflowVersion).where(WorkflowVersion.workflow_id == cloned.id)
    )
    assert cloned_v is not None
    assert cloned_v.status == "draft"
    bolna_node = next(
        n for n in cloned_v.definition["nodes"] if n["type"] == "crm.place_bolna_call"
    )
    assert "connection_id" not in bolna_node["config"]


@pytest.mark.asyncio
async def test_clone_preserves_id_when_tenant_owns_a_match(
    db_session, seed_tenant_user_app,
):
    """If the tenant happens to own the same id (impossible in practice
    because ids are UUIDs, but covers the allow-list code path), the
    binding is preserved and the clone publishes."""
    tenant_id, user_id, app_id = seed_tenant_user_app

    # Seed both a system connection AND a tenant-owned connection with the
    # SAME id. This is unrealistic but exercises the allow-list branch.
    shared_id = uuid.uuid4()
    db_session.add(
        ProviderConnection(
            id=shared_id, tenant_id=tenant_id, app_id=app_id,
            provider="bolna", name=f"tenant-{uuid.uuid4().hex[:8]}",
            config_encrypted=_encrypted(),
            webhook_token=secrets.token_urlsafe(32),
            active=True, created_by=user_id,
        )
    )
    await db_session.flush()

    # Build a system workflow whose definition references that id directly
    # (no separate system row needed — the allow-list keys on tenant ownership).
    src_wf = await _seed_system_workflow_with_connection(
        db_session, system_connection_id=shared_id, app_id=app_id,
    )

    cloned = await clone_system_workflow(
        db_session,
        tenant_id=tenant_id,
        source_workflow_id=src_wf.id,
        new_slug=f"clone-{uuid.uuid4().hex[:8]}",
        new_name="Clone",
        target_app_id=app_id,
        created_by=user_id,
    )
    assert cloned is not None
    assert cloned.current_published_version_id is not None

    cloned_v = await db_session.scalar(
        select(WorkflowVersion).where(WorkflowVersion.workflow_id == cloned.id)
    )
    assert cloned_v.status == "published"
    bolna_node = next(
        n for n in cloned_v.definition["nodes"] if n["type"] == "crm.place_bolna_call"
    )
    assert bolna_node["config"]["connection_id"] == str(shared_id)


@pytest.mark.asyncio
async def test_strip_helper_handles_malformed_uuid_value(db_session, seed_tenant_user_app):
    """Malformed string in connection_id is treated as foreign and cleared.

    Defends the clone path against a hand-edited definition with non-UUID
    junk in ``connection_id`` — drop the key rather than letting it leak
    into the cloned tenant copy."""
    from app.services.orchestration.api.clone import _strip_foreign_connection_ids

    definition = {
        "nodes": [
            {"id": "x", "type": "crm.send_wati", "config": {"connection_id": "not-a-uuid"}}
        ],
        "edges": [],
    }
    cleaned, cleared = _strip_foreign_connection_ids(deepcopy(definition), set())
    assert cleared == 1
    assert "connection_id" not in cleaned["nodes"][0]["config"]
