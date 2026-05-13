"""Admin endpoints for mirror->fact mapping operator-disable plumbing.

Phase 3 of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.
Mounted under ``/api/admin/analytics``. Gated on the ``analytics:admin``
permission (added in the same commit). Mutations write breadcrumb rows into
``analytics.log_fact_population_run`` so operator actions are auditable.

No new permission tier; ``analytics:admin`` lives in the existing ``cost``
permission group because mapping-state ops are analytics-pipeline admin work
adjacent to cost-rollup admin (closest existing precedent).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext
from app.auth.permissions import require_permission
from app.database import get_db
from app.models.analytics_log import LogFactPopulationRun
from app.models.analytics_mapping_state import MappingState
from app.schemas.base import CamelModel
from app.services.analytics import mirror_to_fact_sync
from app.services.analytics.mirror_to_fact_mapper import MirrorToFactMapper


router = APIRouter(prefix="/api/admin/analytics", tags=["admin", "analytics"])


# ── schemas ─────────────────────────────────────────────────────────────


class MappingStateRow(CamelModel):
    id: uuid.UUID
    app_id: str
    source_table: str
    target_fact: str
    activity_type: str
    enabled: bool
    disabled_at: datetime | None = None
    disabled_by_user_id: uuid.UUID | None = None
    disabled_reason: str | None = None
    updated_at: datetime


class MappingStateListResponse(CamelModel):
    mappings: list[MappingStateRow]


class DisableMappingRequest(CamelModel):
    reason: str = Field(
        ...,
        min_length=3,
        description=(
            "Operator-visible reason for disabling. Surfaced in "
            "log_fact_population_run.metadata so the audit trail stays "
            "self-describing."
        ),
    )


# ── helpers ─────────────────────────────────────────────────────────────


def _row_to_response(row: MappingState) -> MappingStateRow:
    return MappingStateRow(
        id=row.id,
        app_id=row.app_id,
        source_table=row.source_table,
        target_fact=row.target_fact,
        activity_type=row.activity_type,
        enabled=row.enabled,
        disabled_at=row.disabled_at,
        disabled_by_user_id=row.disabled_by_user_id,
        disabled_reason=row.disabled_reason,
        updated_at=row.updated_at,
    )


async def _write_log_row(
    db: AsyncSession,
    *,
    mapping: MappingState,
    status: str,
    user_id: uuid.UUID,
    reason: str | None,
) -> None:
    db.add(
        LogFactPopulationRun(
            tenant_id=_log_tenant_id(),
            app_id=mapping.app_id,
            job_type="mapping_admin",
            status=status,
            metadata_={
                "mapping_id": str(mapping.id),
                "mapping_key": [
                    mapping.app_id,
                    mapping.source_table,
                    mapping.target_fact,
                    mapping.activity_type,
                ],
                "user_id": str(user_id),
                "reason": reason,
            },
        )
    )


def _log_tenant_id() -> uuid.UUID:
    # ``log_fact_population_run.tenant_id`` is NOT NULL with an FK to
    # ``platform.tenants``. Mapping state is not tenant-scoped, so we tag
    # admin events against the platform-system tenant.
    from app.constants import SYSTEM_TENANT_ID
    return SYSTEM_TENANT_ID


# ── routes ──────────────────────────────────────────────────────────────


@router.get("/mappings", response_model=MappingStateListResponse)
async def list_mappings(
    auth: AuthContext = require_permission("analytics:admin"),
    db: AsyncSession = Depends(get_db),
) -> MappingStateListResponse:
    _ = auth
    rows = (
        (
            await db.execute(
                select(MappingState).order_by(
                    MappingState.app_id,
                    MappingState.source_table,
                    MappingState.activity_type,
                )
            )
        )
        .scalars()
        .all()
    )
    return MappingStateListResponse(
        mappings=[_row_to_response(r) for r in rows]
    )


@router.post("/mappings/{mapping_id}/disable", response_model=MappingStateRow)
async def disable_mapping(
    mapping_id: uuid.UUID,
    body: DisableMappingRequest,
    auth: AuthContext = require_permission("analytics:admin"),
    db: AsyncSession = Depends(get_db),
) -> MappingStateRow:
    row = await _load_or_404(db, mapping_id)
    if not row.enabled:
        # Idempotent — operator hitting disable twice shouldn't 409.
        return _row_to_response(row)
    row.enabled = False
    row.disabled_at = datetime.now(timezone.utc)
    row.disabled_by_user_id = auth.user_id
    row.disabled_reason = body.reason
    await _write_log_row(
        db,
        mapping=row,
        status="mapping_disabled",
        user_id=auth.user_id,
        reason=body.reason,
    )
    await db.commit()
    await db.refresh(row)
    # Operator intervention is the natural reset point for the in-memory
    # failure counter. Without this, a disable->investigate->re-enable cycle
    # leaves the counter at 3 and the next single projection failure
    # immediately writes another ``blocking_sync`` row. Reset on both
    # disable and enable.
    _reset_counter_for_row(row)
    return _row_to_response(row)


@router.post("/mappings/{mapping_id}/enable", response_model=MappingStateRow)
async def enable_mapping(
    mapping_id: uuid.UUID,
    auth: AuthContext = require_permission("analytics:admin"),
    db: AsyncSession = Depends(get_db),
) -> MappingStateRow:
    row = await _load_or_404(db, mapping_id)
    if row.enabled:
        return _row_to_response(row)
    row.enabled = True
    row.disabled_at = None
    row.disabled_by_user_id = None
    row.disabled_reason = None
    await _write_log_row(
        db,
        mapping=row,
        status="mapping_enabled",
        user_id=auth.user_id,
        reason=None,
    )
    await db.commit()
    await db.refresh(row)
    _reset_counter_for_row(row)
    return _row_to_response(row)


def _reset_counter_for_row(row: MappingState) -> None:
    """Reset the process-local failure counter for this mapping only.

    Looks the mapping up in the registry; if it's not registered (mapping
    file deleted, row stale) we silently no-op rather than fail an admin
    action. The next sync would refuse to load that mapping anyway.
    """
    try:
        mapping = MirrorToFactMapper.default().for_table(
            row.app_id, row.source_table, row.activity_type
        )
    except KeyError:
        return
    mirror_to_fact_sync.reset_failure_counter(mapping)


async def _load_or_404(db: AsyncSession, mapping_id: uuid.UUID) -> MappingState:
    row = (
        (
            await db.execute(
                select(MappingState).where(MappingState.id == mapping_id)
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Mapping not found")
    return row


