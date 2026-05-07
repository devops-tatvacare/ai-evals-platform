"""Resolve workflow_action_templates with tenant→system fallback. Active rows only."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import WorkflowActionTemplate


class TemplateNotFound(LookupError):
    pass


async def resolve_template(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    channel: str,
    slug: str,
) -> WorkflowActionTemplate:
    """Tenant override first; fall back to (tenant_id IS NULL, app_id IS NULL) system default."""
    stmt = select(WorkflowActionTemplate).where(
        WorkflowActionTemplate.tenant_id == tenant_id,
        WorkflowActionTemplate.app_id == app_id,
        WorkflowActionTemplate.channel == channel,
        WorkflowActionTemplate.slug == slug,
        WorkflowActionTemplate.active.is_(True),
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is not None:
        return row

    stmt2 = select(WorkflowActionTemplate).where(
        WorkflowActionTemplate.tenant_id.is_(None),
        WorkflowActionTemplate.app_id.is_(None),
        WorkflowActionTemplate.channel == channel,
        WorkflowActionTemplate.slug == slug,
        WorkflowActionTemplate.active.is_(True),
    )
    result2 = await db.execute(stmt2)
    row2 = result2.scalar_one_or_none()
    if row2 is not None:
        return row2

    raise TemplateNotFound(f"no template channel={channel!r} slug={slug!r} for tenant or system")
