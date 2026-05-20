"""Provider-agnostic dispatch reconciler — funnels terminal events through one idempotent path."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, or_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.dispatch.bag import bag_write


async def apply_terminal_event(
    db: AsyncSession,
    *,
    action: WorkflowRunRecipientAction,
    response_patch: dict[str, Any],
    recipient_payload_patch: dict[str, Any] | None = None,
    node_id: Optional[str] = None,
    reply_context_id: Optional[str] = None,
    final_status: Optional[str] = None,
    error: Optional[str] = None,
    provider_status: Optional[str] = None,
    child_action_type: Optional[str] = None,
    child_idempotency_key: Optional[str] = None,
    child_response: Optional[dict[str, Any]] = None,
    flip_waiting_to_ready: bool = True,
) -> bool:
    """Idempotent. ``True`` if newly applied, ``False`` if ``provider_terminal`` already set.

    ``recipient_payload_patch`` is namespaced under ``steps.<node_id>.<key>`` via
    ``bag.bag_write`` when ``node_id`` is supplied — never written flat at the JSONB
    root. Adapters always supply ``node_id``; callers without it write at the root
    (legacy / non-step-scoped fields like ``last_outcome`` / ``last_event_at``).

    ``reply_context_id`` is accepted forward-declared for the messaging adapters
    landing in P2 — it overrides correlation lookup priority in handle_webhook;
    this funnel itself does not act on it.
    """
    del reply_context_id  # adapters use this on their own lookup paths; not consumed here
    if action.provider_terminal:
        return False

    # Action update — merge response, set status, mark provider_terminal.
    merged_response: dict[str, Any] = dict(action.response or {})
    merged_response.update(response_patch or {})
    update_values: dict[str, Any] = {
        "response": merged_response,
        "provider_terminal": True,
    }
    if provider_status is not None:
        update_values["provider_status"] = provider_status
    if final_status is not None:
        update_values["status"] = final_status
    if error is not None:
        update_values["error"] = error
    await db.execute(
        update(WorkflowRunRecipientAction)
        .where(WorkflowRunRecipientAction.id == action.id)
        .values(**update_values)
    )

    now = datetime.now(timezone.utc)

    # Optional audit / routing child action. ON CONFLICT keeps the
    # second invocation a no-op when the same event arrives via both
    # the webhook and the poller (which is the common case once both
    # ingress paths are live).
    if child_action_type and child_idempotency_key:
        child_response_payload = (
            child_response if child_response is not None else response_patch
        )
        # Inherit the parent's correlation handles so reporting that
        # filters on outcome rows (e.g. ``action_type='bolna_answered'``)
        # can still join to the upstream call. Without this propagation
        # the child would have ``provider_correlation_id=NULL`` and any
        # outcome-filtered query would lose the upstream link.
        inherited_payload = dict(action.payload or {})
        # Strip parent-only book-keeping; keep ``contact`` since the
        # recipient is the same and downstream readers expect it.
        inherited_payload = {
            k: v for k, v in inherited_payload.items() if k == "contact"
        }
        inherited_payload["event"] = child_action_type
        await db.execute(
            pg_insert(WorkflowRunRecipientAction)
            .values(
                id=uuid.uuid4(),
                tenant_id=action.tenant_id,
                app_id=action.app_id,
                workflow_id=action.workflow_id,
                workflow_version_id=action.workflow_version_id,
                run_id=action.run_id,
                node_step_id=action.node_step_id,
                recipient_id=action.recipient_id,
                channel=action.channel,
                action_type=child_action_type,
                status="success",
                idempotency_key=child_idempotency_key,
                payload=inherited_payload,
                response=child_response_payload,
                parent_action_id=action.id,
                # Channel-specific correlation columns (Phase 13/E.2)
                # AND channel-agnostic ``provider_correlation_id`` (0027)
                # all inherit from the parent so the child row is fully
                # joinable to the upstream provider event.
                bolna_execution_id=action.bolna_execution_id,
                bolna_batch_id=action.bolna_batch_id,
                provider_correlation_id=action.provider_correlation_id,
                provider_terminal=True,
                completed_at=now,
            )
            .on_conflict_do_nothing(
                constraint="uq_workflow_run_recipient_actions_idempotency",
            )
        )

    # TTL gate — drop the event when the recipient's ignore_webhooks_after has lapsed.
    # NULL means "never gated"; non-NULL means an adapter stamped a deadline at dispatch.
    ttl_gate = or_(
        WorkflowRunRecipientState.ignore_webhooks_after.is_(None),
        WorkflowRunRecipientState.ignore_webhooks_after > func.now(),
    )

    flipped_to_ready = False
    if flip_waiting_to_ready:
        flip_result = await db.execute(
            update(WorkflowRunRecipientState)
            .where(
                WorkflowRunRecipientState.run_id == action.run_id,
                WorkflowRunRecipientState.recipient_id == action.recipient_id,
                WorkflowRunRecipientState.status == "waiting",
                ttl_gate,
            )
            .values(status="ready", wakeup_at=None)
        )
        flipped_to_ready = bool(getattr(flip_result, "rowcount", 0))
    # Always stamp ``last_outcome`` + ``last_event_at`` so the run-detail UI
    # has provider-agnostic columns to render. ``last_outcome`` falls back
    # to ``provider_status`` when the caller did not declare a child
    # action_type (i.e. there's no canonical outcome label yet).
    auto_payload: dict[str, Any] = {"last_event_at": now.isoformat()}
    outcome_label = child_action_type or provider_status
    if outcome_label:
        auto_payload["last_outcome"] = outcome_label
    namespaced_patch = (
        bag_write(node_id=node_id, fields=recipient_payload_patch)
        if (node_id and recipient_payload_patch)
        else (recipient_payload_patch or {})
    )
    merged_payload_patch: dict[str, Any] = {**auto_payload, **namespaced_patch}
    # JSONB ``||`` shallow merge; same TTL gate as the flip above.
    await db.execute(
        update(WorkflowRunRecipientState)
        .where(
            WorkflowRunRecipientState.run_id == action.run_id,
            WorkflowRunRecipientState.recipient_id == action.recipient_id,
            ttl_gate,
        )
        .values(
            payload=WorkflowRunRecipientState.payload.op("||")(
                merged_payload_patch
            )
        )
    )

    # When this reconciliation actually flipped a recipient from waiting
    # → ready (e.g. Bolna poller reconciled a terminal call), drive the
    # workflow forward immediately by enqueuing a delayed run-workflow
    # resume job. Replaces the resume-waiting-cohorts cron's ~60s latency
    # with ±~1s worker pickup. Lazy import keeps the shared funnel quiet
    # in test fixtures that don't mount the full app.
    if flipped_to_ready:
        from app.services.orchestration.dispatch.resume_enqueue import (
            enqueue_resume_for_recipient,
        )
        # Idempotency key folds in child_idempotency_key when present so
        # a duplicate reconcile (webhook + poller) collapses into one job.
        reason_token = child_idempotency_key or (
            f"ready:reconcile:{action.id}"
        )
        await enqueue_resume_for_recipient(
            db,
            run_id=action.run_id,
            recipient_id=action.recipient_id,
            available_at=None,
            reason=reason_token,
        )

    await db.flush()
    return True
