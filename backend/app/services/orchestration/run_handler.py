"""run-workflow job handler.

Two modes:
  - entry: kick a fresh run by executing source nodes
  - resume: continue an in-flight run for a named set of recipients
            (used by resume-waiting-cohorts in Phase 4)

Handles cancellation, error capture, and run-row state transitions.

The repo's job-handler signature is (job_id, params, *, tenant_id, user_id) → dict.
The inner `run_workflow_job(run_id, db, params, job_id)` is what tests call directly;
the @register_job_handler wrapper in job_worker.py opens the session and calls it.
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
from app.services.orchestration.node_context import NodeContext, ServiceRegistry
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import resolve_handler
from app.services.orchestration.traversal import RunExecutor

_log = logging.getLogger(__name__)


async def run_workflow_job(
    run_id: uuid.UUID,
    db: AsyncSession,
    params: Optional[dict[str, Any]] = None,
    job_id: Optional[uuid.UUID] = None,
) -> dict[str, Any]:
    """Execute one workflow run to quiescence (or until suspended).

    Test-facing entry point. Production callers go through the job_worker
    @register_job_handler wrapper which opens its own session.
    """
    params = params or {}
    run = await _load_run(db, run_id)
    if run is None:
        _log.warning("run-workflow: run %s not found", run_id)
        return {"status": "not_found"}

    if run.status in ("completed", "cancelled", "failed"):
        _log.info("run-workflow: run %s already terminal (status=%s); skipping", run_id, run.status)
        return {"status": run.status, "skipped": True}

    workflow = await _load_workflow(db, run.workflow_id)
    version = await _load_version(db, run.workflow_version_id)

    if run.status == "pending":
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        if job_id is not None:
            run.job_id = job_id
        await db.flush()

    services = _build_service_registry()
    executor = RunExecutor(
        db=db, run=run, version=version, workflow=workflow,
        job_id=job_id, services=services,
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
        _log.exception("run-workflow: run %s failed", run_id)
        run.status = "failed"
        run.error = repr(exc)
        run.completed_at = datetime.now(timezone.utc)
        await db.flush()
        raise

    return {"status": run.status, "run_id": str(run.id)}


async def _load_run(db: AsyncSession, run_id: uuid.UUID) -> WorkflowRun | None:
    res = await db.execute(select(WorkflowRun).where(WorkflowRun.id == run_id))
    return res.scalar_one_or_none()


async def _load_workflow(db: AsyncSession, workflow_id: uuid.UUID) -> Workflow:
    res = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    return res.scalar_one()


async def _load_version(db: AsyncSession, version_id: uuid.UUID) -> WorkflowVersion:
    res = await db.execute(select(WorkflowVersion).where(WorkflowVersion.id == version_id))
    return res.scalar_one()


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
    """Phase 1: empty. Phase 3 wires real channel services."""
    return ServiceRegistry()
