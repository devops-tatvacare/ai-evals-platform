"""Per tenant + app comm-cap lookup and recent-action counting.

Counts ride the generated ``contact_phone_e164`` column on
``orchestration.workflow_run_recipient_actions`` (migration 0066) so the cap
check is an index seek over ``(tenant_id, app_id, contact_phone_e164,
created_at)``. The cutoff is computed server-side via ``func.now()`` so the
cap math lives on the Postgres clock regardless of API-process drift.

Concurrency: two parallel dispatchers can both observe ``count < max_count``
in the same instant and both proceed, overshooting the cap by 1. Accepted as
a soft rolling-cap behaviour; a stricter ``SELECT ... FOR UPDATE`` on the
policy row would serialise every dispatch and defeat per-recipient
parallelism. Revisit if hard caps become a compliance requirement.
"""
from __future__ import annotations

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
    cutoff = func.now() - func.make_interval(0, 0, 0, 0, 0, 0, window_seconds)
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
