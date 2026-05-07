"""Template resolver: tenant override → system default fallback."""
from __future__ import annotations

import uuid

import pytest

from app.models.orchestration import WorkflowActionTemplate
from app.services.orchestration.integrations.template_resolver import (
    TemplateNotFound,
    resolve_template,
)


@pytest.mark.asyncio
async def test_returns_tenant_override_when_present(db_session, seed_tenant_user_app):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    slug = f"welcome-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="wati", slug=slug, name="System Welcome",
        payload_schema={"template_name": "welcome_v1"},
    ))
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        channel="wati", slug=slug, name="Tenant Welcome",
        payload_schema={"template_name": "tenant_welcome_v2"},
    ))
    await db_session.flush()

    t = await resolve_template(db_session, tenant_id=tenant_id, app_id=app_id, channel="wati", slug=slug)
    assert t.name == "Tenant Welcome"
    assert t.payload_schema["template_name"] == "tenant_welcome_v2"


@pytest.mark.asyncio
async def test_falls_back_to_system_default(db_session, seed_tenant_user_app):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    slug = f"nurture-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="wati", slug=slug, name="System Nurture",
        payload_schema={"template_name": "nurture_v1"},
    ))
    await db_session.flush()

    t = await resolve_template(db_session, tenant_id=tenant_id, app_id=app_id, channel="wati", slug=slug)
    assert t.name == "System Nurture"


@pytest.mark.asyncio
async def test_raises_when_neither_present(db_session, seed_tenant_user_app):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    with pytest.raises(TemplateNotFound):
        await resolve_template(
            db_session, tenant_id=tenant_id, app_id=app_id,
            channel="wati", slug=f"missing-{uuid.uuid4().hex}",
        )


@pytest.mark.asyncio
async def test_inactive_template_falls_through(db_session, seed_tenant_user_app):
    tenant_id, _user_id, app_id = seed_tenant_user_app
    slug = f"inactive-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        channel="wati", slug=slug, name="Tenant (off)",
        payload_schema={}, active=False,
    ))
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="wati", slug=slug, name="System (on)",
        payload_schema={"template_name": "x"},
    ))
    await db_session.flush()
    t = await resolve_template(db_session, tenant_id=tenant_id, app_id=app_id, channel="wati", slug=slug)
    assert t.name == "System (on)"
