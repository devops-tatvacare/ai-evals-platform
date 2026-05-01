"""Orchestration API routes (auth-required).

All routes require a Bearer token via ``Depends(get_auth_context)``. Public
webhooks live in ``orchestration_webhooks.py`` (Phase 4).

Routes that accept ``app_id`` also enforce registered-app access via
``ensure_registered_app_access``. Run-scoped routes load the run first and
then app-gate using ``run.app_id``.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.database import get_db
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
    RunResponse,
    TriggerCreateRequest,
    TriggerUpdateRequest,
    TriggerResponse,
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


router = APIRouter(prefix="/api/orchestration", tags=["orchestration"])


# ─── Workflows ───────────────────────────────────────────────────────────────


@router.post("/workflows", response_model=WorkflowResponse, status_code=201)
async def create_workflow(
    body: WorkflowCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, body.app_id)
    try:
        wf = await wf_service.create_workflow(
            db, tenant_id=auth.tenant_id, app_id=body.app_id,
            workflow_type=body.workflow_type, slug=body.slug,
            name=body.name, description=body.description,
            created_by=auth.user_id,
        )
    except wf_service.WorkflowConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return wf


async def _load_and_gate_workflow(db: AsyncSession, auth: AuthContext, workflow_id: uuid.UUID):
    """Load a workflow scoped to ``auth.tenant_id`` and verify the caller has
    access to its ``app_id``. Returns the workflow or raises HTTPException(404)."""
    wf = await wf_service.get_workflow(db, tenant_id=auth.tenant_id, workflow_id=workflow_id)
    if wf is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    await ensure_registered_app_access(db, auth, wf.app_id)
    return wf


@router.get("/workflows", response_model=list[WorkflowResponse])
async def list_workflows(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    app_id: Optional[str] = Query(None, alias="appId"),
    workflow_type: Optional[str] = Query(None, alias="workflowType"),
):
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        return await wf_service.list_workflows(
            db, tenant_id=auth.tenant_id, app_id=app_id, workflow_type=workflow_type,
        )
    # No explicit app filter — restrict to apps the caller can reach.
    return await wf_service.list_workflows(
        db, tenant_id=auth.tenant_id, workflow_type=workflow_type,
        app_ids=frozenset(auth.app_access),
    )


@router.get("/system-workflows", response_model=list[WorkflowResponse])
async def list_system_workflows(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    app_id: Optional[str] = Query(None, alias="appId"),
    workflow_type: Optional[str] = Query(None, alias="workflowType"),
):
    """List cloneable system-seeded workflows visible to the caller's app scope."""
    if app_id is not None:
        await ensure_registered_app_access(db, auth, app_id)
        return await wf_service.list_system_workflows(
            db, app_id=app_id, workflow_type=workflow_type,
        )
    return await wf_service.list_system_workflows(
        db, workflow_type=workflow_type, app_ids=frozenset(auth.app_access),
    )


@router.get("/workflows/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(
    workflow_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    return await _load_and_gate_workflow(db, auth, workflow_id)


@router.patch("/workflows/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(
    workflow_id: uuid.UUID,
    body: WorkflowUpdateRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id)
    wf = await wf_service.update_workflow(
        db, tenant_id=auth.tenant_id, workflow_id=workflow_id,
        name=body.name, description=body.description,
    )
    if wf is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return wf


@router.delete("/workflows/{workflow_id}", status_code=204)
async def archive_workflow(
    workflow_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id)
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
    auth: AuthContext = Depends(get_auth_context),
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
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id)
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
    await _load_and_gate_workflow(db, auth, workflow_id)
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
    await _load_and_gate_workflow(db, auth, workflow_id)
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
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id)
    try:
        v = await ver_service.publish_version(
            db, tenant_id=auth.tenant_id, workflow_id=workflow_id,
            version_id=version_id, published_by=auth.user_id,
        )
    except ver_service.VersionPublishError as exc:
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
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, workflow_id)
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
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    trig = await trig_service.get_trigger(db, tenant_id=auth.tenant_id, trigger_id=trigger_id)
    if trig is None:
        raise HTTPException(status_code=404, detail="trigger not found")
    await ensure_registered_app_access(db, auth, trig.app_id)
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
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    # Load trigger first to learn its app_id; bare delete-by-id can't gate.
    trig = await trig_service.get_trigger(db, tenant_id=auth.tenant_id, trigger_id=trigger_id)
    if trig is None:
        raise HTTPException(status_code=404, detail="trigger not found")
    await ensure_registered_app_access(db, auth, trig.app_id)
    if not await trig_service.delete_trigger(
        db, tenant_id=auth.tenant_id, trigger_id=trigger_id,
    ):
        raise HTTPException(status_code=404, detail="trigger not found")
    return Response(status_code=204)


# ─── Runs ───────────────────────────────────────────────────────────────────


@router.post("/runs", response_model=RunResponse, status_code=201)
async def fire_manual(
    body: RunCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_workflow(db, auth, body.workflow_id)
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
    await ensure_registered_app_access(db, auth, run.app_id)
    return run


@router.get("/runs", response_model=list[RunResponse])
async def list_runs(
    workflow_id: Optional[uuid.UUID] = Query(None, alias="workflowId"),
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    # When the caller filters by workflow, app-gate via that workflow.
    # Otherwise restrict to apps in the caller's app_access set so a tenant
    # admin without app A's grant can't see app A's runs.
    if workflow_id is not None:
        wf = await wf_service.get_workflow(db, tenant_id=auth.tenant_id, workflow_id=workflow_id)
        if wf is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        await ensure_registered_app_access(db, auth, wf.app_id)
    return await run_service.list_runs(
        db,
        tenant_id=auth.tenant_id,
        workflow_id=workflow_id,
        status=status,
        limit=limit,
        offset=offset,
        app_ids=None if workflow_id is not None else frozenset(auth.app_access),
    )


@router.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(
    run_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    return await _load_and_gate_run(db, auth, run_id)


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


@router.post("/runs/{run_id}/cancel", status_code=204)
async def cancel_run(
    run_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_run(db, auth, run_id)
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
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_run(db, auth, run_id)
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
    auth: AuthContext = Depends(get_auth_context),
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
    auth: AuthContext = Depends(get_auth_context),
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
):
    """Phase 11 (Commit 2) — registered cohort sources for the SourceSelector editor.

    Engineering-owned catalog; tenants don't add their own sources. The
    response carries display label, allowed payload / filter / lookback
    columns, and the id column — never the underlying schema-qualified
    table.
    """
    return list_cohort_sources(workflow_type=workflow_type, app_id=app_id)
