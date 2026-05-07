"""Action template list + tenant-override upsert.

System defaults (tenant_id IS NULL) are read-only via the API; tenants only
edit their own override row keyed on (tenant_id, app_id, channel, slug).

Uniqueness on ``(COALESCE(tenant_id, ZERO_UUID), COALESCE(app_id, ''),
channel, slug)`` is enforced by a UNIQUE INDEX from migration 0019. The
upsert below uses ``INSERT ... ON CONFLICT ... DO UPDATE`` so concurrent
writers don't race past a SELECT-then-INSERT and end up with
IntegrityError-on-second-INSERT.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import WorkflowActionTemplate


async def list_templates(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: Optional[str] = None,
    channel: Optional[str] = None,
) -> list[WorkflowActionTemplate]:
    """Returns tenant overrides + system defaults (tenant_id IS NULL)."""
    stmt = select(WorkflowActionTemplate).where(
        (WorkflowActionTemplate.tenant_id == tenant_id)
        | (WorkflowActionTemplate.tenant_id.is_(None))
    )
    if app_id:
        stmt = stmt.where(
            (WorkflowActionTemplate.app_id == app_id)
            | (WorkflowActionTemplate.app_id.is_(None))
        )
    if channel:
        stmt = stmt.where(WorkflowActionTemplate.channel == channel)
    return list((await db.execute(
        stmt.order_by(WorkflowActionTemplate.channel, WorkflowActionTemplate.slug)
    )).scalars().all())


async def upsert_tenant_template(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    channel: str,
    slug: str,
    name: str,
    payload_schema: dict[str, Any],
    active: bool,
) -> WorkflowActionTemplate:
    """Insert-or-update a tenant override template.

    Uses INSERT ... ON CONFLICT ... DO UPDATE so concurrent writers are
    serialized by the underlying COALESCE-based UNIQUE INDEX rather than
    racing through a select/insert path.
    """
    new_id = uuid.uuid4()
    stmt = (
        pg_insert(WorkflowActionTemplate)
        .values(
            id=new_id,
            tenant_id=tenant_id,
            app_id=app_id,
            channel=channel,
            slug=slug,
            name=name,
            payload_schema=payload_schema,
            active=active,
        )
        .on_conflict_do_update(
            # The DB-side UNIQUE INDEX is over the COALESCE expressions so
            # NULL tenant_id / NULL app_id rows still dedupe. Since
            # ``upsert_tenant_template`` always passes non-NULL tenant_id +
            # app_id, the conflict target uses the same column tuple.
            index_elements=[
                func.coalesce(
                    WorkflowActionTemplate.tenant_id,
                    text("'00000000-0000-0000-0000-000000000000'::uuid"),
                ),
                func.coalesce(WorkflowActionTemplate.app_id, ""),
                WorkflowActionTemplate.channel,
                WorkflowActionTemplate.slug,
            ],
            set_={
                "name": name,
                "payload_schema": payload_schema,
                "active": active,
                "updated_at": func.now(),
            },
        )
        .returning(WorkflowActionTemplate)
    )
    result = await db.execute(stmt)
    row = result.scalar_one()
    await db.commit()
    await db.refresh(row)
    return row
