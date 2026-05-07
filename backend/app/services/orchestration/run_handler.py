"""run-workflow job handler.

Two modes:
  - entry: kick a fresh run by executing source nodes
  - resume: continue an in-flight run for a named set of recipients
            (used by resume-waiting-cohorts in Phase 4)

Handles cancellation, error capture, and run-row state transitions.

The repo's job-handler signature is (job_id, params, *, tenant_id, user_id) → dict.
The inner `run_workflow_job(run_id, db, params, job_id, tenant_id)` is what tests
call directly; the @register_job_handler wrapper in job_worker.py opens the
session and calls it. ``tenant_id`` is required so internal load helpers cannot
reach across tenants if a misrouted/forged job carried a foreign run_id.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    Workflow,
    WorkflowRun,
    WorkflowRunNodeStep,
    WorkflowRunRecipientState,
    WorkflowVersion,
)
from app.services.orchestration.cohort_stream import CohortStream
from app.services.orchestration.connections.resolver import ConnectionResolver
from app.services.orchestration.node_context import NodeContext, ServiceRegistry
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import resolve_handler
from app.services.orchestration.sse_publisher import publish_event
from app.services.orchestration.traversal import RunExecutor

_log = logging.getLogger(__name__)


async def run_workflow_job(
    run_id: uuid.UUID,
    db: AsyncSession,
    params: Optional[dict[str, Any]] = None,
    job_id: Optional[uuid.UUID] = None,
    tenant_id: Optional[uuid.UUID] = None,
) -> dict[str, Any]:
    """Execute one workflow run to quiescence (or until suspended).

    Test-facing entry point. Production callers go through the job_worker
    @register_job_handler wrapper which opens its own session and forwards
    ``tenant_id`` from the BackgroundJob row.

    When ``tenant_id`` is supplied, every internal load is filtered by both ID
    and tenant — a misrouted job for tenant A pointing at a run owned by tenant
    B returns ``status='not_found'`` instead of executing.
    """
    params = params or {}
    run = await _load_run(db, run_id, tenant_id=tenant_id)
    if run is None:
        _log.warning("run-workflow: run %s not found (tenant=%s)", run_id, tenant_id)
        return {"status": "not_found"}

    # Effective tenant for downstream loads — prefer caller-supplied for
    # cross-tenant guarding; fall back to the run's own tenant when called
    # without one (legacy test-only paths).
    effective_tenant = tenant_id if tenant_id is not None else run.tenant_id

    if run.status in ("completed", "cancelled", "failed"):
        _log.info("run-workflow: run %s already terminal (status=%s); skipping", run_id, run.status)
        return {"status": run.status, "skipped": True}

    workflow = await _load_workflow(db, run.workflow_id, tenant_id=effective_tenant)
    version = await _load_version(
        db, run.workflow_version_id, tenant_id=effective_tenant, workflow_id=run.workflow_id,
    )
    if workflow is None or version is None:
        _log.warning(
            "run-workflow: workflow/version not found (run=%s tenant=%s)",
            run_id, effective_tenant,
        )
        return {"status": "not_found"}

    if run.status == "pending":
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        if job_id is not None:
            run.job_id = job_id
        await db.flush()
        await publish_event(
            run_id=run.id, event={"type": "run.started", "run_id": str(run.id)},
        )

    services = _build_service_registry()
    connections = ConnectionResolver(
        db, tenant_id=run.tenant_id, app_id=run.app_id,
    )
    executor = RunExecutor(
        db=db, run=run, version=version, workflow=workflow,
        job_id=job_id, services=services, connections=connections,
    )

    try:
        if params.get("resume_recipient_ids"):
            ids = params["resume_recipient_ids"]
            await _mark_resume_ready(db, run.id, ids)
        else:
            await _execute_source_nodes(executor)

        await executor.run_until_quiescent()
        await _maybe_complete_run(db, run)

    except Exception as exc:
        # Persist the failed status in its own committed transaction so it
        # survives the outer re-raise. Without this nested commit, the
        # run-failure write rides the outer session that gets rolled back
        # by the worker's exception path, leaving runs stuck in 'running'
        # forever. The run-step repair runs in the same nested transaction.
        _log.exception("run-workflow: run %s failed", run_id)
        try:
            await _persist_failed_run(db, run_id, repr(exc))
        except Exception:
            _log.exception("run-workflow: failed to persist failure status for %s", run_id)
        await publish_event(
            run_id=run.id,
            event={"type": "run.failed", "run_id": str(run.id), "error": repr(exc)},
        )
        raise

    await publish_event(
        run_id=run.id,
        event={"type": "run.completed", "run_id": str(run.id), "status": run.status},
    )
    return {"status": run.status, "run_id": str(run.id)}


async def _persist_failed_run(
    db: AsyncSession, run_id: uuid.UUID, error_repr: str,
) -> None:
    """Mark the run + any still-running node steps as failed in a NESTED tx.

    Using a SAVEPOINT means the failed-status write commits even when the
    surrounding session is rolled back by the worker's outer exception path.
    """
    failed_at = datetime.now(timezone.utc)
    async with db.begin_nested():
        await db.execute(
            update(WorkflowRun)
            .where(
                WorkflowRun.id == run_id,
                WorkflowRun.status.in_(("pending", "running", "waiting")),
            )
            .values(status="failed", error=error_repr, completed_at=failed_at)
        )
        await db.execute(
            update(WorkflowRunNodeStep)
            .where(
                WorkflowRunNodeStep.run_id == run_id,
                WorkflowRunNodeStep.status == "running",
            )
            .values(status="failed", completed_at=failed_at)
        )


async def _load_run(
    db: AsyncSession,
    run_id: uuid.UUID,
    *,
    tenant_id: Optional[uuid.UUID] = None,
) -> WorkflowRun | None:
    stmt = select(WorkflowRun).where(WorkflowRun.id == run_id)
    if tenant_id is not None:
        stmt = stmt.where(WorkflowRun.tenant_id == tenant_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def _load_workflow(
    db: AsyncSession,
    workflow_id: uuid.UUID,
    *,
    tenant_id: Optional[uuid.UUID] = None,
) -> Optional[Workflow]:
    stmt = select(Workflow).where(Workflow.id == workflow_id)
    if tenant_id is not None:
        stmt = stmt.where(Workflow.tenant_id == tenant_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def _load_version(
    db: AsyncSession,
    version_id: uuid.UUID,
    *,
    tenant_id: Optional[uuid.UUID] = None,
    workflow_id: Optional[uuid.UUID] = None,
) -> Optional[WorkflowVersion]:
    """Load a workflow version, optionally restricted to (tenant_id, workflow_id).

    ``WorkflowVersion`` itself doesn't carry tenant_id; we enforce tenancy via a
    JOIN on the parent ``Workflow`` row's tenant_id.
    """
    stmt = select(WorkflowVersion).where(WorkflowVersion.id == version_id)
    if workflow_id is not None:
        stmt = stmt.where(WorkflowVersion.workflow_id == workflow_id)
    if tenant_id is not None:
        stmt = stmt.join(Workflow, Workflow.id == WorkflowVersion.workflow_id).where(
            Workflow.tenant_id == tenant_id
        )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _mark_resume_ready(db: AsyncSession, run_id: uuid.UUID, recipient_ids: list[str]) -> None:
    """Flip the named recipients from 'waiting' to 'ready' so traversal picks them up."""
    await db.execute(
        update(WorkflowRunRecipientState)
        .where(
            WorkflowRunRecipientState.run_id == run_id,
            WorkflowRunRecipientState.recipient_id.in_(recipient_ids),
            WorkflowRunRecipientState.status.in_(("waiting", "ready")),
        )
        .values(status="ready", wakeup_at=None)
    )
    await db.flush()


async def _execute_source_nodes(executor: RunExecutor) -> None:
    """Source nodes have no input edges; identify by 'no incoming edge' in the definition."""
    nodes = executor.version.definition.get("nodes", [])
    edges = executor.version.definition.get("edges", [])
    targets = {e["target"] for e in edges}
    source_nodes = [n for n in nodes if n["id"] not in targets]

    for node in source_nodes:
        handler = resolve_handler(workflow_type=executor.workflow.workflow_type, node_type=node["type"])
        config = handler.config_schema(**(node.get("config") or {}))
        node_step_id = uuid.uuid4()
        step = WorkflowRunNodeStep(
            id=node_step_id,
            tenant_id=executor.run.tenant_id, app_id=executor.run.app_id,
            workflow_id=executor.workflow.id, workflow_version_id=executor.version.id,
            run_id=executor.run.id, node_id=node["id"], node_type=node["type"],
            status="running", inputs_summary={"cohort_size": 0},
            started_at=datetime.now(timezone.utc),
        )
        executor.db.add(step)
        await executor.db.flush()

        ctx = NodeContext(
            db=executor.db, tenant_id=executor.run.tenant_id, app_id=executor.run.app_id,
            workflow_id=executor.workflow.id, workflow_version_id=executor.version.id,
            run_id=executor.run.id, node_step_id=node_step_id, current_node_id=node["id"],
            services=executor.services, job_id=executor.job_id,
            connections=executor.connections,
            outgoing_targets={
                k: list(v) for k, v in executor._edge_index.get(node["id"], {}).items()
            },
        )
        empty_cohort = CohortStream([])
        result: NodeResult = await handler.execute(empty_cohort, config, ctx)
        step.status = "completed"
        step.outputs_summary = {"summary": result.summary, "suspended": result.suspended}
        step.completed_at = datetime.now(timezone.utc)
        await executor.db.flush()


async def _maybe_complete_run(db: AsyncSession, run: WorkflowRun) -> None:
    """If no recipients remain in pending/running/ready/waiting, mark the run complete."""
    res = await db.execute(
        select(WorkflowRunRecipientState.status)
        .where(
            WorkflowRunRecipientState.run_id == run.id,
            WorkflowRunRecipientState.status.in_(("pending", "running", "ready", "waiting")),
        ).limit(1)
    )
    if res.first() is None:
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
    else:
        run.status = "waiting"
    await db.flush()


def _build_service_registry() -> ServiceRegistry:
    """Wires real channel services from settings (WATI / Bolna / LSQ / SMS)."""
    from app.services.orchestration.integrations import build_service_registry
    return build_service_registry()
