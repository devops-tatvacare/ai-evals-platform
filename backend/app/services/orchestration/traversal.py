"""RunExecutor — walks a workflow_version definition for one run.

Loop: load 'ready' recipients → group by current_node_id → for each node,
honour overrides → dispatch handler with cohort → process NodeResult →
advance recipients to next node along the matching output edge → repeat
until no 'ready' recipients remain.

Suspended nodes (Wait/event) leave their recipients in 'waiting'.
The resume poller flips them to 'ready' later (Phase 4).
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    Workflow,
    WorkflowRun,
    WorkflowRunNodeStep,
    WorkflowRunRecipientOverride,
    WorkflowRunRecipientState,
    WorkflowVersion,
)
from app.services.orchestration.cohort_stream import CohortStream
from app.services.orchestration.definition_normalizer import normalize_definition
from app.services.orchestration.node_context import NodeContext, ServiceRegistry
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import resolve_handler
from app.services.orchestration.sse_publisher import publish_event


class RunExecutor:
    """Executes one workflow run to quiescence (no more 'ready' recipients)."""

    def __init__(
        self,
        *,
        db: AsyncSession,
        run: WorkflowRun,
        version: WorkflowVersion,
        workflow: Workflow,
        job_id: Optional[uuid.UUID],
        services: Optional[ServiceRegistry] = None,
        connections: Optional[Any] = None,
    ) -> None:
        self.db = db
        self.run = run
        self.version = version
        self.workflow = workflow
        self.job_id = job_id
        self.services = services or ServiceRegistry()
        self.connections = connections

        # Normalize on read so older saved definitions (legacy ``label``
        # edges, source ``next_node_id``, label-keyed split branches, etc.)
        # execute under the canonical Phase 11 contract without forcing an
        # operator re-publish.
        canonical = normalize_definition(version.definition)
        nodes = canonical.get("nodes", [])
        edges = canonical.get("edges", [])
        self._nodes_by_id: dict[str, dict[str, Any]] = {n["id"]: n for n in nodes}
        # edge_index[source_node_id][output_id] -> [target_node_id, ...]
        self._edge_index: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
        for e in edges:
            output_id = e.get("output_id") or e.get("label") or "default"
            self._edge_index[e["source"]][output_id].append(e["target"])

    async def run_until_quiescent(self, max_iterations: int = 1000) -> None:
        """Loop until no recipients are in 'ready' status. Safety bound to prevent infinite loops."""
        for _ in range(max_iterations):
            if self.job_id is not None:
                from app.services.job_worker import is_job_cancelled
                if await is_job_cancelled(str(self.job_id), self.run.tenant_id):
                    return
            grouped = await self._load_ready_grouped_by_node()
            if not grouped:
                return
            for node_id, recipient_ids in grouped.items():
                await self._execute_node(node_id, recipient_ids)
        raise RuntimeError(f"run_until_quiescent exceeded {max_iterations} iterations — possible cycle")

    async def _load_ready_grouped_by_node(self) -> dict[str, list[str]]:
        stmt = select(
            WorkflowRunRecipientState.recipient_id,
            WorkflowRunRecipientState.current_node_id,
        ).where(
            WorkflowRunRecipientState.run_id == self.run.id,
            WorkflowRunRecipientState.status == "ready",
        )
        result = await self.db.execute(stmt)
        grouped: dict[str, list[str]] = defaultdict(list)
        for rid, nid in result.all():
            if nid is None:
                continue
            grouped[nid].append(rid)
        return grouped

    async def _execute_node(self, node_id: str, recipient_ids: list[str]) -> None:
        """Execute one node for a batch of recipients arriving at it."""
        node = self._nodes_by_id.get(node_id)
        if node is None:
            raise RuntimeError(f"node {node_id!r} not found in workflow_version.definition")

        await self._apply_overrides(recipient_ids)
        cohort_payloads = await self._load_recipient_payloads(recipient_ids, only_status="ready")
        if not cohort_payloads:
            return

        node_step_id = uuid.uuid4()
        started = datetime.now(timezone.utc)
        node_step = WorkflowRunNodeStep(
            id=node_step_id,
            tenant_id=self.run.tenant_id,
            app_id=self.run.app_id,
            workflow_id=self.workflow.id,
            workflow_version_id=self.version.id,
            run_id=self.run.id,
            node_id=node_id,
            node_type=node["type"],
            status="running",
            inputs_summary={"cohort_size": len(cohort_payloads)},
            started_at=started,
        )
        self.db.add(node_step)
        await self.db.flush()

        await publish_event(
            run_id=self.run.id,
            event={
                "type": "node_step.started",
                "node_step_id": str(node_step_id),
                "node_id": node_id,
                "node_type": node["type"],
                "input_cohort_size": len(cohort_payloads),
            },
        )

        # Mark recipients 'running' so a concurrent worker tick doesn't pick them up.
        await self.db.execute(
            update(WorkflowRunRecipientState)
            .where(
                WorkflowRunRecipientState.run_id == self.run.id,
                WorkflowRunRecipientState.recipient_id.in_([r for r, _ in cohort_payloads]),
            )
            .values(status="running")
        )
        await self.db.flush()

        handler = resolve_handler(workflow_type=self.workflow.workflow_type, node_type=node["type"])
        config_obj = handler.config_schema(**(node.get("config") or {}))
        ctx = NodeContext(
            db=self.db,
            tenant_id=self.run.tenant_id,
            app_id=self.run.app_id,
            workflow_id=self.workflow.id,
            workflow_version_id=self.version.id,
            run_id=self.run.id,
            node_step_id=node_step_id,
            current_node_id=node_id,
            services=self.services,
            job_id=self.job_id,
            connections=self.connections,
            outgoing_targets={k: list(v) for k, v in self._edge_index.get(node_id, {}).items()},
        )
        cohort_stream = CohortStream(cohort_payloads)

        try:
            result: NodeResult = await handler.execute(cohort_stream, config_obj, ctx)
        except Exception as exc:
            node_step.status = "failed"
            node_step.error = repr(exc)
            node_step.completed_at = datetime.now(timezone.utc)
            await self.db.execute(
                update(WorkflowRunRecipientState)
                .where(
                    WorkflowRunRecipientState.run_id == self.run.id,
                    WorkflowRunRecipientState.recipient_id.in_([r for r, _ in cohort_payloads]),
                )
                .values(status="failed", error=repr(exc))
            )
            await self.db.flush()
            await publish_event(
                run_id=self.run.id,
                event={
                    "type": "node_step.failed",
                    "node_step_id": str(node_step_id),
                    "node_id": node_id,
                    "error": repr(exc),
                },
            )
            raise

        await self._advance_recipients(node_id, result, cohort_payloads)
        node_step.status = "completed"
        node_step.outputs_summary = {
            "by_output_id": {
                output_id: len(outcomes)
                for output_id, outcomes in result.by_output_id.items()
            },
            "suspended": result.suspended,
            **result.summary,
        }
        node_step.completed_at = datetime.now(timezone.utc)
        await self.db.flush()
        await publish_event(
            run_id=self.run.id,
            event={
                "type": "node_step.completed",
                "node_step_id": str(node_step_id),
                "node_id": node_id,
                "outputs_summary": node_step.outputs_summary,
            },
        )

    async def _apply_overrides(self, recipient_ids: list[str]) -> None:
        """Honour latest unconsumed override per (run_id, recipient_id)."""
        stmt = select(WorkflowRunRecipientOverride).where(
            WorkflowRunRecipientOverride.run_id == self.run.id,
            WorkflowRunRecipientOverride.recipient_id.in_(recipient_ids),
            WorkflowRunRecipientOverride.consumed_at.is_(None),
        ).order_by(WorkflowRunRecipientOverride.applied_at.desc())
        result = await self.db.execute(stmt)
        seen: set[str] = set()
        for ov in result.scalars().all():
            if ov.recipient_id in seen:
                continue
            seen.add(ov.recipient_id)
            await self._honour_override(ov)

    async def _honour_override(self, ov: WorkflowRunRecipientOverride) -> None:
        now = datetime.now(timezone.utc)
        if ov.action == "pause":
            await self.db.execute(
                update(WorkflowRunRecipientState)
                .where(
                    WorkflowRunRecipientState.run_id == ov.run_id,
                    WorkflowRunRecipientState.recipient_id == ov.recipient_id,
                )
                .values(status="overridden")
            )
        elif ov.action == "resume":
            await self.db.execute(
                update(WorkflowRunRecipientState)
                .where(
                    WorkflowRunRecipientState.run_id == ov.run_id,
                    WorkflowRunRecipientState.recipient_id == ov.recipient_id,
                )
                .values(status="ready")
            )
        elif ov.action == "jump_to_node":
            await self.db.execute(
                update(WorkflowRunRecipientState)
                .where(
                    WorkflowRunRecipientState.run_id == ov.run_id,
                    WorkflowRunRecipientState.recipient_id == ov.recipient_id,
                )
                .values(status="ready", current_node_id=ov.target_node_id)
            )
        elif ov.action == "remove":
            await self.db.execute(
                update(WorkflowRunRecipientState)
                .where(
                    WorkflowRunRecipientState.run_id == ov.run_id,
                    WorkflowRunRecipientState.recipient_id == ov.recipient_id,
                )
                .values(status="skipped", completed_at=now)
            )
        elif ov.action == "complete":
            await self.db.execute(
                update(WorkflowRunRecipientState)
                .where(
                    WorkflowRunRecipientState.run_id == ov.run_id,
                    WorkflowRunRecipientState.recipient_id == ov.recipient_id,
                )
                .values(status="completed", completed_at=now)
            )
        ov.consumed_at = now
        await self.db.flush()

    async def _load_recipient_payloads(
        self, recipient_ids: list[str], only_status: Optional[str] = None
    ) -> list[tuple[str, dict[str, Any]]]:
        stmt = select(
            WorkflowRunRecipientState.recipient_id,
            WorkflowRunRecipientState.payload,
        ).where(
            WorkflowRunRecipientState.run_id == self.run.id,
            WorkflowRunRecipientState.recipient_id.in_(recipient_ids),
        )
        if only_status:
            stmt = stmt.where(WorkflowRunRecipientState.status == only_status)
        result = await self.db.execute(stmt)
        return [(rid, payload or {}) for rid, payload in result.all()]

    async def _advance_recipients(
        self,
        from_node_id: str,
        result: NodeResult,
        cohort_payloads: list[tuple[str, dict[str, Any]]],
    ) -> None:
        """For each emitted output_id, set current_node_id on recipients to the target node.

        If the node is suspended (Wait), the handler has already set status='waiting' on the
        recipients via ctx.set_recipient_state — we leave them.

        If a recipient appears in NO output bucket, they're dropped from the workflow as 'skipped'.
        """
        if result.suspended:
            return

        payload_lookup = {r: p for r, p in cohort_payloads}
        all_outcome_recipients: set[str] = set()
        for output_id, outcomes in result.by_output_id.items():
            targets = self._edge_index.get(from_node_id, {}).get(output_id, [])
            for outcome in outcomes:
                all_outcome_recipients.add(outcome.recipient_id)
                merged_payload = {
                    **payload_lookup.get(outcome.recipient_id, {}),
                    **outcome.payload_delta,
                }
                if not targets:
                    # No outgoing edge — terminal for this branch.
                    await self.db.execute(
                        update(WorkflowRunRecipientState)
                        .where(
                            WorkflowRunRecipientState.run_id == self.run.id,
                            WorkflowRunRecipientState.recipient_id == outcome.recipient_id,
                        )
                        .values(
                            status="completed",
                            completed_at=datetime.now(timezone.utc),
                            current_node_id=None,
                            payload=merged_payload,
                        )
                    )
                else:
                    target = targets[0]
                    update_values: dict[str, Any] = {
                        "status": "ready",
                        "current_node_id": target,
                        "payload": merged_payload,
                    }
                    await self.db.execute(
                        update(WorkflowRunRecipientState)
                        .where(
                            WorkflowRunRecipientState.run_id == self.run.id,
                            WorkflowRunRecipientState.recipient_id == outcome.recipient_id,
                        )
                        .values(**update_values)
                    )

        # Recipients in the input cohort but missing from all output edges → 'skipped'.
        # Only flip recipients still in 'running' — if a handler set its own terminal
        # state (e.g. sink.complete writes 'completed' directly), don't clobber it.
        input_recipients = {rid for rid, _ in cohort_payloads}
        unhandled = input_recipients - all_outcome_recipients
        if unhandled:
            await self.db.execute(
                update(WorkflowRunRecipientState)
                .where(
                    WorkflowRunRecipientState.run_id == self.run.id,
                    WorkflowRunRecipientState.recipient_id.in_(unhandled),
                    WorkflowRunRecipientState.status == "running",
                )
                .values(status="skipped", completed_at=datetime.now(timezone.utc))
            )
        await self.db.flush()
