"""Saved cohort routes (auth-required).

REST surface for ``orchestration.cohort_definitions`` and
``cohort_definition_versions``. Sister to ``orchestration_datasets``: tenant
scoping via ``Depends(get_auth_context)``, app-gating via
``ensure_registered_app_access``, structured 409 on delete-in-use.
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.auth.permissions import require_permission
from app.database import get_db
from app.models.orchestration import CohortDefinition
from app.services.access_control import can_access
from app.schemas.orchestration_cohort import (
    CohortCreate,
    CohortDetailResponse,
    CohortResponse,
    CohortUpdate,
    CohortVersionEditPayload,
    CohortVersionResponse,
    WorkflowBindingResponse,
)
from app.services.orchestration.api import cohorts as cohort_service


router = APIRouter(prefix="/api/orchestration/cohorts", tags=["orchestration"])


async def _load_and_gate_cohort(
    db: AsyncSession,
    auth: AuthContext,
    cohort_id: uuid.UUID,
    *,
    action: Literal["read", "edit"] = "read",
) -> CohortDefinition:
    row = await db.scalar(
        select(CohortDefinition).where(
            CohortDefinition.id == cohort_id,
            CohortDefinition.tenant_id == auth.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="cohort not found")
    await ensure_registered_app_access(db, auth, row.app_id)
    if not can_access(auth, row, action):
        if action == "read":
            raise HTTPException(status_code=404, detail="cohort not found")
        raise HTTPException(status_code=403, detail="cohort is read-only")
    return row


def _format_in_use_detail(exc: cohort_service.CohortInUse) -> dict[str, object]:
    return {
        "message": "cohort is in use by workflow(s)",
        "workflow_names": exc.workflow_names,
        "workflow_ids": [str(wid) for wid in exc.workflow_ids],
    }


# ─── cohort routes ──────────────────────────────────────────────────────────


@router.post("", response_model=CohortDetailResponse, status_code=201)
async def create_cohort_route(
    body: CohortCreate,
    auth: AuthContext = require_permission("orchestration:manage"),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, body.app_id)
    try:
        return await cohort_service.create_cohort(
            db,
            tenant_id=auth.tenant_id,
            app_id=body.app_id,
            slug=body.slug,
            name=body.name,
            description=body.description,
            created_by=auth.user_id,
            visibility=body.visibility,
            initial_version=body.initial_version.model_dump(),
        )
    except cohort_service.CohortConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("", response_model=list[CohortResponse])
async def list_cohorts_route(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    app_id: str = Query(..., alias="appId"),
):
    await ensure_registered_app_access(db, auth, app_id)
    return await cohort_service.list_cohorts(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=app_id,
    )


@router.get("/{cohort_id}", response_model=CohortDetailResponse)
async def get_cohort_route(
    cohort_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_cohort(db, auth, cohort_id)
    return await cohort_service.get_cohort(
        db, tenant_id=auth.tenant_id, cohort_id=cohort_id,
    )


@router.patch("/{cohort_id}", response_model=CohortDetailResponse)
async def update_cohort_route(
    cohort_id: uuid.UUID,
    body: CohortUpdate,
    auth: AuthContext = require_permission("orchestration:manage"),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_cohort(db, auth, cohort_id, action="edit")
    return await cohort_service.update_cohort(
        db,
        tenant_id=auth.tenant_id,
        cohort_id=cohort_id,
        name=body.name,
        description=body.description,
        visibility=body.visibility,
        active=body.active,
    )


@router.delete("/{cohort_id}", status_code=204)
async def delete_cohort_route(
    cohort_id: uuid.UUID,
    auth: AuthContext = require_permission("orchestration:manage"),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_cohort(db, auth, cohort_id, action="edit")
    try:
        await cohort_service.delete_cohort(
            db, tenant_id=auth.tenant_id, cohort_id=cohort_id,
        )
    except cohort_service.CohortNotFound:
        raise HTTPException(status_code=404, detail="cohort not found")
    except cohort_service.CohortInUse as exc:
        raise HTTPException(status_code=409, detail=_format_in_use_detail(exc))
    return Response(status_code=204)


# ─── version routes ─────────────────────────────────────────────────────────


@router.post("/{cohort_id}/versions", response_model=CohortVersionResponse, status_code=201)
async def create_draft_version_route(
    cohort_id: uuid.UUID,
    body: CohortVersionEditPayload,
    auth: AuthContext = require_permission("orchestration:manage"),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_cohort(db, auth, cohort_id, action="edit")
    return await cohort_service.create_draft_version(
        db,
        tenant_id=auth.tenant_id,
        cohort_id=cohort_id,
        payload=body.model_dump(),
    )


@router.patch(
    "/{cohort_id}/versions/{version_id}",
    response_model=CohortVersionResponse,
)
async def edit_draft_version_route(
    cohort_id: uuid.UUID,
    version_id: uuid.UUID,
    body: CohortVersionEditPayload,
    auth: AuthContext = require_permission("orchestration:manage"),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_cohort(db, auth, cohort_id, action="edit")
    try:
        return await cohort_service.edit_draft_version(
            db,
            tenant_id=auth.tenant_id,
            cohort_id=cohort_id,
            version_id=version_id,
            payload=body.model_dump(),
        )
    except cohort_service.CohortNotFound:
        raise HTTPException(status_code=404, detail="cohort version not found")
    except cohort_service.CohortVersionNotEditable as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post(
    "/{cohort_id}/versions/{version_id}/publish",
    response_model=CohortVersionResponse,
)
async def publish_version_route(
    cohort_id: uuid.UUID,
    version_id: uuid.UUID,
    auth: AuthContext = require_permission("orchestration:manage"),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_cohort(db, auth, cohort_id, action="edit")
    try:
        return await cohort_service.publish_version(
            db,
            tenant_id=auth.tenant_id,
            cohort_id=cohort_id,
            version_id=version_id,
            published_by=auth.user_id,
        )
    except cohort_service.CohortNotFound:
        raise HTTPException(status_code=404, detail="cohort version not found")
    except cohort_service.CohortVersionAlreadyPublished as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/{cohort_id}/used-by", response_model=list[WorkflowBindingResponse])
async def list_used_by_route(
    cohort_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_cohort(db, auth, cohort_id)
    return await cohort_service.list_used_by(
        db, tenant_id=auth.tenant_id, cohort_id=cohort_id,
    )
