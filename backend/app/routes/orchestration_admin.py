"""Admin endpoints for orchestration guardrails (Phase 2+).

Communication-cap policy management. Every PUT writes a
``platform.audit_event_logs`` row capturing the before/after policy state.
Access is gated by ``orchestration:admin:comm_cap``; cross-tenant operations
require platform-staff (``is_super_admin``).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, require_permission
from app.auth.context import is_super_admin
from app.database import get_db
from fastapi import Depends
from app.models.comm_cap_policy import CommCapPolicy
from app.schemas.orchestration_admin import CommCapPolicyRead, CommCapPolicyWrite
from app.services.audit import write_audit_log


router = APIRouter(
    prefix="/api/admin/orchestration",
    tags=["orchestration-admin"],
)


def _ensure_tenant_visible(auth: AuthContext, tenant_id: UUID) -> None:
    if tenant_id == auth.tenant_id or is_super_admin(auth):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Cross-tenant comm-cap access requires platform-staff",
    )


def _serialise(policy: CommCapPolicy) -> dict:
    return {
        "tenant_id": str(policy.tenant_id),
        "app_id": policy.app_id,
        "max_count": policy.max_count,
        "window_seconds": policy.window_seconds,
        "is_active": policy.is_active,
    }


@router.get("/comm-cap", response_model=CommCapPolicyRead | None)
async def get_comm_cap_policy(
    tenant_id: UUID = Query(..., alias="tenantId"),
    app_id: str = Query(..., alias="appId"),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = require_permission("orchestration:admin:comm_cap"),
) -> CommCapPolicy | None:
    _ensure_tenant_visible(auth, tenant_id)
    stmt = select(CommCapPolicy).where(
        CommCapPolicy.tenant_id == tenant_id,
        CommCapPolicy.app_id == app_id,
    )
    return (await db.execute(stmt)).scalar_one_or_none()


@router.put("/comm-cap", response_model=CommCapPolicyRead)
async def upsert_comm_cap_policy(
    body: CommCapPolicyWrite,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = require_permission("orchestration:admin:comm_cap"),
) -> CommCapPolicy:
    _ensure_tenant_visible(auth, body.tenant_id)
    stmt = select(CommCapPolicy).where(
        CommCapPolicy.tenant_id == body.tenant_id,
        CommCapPolicy.app_id == body.app_id,
    )
    policy = (await db.execute(stmt)).scalar_one_or_none()
    before_state = _serialise(policy) if policy else None
    if policy is None:
        policy = CommCapPolicy(
            tenant_id=body.tenant_id,
            app_id=body.app_id,
            max_count=body.max_count,
            window_seconds=body.window_seconds,
            is_active=body.is_active,
            updated_by_user_id=auth.user_id,
        )
        db.add(policy)
    else:
        policy.max_count = body.max_count
        policy.window_seconds = body.window_seconds
        policy.is_active = body.is_active
        policy.updated_by_user_id = auth.user_id
    await db.flush()

    await write_audit_log(
        db,
        tenant_id=body.tenant_id,
        actor_id=auth.user_id,
        action="orchestration.comm_cap.upsert",
        entity_type="comm_cap_policy",
        entity_id=policy.id,
        before_state=before_state,
        after_state=_serialise(policy),
    )
    return policy


@router.get("/comm-cap/list", response_model=list[CommCapPolicyRead])
async def list_comm_cap_policies(
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = require_permission("orchestration:admin:comm_cap"),
) -> list[CommCapPolicy]:
    stmt = select(CommCapPolicy).order_by(CommCapPolicy.tenant_id, CommCapPolicy.app_id)
    if not is_super_admin(auth):
        stmt = stmt.where(CommCapPolicy.tenant_id == auth.tenant_id)
    return list((await db.execute(stmt)).scalars().all())
