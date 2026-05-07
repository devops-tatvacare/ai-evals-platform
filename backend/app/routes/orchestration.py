"""Orchestration API routes (auth-required).

All routes require a Bearer token via ``Depends(get_auth_context)``. Public
webhooks live in ``orchestration_webhooks.py`` (Phase 4).

Routes that accept ``app_id`` also enforce registered-app access via
``ensure_registered_app_access``. Run-scoped routes load the run first and
then app-gate using ``run.app_id``.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.auth.permissions import require_permission
from app.database import get_db
from app.models.orchestration import Workflow, WorkflowRun
from app.models.user import User
from app.services.access_control import can_access
from app.schemas.orchestration import (
    ActionResponse,
    ActionTemplateResponse,
    ActionTemplateUpsertRequest,
    CloneSystemWorkflowRequest,
    CohortSourceResponse,
    ConsentResponse,
    ConsentSetRequest,
    NodeTypeDescriptor,
    OverrideRequest,
    OverrideResponse,
    RecipientStateResponse,
    RunCreateRequest,
    RunListResponse,
    RunNodeStepResponse,
    RunOverlaySnapshotResponse,
    RunResponse,
    TriggerCreateRequest,
    TriggerUpdateRequest,
    TriggerResponse,
    WorkflowActionGlobalRow,
    WorkflowActionListResponse,
    WorkflowCreateRequest,
    WorkflowResponse,
    WorkflowUpdateRequest,
    WorkflowVersionCreateRequest,
    WorkflowVersionResponse,
)
from app.services.orchestration.api import (
    clone as clone_service,
    consent as consent_service,
    runs as run_service,
    templates as tmpl_service,
    triggers as trig_service,
    versions as ver_service,
    workflows as wf_service,
)
from app.services.orchestration.api.node_types import list_node_types
from app.services.orchestration.api.source_catalog import list_cohort_sources
from app.services.orchestration.definition_validator import (
    DispatchRequiredFieldsError,
)


router = APIRouter(prefix="/api/orchestration", tags=["orchestration"])


# ─── Workflows ───────────────────────────────────────────────────────────────


@router.post("/workflows", response_model=WorkflowResponse, status_code=201)
async def create_workflow(
    body: WorkflowCreateRequest,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, body.app_id)
    try:
        wf = await wf_service.create_workflow(
            db, tenant_id=auth.tenant_id, app_id=body.app_id,
            workflow_type=body.workflow_type, slug=body.slug,
            name=body.name, description=body.description,
            created_by=auth.user_id, visibility=body.visibility,
        )
    except wf_service.WorkflowConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return wf


async def _load_and_gate_workflow(
    db: AsyncSession,
    auth: AuthContext,
    workflow_id: uuid.UUID,
    *,
    require_active: bool = True,
    action: Literal["read", "edit"] = "read",
):
    """Load a workflow visible to the caller and apply row-level gating."""
    stmt = select(Workflow).where(Workflow.id == workflow_id)
    if require_active:
        stmt = stmt.where(Workflow.active.is_(True))
    wf = (await db.execute(stmt)).scalar_one_or_none()
    if wf is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    if wf.tenant_id not in {auth.tenant_id}:
        from app.constants import SYSTEM_TENANT_ID

        if wf.tenant_id != SYSTEM_TENANT_ID:
            raise HTTPException(status_code=404, detail="workflow not found")
    await ensure_registered_app_access(db, auth, wf.app_id)
    if not can_access(auth, wf, action):
        if action == "read":
            raise HTTPException(status_code=404, detail="workflow not found")
        raise HTTPException(status_code=403, detail="workflow is read-only")
    return wf


_NO_RUN: tuple[Optional[uuid.UUID], Optional[datetime], Optional[str]] = (
    None, None, None,
)


_NO_CREATOR: tuple[Optional[str], Optional[str]] = (None, None)


def _to_workflow_response(
    wf: Workflow,
    last_run: tuple[Optional[uuid.UUID], Optional[datetime], Optional[str]] = _NO_RUN,
    creator: tuple[Optional[str], Optional[str]] = _NO_CREATOR,
) -> WorkflowResponse:
    """Project a Workflow ORM row + its latest run summary + creator
    profile into the API response. Centralised so list and single-get
    share the identical field-population path — keeps ``last_run_*`` /
    ``created_by_name`` / ``created_by_email`` consistent."""
    resp = WorkflowResponse.model_validate(wf)
    resp.last_run_id = last_run[0]
    resp.last_run_at = last_run[1]
    resp.last_run_status = last_run[2]
    resp.created_by_name = creator[0]
    resp.created_by_email = creator[1]
    return resp


async def _resolve_creators(
    db: AsyncSession,
    *,
    workflows: list[Workflow],
) -> dict[uuid.UUID, tuple[Optional[str], Optional[str]]]:
    """Bulk-resolve `(created_by) -> (display_name, email)` so the listing
    avoids N+1 lookups. Tenant-agnostic on purpose: a workflow's creator
    might be the system user (cross-tenant), so we look up by id alone.
    Missing rows fall through to (None, None)."""
    ids = list({w.created_by for w in workflows if w.created_by})
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(User.id, User.display_name, User.email).where(User.id.in_(ids))
        )
    ).all()
    return {r.id: (r.display_name, r.email) for r in rows}


async def _attach_last_runs(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    workflows: list[Workflow],
) -> list[WorkflowResponse]:
    last_runs = await run_service.latest_runs_by_workflow_ids(
        db, tenant_id=tenant_id, workflow_ids=[w.id for w in workflows],
    )
    creators = await _resolve_creators(db, workflows=workflows)
    return [
        _to_workflow_response(
            w,
            last_runs.get(w.id, _NO_RUN),
            creators.get(w.created_by, _NO_CREATOR),
        )
        for w in workflows
    ]


@router.get("/workflows", response_model=list[WorkflowResponse])
async def list_workflows(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    app_id: Optional[str] = Query(None, alias="appId"),
    workflow_type: Optional[str] = Query(None, alias="workflowType"),
    visibility: Literal["all", "private", "shared"] = Query("all"),
):
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        wfs = await wf_service.list_workflows(
            db,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            app_id=app_id,
            workflow_type=workflow_type,
            visibility=visibility,
        )
    else:
        # No explicit app filter — restrict to apps the caller can reach.
        wfs = await wf_service.list_workflows(
            db,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            workflow_type=workflow_type,
            app_ids=frozenset(auth.app_access),
            visibility=visibility,
        )
    return await _attach_last_runs(db, tenant_id=auth.tenant_id, workflows=wfs)


@router.get("/system-workflows", response_model=list[WorkflowResponse])
async def list_system_workflows(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    app_id: Optional[str] = Query(None, alias="appId"),
    workflow_type: Optional[str] = Query(None, alias="workflowType"),
):
    """List cloneable system-seeded workflows visible to the caller's app scope.

    System workflows are templates — never directly run — so ``last_run_*``
    is left as ``None``. Tenant clones expose their own run history.
    """
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        wfs = await wf_service.list_system_workflows(
            db, app_id=app_id, workflow_type=workflow_type,
        )
    else:
        wfs = await wf_service.list_system_workflows(
            db, workflow_type=workflow_type, app_ids=frozenset(auth.app_access),
        )
    return [_to_workflow_response(w) for w in wfs]


@router.get("/workflows/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(
    workflow_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    wf = await _load_and_gate_workflow(db, auth, workflow_id, require_active=False)
    last_runs = await run_service.latest_runs_by_workflow_ids(
        db, tenant_id=auth.tenant_id, workflow_ids=[wf.id],
    )
    creators = await _resolve_creators(db, workflows=[wf])
    return _to_workflow_response(
        wf,
        last_runs.get(wf.id, _NO_RUN),
        creators.get(wf.created_by, _NO_CREATOR),
    )


@router.patch("/workflows/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(
    workflow_id: uuid.UUID,
    body: WorkflowUpdateRequest,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id, action="edit")
    wf = await wf_service.update_workflow(
        db, tenant_id=auth.tenant_id, workflow_id=workflow_id,
        name=body.name, description=body.description,
        visibility=body.visibility,
    )
    if wf is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return wf


@router.delete("/workflows/{workflow_id}", status_code=204)
async def archive_workflow(
    workflow_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id, action="edit")
    if not await wf_service.archive_workflow(db, tenant_id=auth.tenant_id, workflow_id=workflow_id):
        raise HTTPException(status_code=404, detail="workflow not found")
    return Response(status_code=204)


@router.post(
    "/workflows/clone",
    response_model=WorkflowResponse,
    status_code=201,
)
async def clone_system_workflow(
    body: CloneSystemWorkflowRequest,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    """Clone a system-owned workflow into the caller's tenant.

    Used for tenant rollout of seeded workflows ("Default MQL Concierge",
    "DM2 Adherence Watch"). Tenants edit the cloned workflow visually
    without affecting the system seed.
    """
    await ensure_registered_app_access(db, auth, body.target_app_id)
    try:
        wf = await clone_service.clone_system_workflow(
            db,
            tenant_id=auth.tenant_id,
            source_workflow_id=body.source_workflow_id,
            new_slug=body.new_slug,
            new_name=body.new_name,
            target_app_id=body.target_app_id,
            created_by=auth.user_id,
        )
    except clone_service.CloneError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if wf is None:
        raise HTTPException(
            status_code=404, detail="source system workflow not found",
        )
    return wf


# ─── Workflow versions ──────────────────────────────────────────────────────


@router.post(
    "/workflows/{workflow_id}/versions",
    response_model=WorkflowVersionResponse,
    status_code=201,
)
async def create_version(
    workflow_id: uuid.UUID,
    body: WorkflowVersionCreateRequest,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id, action="edit")
    v = await ver_service.create_draft_version(
        db, tenant_id=auth.tenant_id, workflow_id=workflow_id,
        definition=body.definition.model_dump(),
    )
    if v is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return v


@router.get(
    "/workflows/{workflow_id}/versions",
    response_model=list[WorkflowVersionResponse],
)
async def list_versions(
    workflow_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id, require_active=False)
    return await ver_service.list_versions(
        db, tenant_id=auth.tenant_id, workflow_id=workflow_id,
    )


@router.get(
    "/workflows/{workflow_id}/versions/{version_id}",
    response_model=WorkflowVersionResponse,
)
async def get_version(
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id, require_active=False)
    v = await ver_service.get_version(db, tenant_id=auth.tenant_id, version_id=version_id)
    if v is None or v.workflow_id != workflow_id:
        raise HTTPException(status_code=404, detail="version not found")
    return v


@router.post(
    "/workflows/{workflow_id}/versions/{version_id}/publish",
    response_model=WorkflowVersionResponse,
)
async def publish_version(
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id, action="edit")
    try:
        v = await ver_service.publish_version(
            db, tenant_id=auth.tenant_id, workflow_id=workflow_id,
            version_id=version_id, published_by=auth.user_id,
        )
    except DispatchRequiredFieldsError as exc:
        raise HTTPException(status_code=422, detail=exc.errors)
    except ver_service.VersionPublishError as exc:
        # Phase 14 / Phase E — when the publish failure carries a
        # structured ``errors`` list (the normal validator path), surface
        # it as the ``detail`` array so the FE renders 400 and 422 the
        # same way. Bare freeform-message failures still 400 with the
        # legacy string body.
        if exc.errors:
            raise HTTPException(status_code=400, detail=exc.errors)
        raise HTTPException(status_code=400, detail=str(exc))
    if v is None:
        raise HTTPException(status_code=404, detail="version not found")
    return v


# ─── Triggers ───────────────────────────────────────────────────────────────


@router.post(
    "/workflows/{workflow_id}/triggers",
    response_model=TriggerResponse,
    status_code=201,
)
async def create_trigger(
    workflow_id: uuid.UUID,
    body: TriggerCreateRequest,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id, action="edit")
    try:
        trig = await trig_service.create_trigger(
            db, tenant_id=auth.tenant_id, workflow_id=workflow_id,
            kind=body.kind, cron_expression=body.cron_expression,
            event_name=body.event_name, params=body.params, active=body.active,
            created_by=auth.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if trig is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return trig


@router.get(
    "/workflows/{workflow_id}/triggers",
    response_model=list[TriggerResponse],
)
async def list_triggers(
    workflow_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id)
    return await trig_service.list_triggers(
        db, tenant_id=auth.tenant_id, workflow_id=workflow_id,
    )


@router.patch("/triggers/{trigger_id}", response_model=TriggerResponse)
async def update_trigger(
    trigger_id: uuid.UUID,
    body: TriggerUpdateRequest,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    trig = await trig_service.get_trigger(db, tenant_id=auth.tenant_id, trigger_id=trigger_id)
    if trig is None:
        raise HTTPException(status_code=404, detail="trigger not found")
    await ensure_registered_app_access(db, auth, trig.app_id)
    await _load_and_gate_workflow(db, auth, trig.workflow_id, action="edit")
    try:
        updated = await trig_service.update_trigger(
            db,
            tenant_id=auth.tenant_id,
            trigger_id=trigger_id,
            active=body.active,
            cron_expression=body.cron_expression,
            params=body.params,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if updated is None:
        raise HTTPException(status_code=404, detail="trigger not found")
    return updated


@router.delete("/triggers/{trigger_id}", status_code=204)
async def delete_trigger(
    trigger_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    # Load trigger first to learn its app_id; bare delete-by-id can't gate.
    trig = await trig_service.get_trigger(db, tenant_id=auth.tenant_id, trigger_id=trigger_id)
    if trig is None:
        raise HTTPException(status_code=404, detail="trigger not found")
    await ensure_registered_app_access(db, auth, trig.app_id)
    await _load_and_gate_workflow(db, auth, trig.workflow_id, action="edit")
    if not await trig_service.delete_trigger(
        db, tenant_id=auth.tenant_id, trigger_id=trigger_id,
    ):
        raise HTTPException(status_code=404, detail="trigger not found")
    return Response(status_code=204)


# ─── Runs ───────────────────────────────────────────────────────────────────


@router.post("/runs", response_model=RunResponse, status_code=201)
async def fire_manual(
    body: RunCreateRequest,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, body.workflow_id, action="edit")
    try:
        run = await run_service.fire_manual_run(
            db, tenant_id=auth.tenant_id, workflow_id=body.workflow_id,
            user_id=auth.user_id, params=body.params,
        )
    except run_service.RunFireError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if run is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return run


async def _load_and_gate_run(db: AsyncSession, auth: AuthContext, run_id: uuid.UUID):
    """Load a run scoped to ``auth.tenant_id`` and verify the caller has access
    to the run's ``app_id``. Returns the run or raises HTTPException(404)."""
    run = await run_service.get_run(db, tenant_id=auth.tenant_id, run_id=run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    workflow = (await db.execute(select(Workflow).where(Workflow.id == run.workflow_id))).scalar_one_or_none()
    if workflow is None or not can_access(auth, workflow, "read"):
        raise HTTPException(status_code=404, detail="run not found")
    await ensure_registered_app_access(db, auth, run.app_id)
    return run


@router.get("/runs", response_model=RunListResponse)
async def list_runs(
    workflow_id: Optional[uuid.UUID] = Query(None, alias="workflowId"),
    app_id: Optional[str] = Query(None, alias="appId"),
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    # App-scoped logs routes pass `appId` explicitly so `/voice-rx/logs` only
    # sees Voice Rx rows even when the caller can access multiple apps.
    scoped_app_ids: frozenset[str] | None = frozenset(auth.app_access)
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        scoped_app_ids = None

    # When the caller filters by workflow, app-gate via that workflow and reject
    # mismatched explicit `appId` so cross-app bookmarks 404 cleanly.
    if workflow_id is not None:
        wf = await _load_and_gate_workflow(
            db, auth, workflow_id, require_active=False, action="read",
        )
        if app_id is not None and wf.app_id != app_id:
            raise HTTPException(status_code=404, detail="workflow not found")
    items, total = await run_service.list_runs(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        workflow_id=workflow_id,
        app_id=app_id,
        status=status,
        limit=limit,
        offset=offset,
        app_ids=None if workflow_id is not None else scoped_app_ids,
    )
    return RunListResponse(
        runs=[RunResponse.model_validate(r) for r in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/actions", response_model=WorkflowActionListResponse)
async def list_workflow_actions_global(
    workflow_id: Optional[uuid.UUID] = Query(None, alias="workflowId"),
    app_id: Optional[str] = Query(None, alias="appId"),
    channel: Optional[str] = None,
    action_type: Optional[str] = Query(None, alias="actionType"),
    status: Optional[str] = None,
    recipient_id: Optional[str] = Query(None, alias="recipientId"),
    provider_correlation_id: Optional[str] = Query(None, alias="providerCorrelationId"),
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Tenant-wide outbound action log — feeds the platform Logs page's
    "Workflow actions" tab. App-gated via the caller's ``app_access`` set so a
    tenant admin without app A's grant can't see app A's actions; when
    ``workflow_id`` is supplied, gate via that workflow's app instead (mirrors
    the ``/runs`` listing pattern)."""
    scoped_app_ids: frozenset[str] | None = frozenset(auth.app_access)
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        scoped_app_ids = None
    if workflow_id is not None:
        wf = await _load_and_gate_workflow(
            db, auth, workflow_id, require_active=False, action="read",
        )
        if app_id is not None and wf.app_id != app_id:
            raise HTTPException(status_code=404, detail="workflow not found")
    items, total = await run_service.list_actions_global(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_ids=None if workflow_id is not None else scoped_app_ids,
        app_id=app_id,
        workflow_id=workflow_id,
        channel=channel,
        action_type=action_type,
        status=status,
        recipient_id=recipient_id,
        provider_correlation_id=provider_correlation_id,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    return WorkflowActionListResponse(
        items=[WorkflowActionGlobalRow.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(
    run_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    return await _load_and_gate_run(db, auth, run_id)


@router.get("/runs/{run_id}/overlay", response_model=RunOverlaySnapshotResponse)
async def get_run_overlay(
    run_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    run = await _load_and_gate_run(db, auth, run_id)
    node_steps = await run_service.list_latest_node_steps(
        db, tenant_id=auth.tenant_id, run_id=run_id,
    )
    return RunOverlaySnapshotResponse(
        run=RunResponse.model_validate(run),
        node_steps=[RunNodeStepResponse.model_validate(step) for step in node_steps],
    )


@router.get("/runs/{run_id}/recipients", response_model=list[RecipientStateResponse])
async def list_run_recipients(
    run_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_run(db, auth, run_id)
    return await run_service.list_recipients(
        db, tenant_id=auth.tenant_id, run_id=run_id, limit=limit, offset=offset,
    )


@router.get("/runs/{run_id}/actions", response_model=list[ActionResponse])
async def list_run_actions(
    run_id: uuid.UUID,
    channel: Optional[str] = None,
    action_type: Optional[str] = Query(None, alias="actionType"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_run(db, auth, run_id)
    return await run_service.list_actions(
        db, tenant_id=auth.tenant_id, run_id=run_id,
        channel=channel, action_type=action_type, limit=limit, offset=offset,
    )


@router.get("/runs/{run_id}/actions/{action_id}", response_model=ActionResponse)
async def get_run_action(
    run_id: uuid.UUID,
    action_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_run(db, auth, run_id)
    action = await run_service.get_action(
        db,
        tenant_id=auth.tenant_id,
        run_id=run_id,
        action_id=action_id,
    )
    if action is None:
        raise HTTPException(status_code=404, detail="action not found")
    return action


@router.post("/runs/{run_id}/cancel", status_code=204)
async def cancel_run(
    run_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    run = await _load_and_gate_run(db, auth, run_id)
    await _load_and_gate_workflow(db, auth, run.workflow_id, action="edit")
    if not await run_service.cancel_run(db, tenant_id=auth.tenant_id, run_id=run_id):
        raise HTTPException(status_code=404, detail="run not found")
    return Response(status_code=204)


@router.post(
    "/runs/{run_id}/recipients/{recipient_id}/override",
    response_model=OverrideResponse,
    status_code=201,
)
async def override_recipient(
    run_id: uuid.UUID,
    recipient_id: str,
    body: OverrideRequest,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    run = await _load_and_gate_run(db, auth, run_id)
    await _load_and_gate_workflow(db, auth, run.workflow_id, action="edit")
    ov = await run_service.apply_override(
        db, tenant_id=auth.tenant_id, run_id=run_id, recipient_id=recipient_id,
        action=body.action, target_node_id=body.target_node_id,
        reason=body.reason, applied_by=auth.user_id,
    )
    if ov is None:
        raise HTTPException(status_code=404, detail="run not found")
    return ov


# ─── Action templates ───────────────────────────────────────────────────────


@router.get("/action_templates", response_model=list[ActionTemplateResponse])
async def list_action_templates(
    app_id: Optional[str] = Query(None, alias="appId"),
    channel: Optional[str] = None,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
    return await tmpl_service.list_templates(
        db, tenant_id=auth.tenant_id, app_id=app_id, channel=channel,
    )


@router.post("/action_templates", response_model=ActionTemplateResponse)
async def upsert_action_template(
    body: ActionTemplateUpsertRequest,
    app_id: str = Query(..., alias="appId"),
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, app_id)
    return await tmpl_service.upsert_tenant_template(
        db, tenant_id=auth.tenant_id, app_id=app_id,
        channel=body.channel, slug=body.slug, name=body.name,
        payload_schema=body.payload_schema, active=body.active,
    )


# ─── Consent ────────────────────────────────────────────────────────────────


@router.get("/consent/{recipient_id}", response_model=list[ConsentResponse])
async def get_consent(
    recipient_id: str,
    app_id: str = Query(..., alias="appId"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, app_id)
    return await consent_service.get_recipient_consent(
        db, tenant_id=auth.tenant_id, app_id=app_id, recipient_id=recipient_id,
    )


@router.post("/consent", response_model=ConsentResponse, status_code=201)
async def set_consent(
    body: ConsentSetRequest,
    app_id: str = Query(..., alias="appId"),
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, app_id)
    return await consent_service.set_consent(
        db, tenant_id=auth.tenant_id, app_id=app_id,
        recipient_id=body.recipient_id, channel=body.channel,
        status=body.status, source=body.source, evidence=body.evidence,
    )


# ─── Node-type catalog (palette) ───────────────────────────────────────────


@router.get("/node_types", response_model=list[NodeTypeDescriptor])
async def get_node_types(
    workflow_type: Optional[str] = Query(None, alias="workflowType"),
    auth: AuthContext = Depends(get_auth_context),
):
    return list_node_types(workflow_type=workflow_type)


@router.get("/source_catalog", response_model=list[CohortSourceResponse])
async def get_source_catalog(
    workflow_type: Optional[str] = Query(None, alias="workflowType"),
    app_id: Optional[str] = Query(None, alias="appId"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Phase 11 (Commit 2) — registered cohort sources for the SourceSelector editor.

    Engineering-owned static catalog plus tenant-owned dataset versions
    (Phase 12). Each entry carries a ``kind`` discriminator (``"static"``
    vs ``"dataset"``); the underlying schema-qualified table is never
    surfaced. Dataset entries are tenant-scoped via ``auth.tenant_id``.
    """
    scoped_app_ids: list[str] | None = None
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
    else:
        scoped_app_ids = sorted(auth.app_access)
    return await list_cohort_sources(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        workflow_type=workflow_type,
        app_id=app_id,
        app_ids=scoped_app_ids,
    )
