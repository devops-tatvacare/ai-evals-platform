"""NodeContext — the only surface a node handler reads.

Handlers MUST NOT import the DB session, services, or job worker directly.
Everything they need is on ctx. This is the seam that makes handlers testable
in isolation (substitute fakes via ServiceRegistry) and prevents creep.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.idempotency import idempotency_key as _gen_idempotency_key
from app.services.orchestration.node_protocol import ActionDispatch, ActionResult


@dataclass
class ServiceRegistry:
    """Holds per-channel service clients. Phase 3 populates wati/bolna/lsq."""
    wati: Any = None
    bolna: Any = None
    lsq: Any = None
    sms: Any = None
    email: Any = None
    webhook: Any = None


@dataclass
class NodeContext:
    """Per-node-execution context handed to handler.execute()."""

    db: AsyncSession
    tenant_id: uuid.UUID
    app_id: str
    workflow_id: uuid.UUID
    workflow_version_id: uuid.UUID
    run_id: uuid.UUID
    node_step_id: uuid.UUID
    current_node_id: str
    services: ServiceRegistry
    job_id: Optional[uuid.UUID]

    def idempotency_key(self, recipient_id: str, *parts: str) -> str:
        return _gen_idempotency_key(
            self.workflow_version_id, self.current_node_id, recipient_id, *parts
        )

    async def dispatch_actions(self, actions: list[ActionDispatch]) -> list[ActionResult]:
        """Insert action rows with ON CONFLICT DO NOTHING on (tenant_id, recipient_id, idempotency_key)."""
        if not actions:
            return []

        results: list[ActionResult] = []
        for action in actions:
            row_id = uuid.uuid4()
            stmt = pg_insert(WorkflowRunRecipientAction).values(
                id=row_id,
                tenant_id=self.tenant_id,
                app_id=self.app_id,
                workflow_id=self.workflow_id,
                workflow_version_id=self.workflow_version_id,
                run_id=self.run_id,
                node_step_id=self.node_step_id,
                recipient_id=action.recipient_id,
                channel=action.channel,
                action_type=action.action_type,
                status="pending",
                idempotency_key=action.idempotency_key,
                payload=action.payload,
                parent_action_id=uuid.UUID(action.parent_action_id) if action.parent_action_id else None,
            ).on_conflict_do_nothing(
                constraint="uq_workflow_run_recipient_actions_idempotency"
            ).returning(WorkflowRunRecipientAction.id, WorkflowRunRecipientAction.status)

            res = await self.db.execute(stmt)
            row = res.first()
            if row is None:
                # Conflict — re-fetch the existing action to report its current state.
                existing = await self.db.execute(
                    select(
                        WorkflowRunRecipientAction.id,
                        WorkflowRunRecipientAction.status,
                        WorkflowRunRecipientAction.response,
                        WorkflowRunRecipientAction.error,
                    ).where(
                        WorkflowRunRecipientAction.tenant_id == self.tenant_id,
                        WorkflowRunRecipientAction.recipient_id == action.recipient_id,
                        WorkflowRunRecipientAction.idempotency_key == action.idempotency_key,
                    )
                )
                ex = existing.first()
                assert ex is not None, "ON CONFLICT row vanished — concurrent delete?"
                results.append(ActionResult(
                    recipient_id=action.recipient_id,
                    action_id=str(ex[0]),
                    status=ex[1],
                    response=ex[2],
                    error=ex[3],
                ))
            else:
                results.append(ActionResult(
                    recipient_id=action.recipient_id,
                    action_id=str(row[0]),
                    status=row[1],
                ))

        await self.db.flush()
        return results

    async def update_action_result(
        self,
        action_id: str,
        *,
        status: str,
        response: Optional[dict[str, Any]] = None,
        error: Optional[str] = None,
    ) -> None:
        """Used by handlers after the provider call completes to mark the action success/failed."""
        await self.db.execute(
            update(WorkflowRunRecipientAction)
            .where(WorkflowRunRecipientAction.id == uuid.UUID(action_id))
            .values(
                status=status,
                response=response,
                error=error,
                completed_at=datetime.now(timezone.utc),
            )
        )
        await self.db.flush()

    async def set_recipient_state(
        self,
        recipient_id: str,
        *,
        status: str,
        wakeup_at: Optional[datetime] = None,
        current_node_id: Optional[str] = None,
        payload_delta: Optional[dict[str, Any]] = None,
        completed_at: Optional[datetime] = None,
        error: Optional[str] = None,
    ) -> None:
        """UPDATE workflow_run_recipient_states for one recipient in this run."""
        values: dict[str, Any] = {"status": status}
        if wakeup_at is not None:
            values["wakeup_at"] = wakeup_at
        if current_node_id is not None:
            values["current_node_id"] = current_node_id
        if completed_at is not None:
            values["completed_at"] = completed_at
        if error is not None:
            values["error"] = error
        await self.db.execute(
            update(WorkflowRunRecipientState)
            .where(
                WorkflowRunRecipientState.run_id == self.run_id,
                WorkflowRunRecipientState.recipient_id == recipient_id,
            )
            .values(**values)
        )
        if payload_delta:
            await self.db.execute(
                update(WorkflowRunRecipientState)
                .where(
                    WorkflowRunRecipientState.run_id == self.run_id,
                    WorkflowRunRecipientState.recipient_id == recipient_id,
                )
                .values(payload=WorkflowRunRecipientState.payload.op("||")(payload_delta))
            )
        await self.db.flush()

    async def is_cancelled(self) -> bool:
        """Mirrors job_worker.is_job_cancelled. Returns False when job_id is None (test mode)."""
        if self.job_id is None:
            return False
        from app.services.job_worker import is_job_cancelled
        return await is_job_cancelled(str(self.job_id), self.tenant_id)
