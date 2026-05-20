"""finalize-run-cancel inner runner: invoke provider cancels, write audits, finalise.

Outside a node context, so connections are resolved by walking each non-terminal
action's ``node_step → node_id → version.definition node → config.connection_id``,
then loaded + decrypted via the shared ``ConnectionResolver``.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    WorkflowRun,
    WorkflowRunCancelAudit,
    WorkflowRunNodeStep,
    WorkflowRunRecipientAction,
    WorkflowVersion,
)
from app.services.orchestration.adapters import (
    AdapterNotRegisteredError,
    capability_for_vendor,
    resolve_adapter,
)
from app.services.orchestration.adapters.canonical import (
    CancelDispatchOutcome,
    CancelDispatchResult,
)
from app.services.orchestration.connections.resolver import (
    ConnectionNotFound,
    ConnectionResolver,
)

_log = logging.getLogger(__name__)


async def run_finalize_run_cancel(
    db: AsyncSession, *, run_id: uuid.UUID, tenant_id: uuid.UUID,
) -> None:
    run = (
        await db.execute(
            select(WorkflowRun).where(
                WorkflowRun.id == run_id,
                WorkflowRun.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if run is None or run.cancel_finalized_at is not None:
        return

    conn_by_node = await _connection_ids_by_node(db, run)
    node_by_step = {
        step_id: node_id
        for step_id, node_id in (
            await db.execute(
                select(WorkflowRunNodeStep.id, WorkflowRunNodeStep.node_id).where(
                    WorkflowRunNodeStep.run_id == run_id
                )
            )
        ).all()
    }

    # A dispatched-but-in-flight provider call carries provider_terminal=False
    # (status='success' just means dispatch succeeded). The provider-terminal
    # flag — not the ledger status — is what marks a call still cancellable.
    actions = (
        await db.execute(
            select(WorkflowRunRecipientAction).where(
                WorkflowRunRecipientAction.run_id == run_id,
                WorkflowRunRecipientAction.provider_terminal.is_(False),
            )
        )
    ).scalars().all()

    actions_by_conn: dict[uuid.UUID, list[WorkflowRunRecipientAction]] = {}
    for action in actions:
        node_id = node_by_step.get(action.node_step_id)
        conn_id = conn_by_node.get(node_id) if node_id else None
        if conn_id is None:
            continue
        actions_by_conn.setdefault(conn_id, []).append(action)

    resolver = ConnectionResolver(db, tenant_id=tenant_id, app_id=run.app_id)
    for conn_id, conn_actions in actions_by_conn.items():
        results = await _cancel_for_connection(resolver, conn_id, conn_actions)
        for idx, result in enumerate(results):
            action = conn_actions[idx] if idx < len(conn_actions) else None
            db.add(
                WorkflowRunCancelAudit(
                    run_id=run_id,
                    tenant_id=tenant_id,
                    provider_connection_id=conn_id,
                    action_id=action.id if action else None,
                    batch_correlation_id=(
                        getattr(action, "bolna_batch_id", None) if action else None
                    ),
                    outcome=str(result.outcome),
                    provider_status_code=result.provider_status_code,
                    provider_message=result.provider_message,
                )
            )

    run.cancel_finalized_at = datetime.now(timezone.utc)
    await db.flush()


async def _connection_ids_by_node(
    db: AsyncSession, run: WorkflowRun
) -> dict[str, uuid.UUID]:
    version = (
        await db.execute(
            select(WorkflowVersion).where(
                WorkflowVersion.id == run.workflow_version_id
            )
        )
    ).scalar_one_or_none()
    if version is None:
        return {}
    out: dict[str, uuid.UUID] = {}
    for node in (version.definition or {}).get("nodes", []):
        raw = (node.get("config") or {}).get("connection_id")
        if not raw:
            continue
        try:
            out[node["id"]] = uuid.UUID(str(raw))
        except (ValueError, KeyError):
            continue
    return out


async def _cancel_for_connection(
    resolver: ConnectionResolver,
    conn_id: uuid.UUID,
    conn_actions: list[WorkflowRunRecipientAction],
) -> list[CancelDispatchResult]:
    try:
        config = await resolver.get_config(conn_id)
    except ConnectionNotFound:
        _log.warning("finalize_run_cancel.connection_missing connection_id=%s", conn_id)
        return [
            CancelDispatchResult(
                outcome=CancelDispatchOutcome.provider_error,
                provider_message="connection not found",
            )
        ]
    vendor = config.get("__provider__", "")
    capability = capability_for_vendor(vendor)
    if capability is None:
        return [
            CancelDispatchResult(
                outcome=CancelDispatchOutcome.noop_unsupported,
                provider_message=f"no adapter for vendor {vendor!r}",
            )
        ]
    try:
        adapter = resolve_adapter(capability=capability, vendor=vendor)
    except AdapterNotRegisteredError:
        return [
            CancelDispatchResult(
                outcome=CancelDispatchOutcome.noop_unsupported,
                provider_message=f"no adapter for vendor {vendor!r}",
            )
        ]
    return await adapter.cancel_run_actions(connection=config, actions=conn_actions)
