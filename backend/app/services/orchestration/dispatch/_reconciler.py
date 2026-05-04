"""Provider-agnostic dispatch reconciler.

Both the webhook handlers and the Phase E poller funnel terminal events
through ``apply_terminal_event``. The function is idempotent — once an
action's ``completed_at`` is non-null we treat the event as already
recorded and return ``False`` so the caller can short-circuit any
follow-up work (e.g. inserting a duplicate audit row).

What this owns
--------------
- Updating the parent dispatch action's ``response`` (JSONB merge),
  ``status``, and ``completed_at``.
- Optional child action insertion for audit trails (the legacy
  ``bolna_answered`` / ``bolna_rnr`` / ``bolna_failed`` rows). The child
  insert uses ``ON CONFLICT DO NOTHING`` keyed by the unique
  ``(tenant_id, recipient_id, idempotency_key)`` constraint, so re-running
  the reconciler on a duplicate event is safe.
- Releasing any logic.wait recipient parked on the dispatch by flipping
  ``WorkflowRunRecipientState.status`` from ``waiting`` to ``ready``.
- Merging upstream-derived hints into the recipient state ``payload`` so
  downstream conditional nodes can route on them.

What this *does not* own
------------------------
- The provider-specific shape of the event payload — that's the
  per-provider reconciler's job (e.g. ``bolna_reconciler.apply_event``).
- The decision of whether the event is terminal — caller decides.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)


async def apply_terminal_event(
    db: AsyncSession,
    *,
    action: WorkflowRunRecipientAction,
    response_patch: dict[str, Any],
    recipient_payload_patch: dict[str, Any] | None = None,
    final_status: Optional[str] = None,
    error: Optional[str] = None,
    provider_status: Optional[str] = None,
    child_action_type: Optional[str] = None,
    child_idempotency_key: Optional[str] = None,
    child_response: Optional[dict[str, Any]] = None,
    flip_waiting_to_ready: bool = True,
) -> bool:
    """Idempotent. Returns ``True`` when the event was newly applied,
    ``False`` when ``action.provider_terminal`` was already set.

    The action's existing ``response`` is shallow-merged with
    ``response_patch`` — keys present in the patch overwrite existing
    keys; keys absent from the patch are preserved. JSONB merge on the
    DB side would be a tighter contract, but the existing webhook
    handlers do shallow merges and we keep parity.

    ``completed_at`` is *not* touched here — the dispatch nodes set it
    when the upstream queue succeeds (so it carries "queued at" semantics
    end-to-end). ``provider_terminal`` is the idempotency gate for
    terminal-event reconciliation.
    """
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
                payload={"event": child_action_type},
                response=child_response_payload,
                parent_action_id=action.id,
                provider_terminal=True,
                completed_at=now,
            )
            .on_conflict_do_nothing(
                constraint="uq_workflow_run_recipient_actions_idempotency",
            )
        )

    # Recipient state — flip waiting → ready and merge payload hints.
    flipped_to_ready = False
    if flip_waiting_to_ready:
        flip_result = await db.execute(
            update(WorkflowRunRecipientState)
            .where(
                WorkflowRunRecipientState.run_id == action.run_id,
                WorkflowRunRecipientState.recipient_id == action.recipient_id,
                WorkflowRunRecipientState.status == "waiting",
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
    merged_payload_patch: dict[str, Any] = {**auto_payload, **(recipient_payload_patch or {})}
    # JSONB ``||`` performs a shallow merge: keys in the patch overwrite
    # existing keys. Mirrors the existing WATI / Bolna handlers.
    await db.execute(
        update(WorkflowRunRecipientState)
        .where(
            WorkflowRunRecipientState.run_id == action.run_id,
            WorkflowRunRecipientState.recipient_id == action.recipient_id,
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
