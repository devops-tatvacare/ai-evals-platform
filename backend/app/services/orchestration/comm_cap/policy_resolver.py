"""Per tenant + app comm-cap lookup and recent-action counting.

Counts ride the generated ``contact_phone_e164`` column on
``orchestration.workflow_run_recipient_actions`` (migration 0066) so the cap
check is an index seek over ``(tenant_id, app_id, contact_phone_e164,
created_at)``.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.comm_cap_policy import CommCapPolicy
from app.models.orchestration import WorkflowRunRecipientAction


async def get_active_policy(
    db: AsyncSession, *, tenant_id: UUID, app_id: str
) -> CommCapPolicy | None:
    stmt = select(CommCapPolicy).where(
        CommCapPolicy.tenant_id == tenant_id,
        CommCapPolicy.app_id == app_id,
        CommCapPolicy.is_active.is_(True),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def count_recent_comms(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    app_id: str,
    phone_e164: str,
    window_seconds: int,
) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=window_seconds)
    stmt = (
        select(func.count())
        .select_from(WorkflowRunRecipientAction)
        .where(
            WorkflowRunRecipientAction.tenant_id == tenant_id,
            WorkflowRunRecipientAction.app_id == app_id,
            WorkflowRunRecipientAction.contact_phone_e164 == phone_e164,
            WorkflowRunRecipientAction.created_at >= cutoff,
        )
    )
    return int((await db.execute(stmt)).scalar_one())


async def is_capped(
    db: AsyncSession, *, tenant_id: UUID, app_id: str, phone_e164: str
) -> bool:
    policy = await get_active_policy(db, tenant_id=tenant_id, app_id=app_id)
    if policy is None:
        return False
    used = await count_recent_comms(
        db,
        tenant_id=tenant_id,
        app_id=app_id,
        phone_e164=phone_e164,
        window_seconds=policy.window_seconds,
    )
    return used >= policy.max_count
