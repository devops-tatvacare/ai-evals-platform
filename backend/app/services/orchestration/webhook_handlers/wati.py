"""Parse WATI webhook events and route them to the engine.

Per concierge spec §5.5:
  Event types we handle:
    sentMessageDELIVERED_v2, sentMessageREAD_v2, sentMessageREPLIED_v2,
    messageReceived, templateMessageFailed
  Match prior dispatch via response.localMessageId.
  STOP / UNSUB(SCRIBE) keyword in messageReceived → opt-out consent flip.
Idempotent: deterministic idempotency_key derived from event_type + localMessageId
  so re-deliveries are absorbed by the unique constraint on
  (tenant_id, recipient_id, idempotency_key).
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    WorkflowConsentRecord,
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)


_STOP_RE = re.compile(r"^\s*(stop|unsub(scribe)?)\s*$", re.IGNORECASE)


# event_type → (action_type_to_write, should_flip_waiting_to_ready)
_EVENT_TO_ACTION: dict[str, tuple[str, bool]] = {
    "sentMessageDELIVERED_v2": ("wa_delivered", False),
    "sentMessageREAD_v2": ("wa_read", False),
    "sentMessageREPLIED_v2": ("wa_replied", True),
    "messageReceived": ("wa_replied", True),
    "templateMessageFailed": ("wa_failed", False),
}


_INBOUND_REPLY_EVENTS = frozenset({"messageReceived", "sentMessageREPLIED_v2"})


async def handle_wati_event(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    payload: dict[str, Any],
    recipient_id_override: Optional[str] = None,
) -> None:
    event_type = payload.get("eventType")
    body = payload.get("messageBody") or ""

    # STOP / UNSUB consent flip MUST only fire for genuine inbound replies.
    # WATI also emits delivery/read receipts that echo the outbound body
    # (which can include a "STOP" compliance footer); treating those as
    # opt-outs would silently break running campaigns. Validate event_type
    # FIRST, then test for STOP only on reply-shaped events.
    if event_type in _INBOUND_REPLY_EVENTS and _STOP_RE.match(body):
        recipient_id = (
            recipient_id_override
            or await _resolve_recipient_from_localid(db, tenant_id=tenant_id, payload=payload)
        )
        if recipient_id:
            db.add(WorkflowConsentRecord(
                id=uuid.uuid4(),
                tenant_id=tenant_id, app_id=app_id,
                recipient_id=recipient_id, channel="wa",
                status="opted_out", source="wa_reply_stop",
                evidence={"webhook": payload},
            ))
            await db.flush()
        return

    if event_type not in _EVENT_TO_ACTION:
        return

    new_action_type, should_resume = _EVENT_TO_ACTION[event_type]
    parent = await _find_parent_action(db, tenant_id=tenant_id, payload=payload)
    if parent is None:
        return

    local_msg_id = payload.get("localMessageId") or ""
    idem = f"webhook|{event_type}|{local_msg_id}"
    stmt = pg_insert(WorkflowRunRecipientAction).values(
        id=uuid.uuid4(),
        tenant_id=tenant_id, app_id=app_id,
        workflow_id=parent.workflow_id, workflow_version_id=parent.workflow_version_id,
        run_id=parent.run_id, node_step_id=parent.node_step_id,
        recipient_id=parent.recipient_id, channel="wati",
        action_type=new_action_type, status="success",
        idempotency_key=idem,
        payload={"event": event_type},
        response=payload,
        parent_action_id=parent.id,
        completed_at=datetime.now(timezone.utc),
    ).on_conflict_do_nothing(constraint="uq_workflow_run_recipient_actions_idempotency")
    await db.execute(stmt)

    # Stamp the run-detail UI's provider-agnostic ``last_outcome`` /
    # ``last_event_at`` keys for every WATI event we route — even the
    # non-resuming ones (delivered / read / failed) so the recipients
    # tab shows progress without needing a reply.
    now_iso = datetime.now(timezone.utc).isoformat()
    base_delta: dict[str, Any] = {
        "last_outcome": new_action_type,
        "last_event_at": now_iso,
    }
    if should_resume:
        # Merge wa_replied + reply body into recipient state payload so the
        # downstream "Replied?" conditional in the seeded MQL Concierge
        # workflow can route on it. Conditional reads payload, not action
        # rows — webhook handler is the only place the flag can land.
        payload_delta: dict[str, Any] = {**base_delta, "wa_replied": True}
        body = payload.get("messageBody")
        if isinstance(body, str) and body:
            payload_delta["wa_reply_body"] = body
        flipped = await _flip_waiting_to_ready(
            db,
            run_id=parent.run_id,
            recipient_id=parent.recipient_id,
            payload_delta=payload_delta,
        )
        # Resume only when this webhook actually transitioned the
        # recipient. Without the gate, a re-delivered webhook (or one
        # arriving after another path already flipped to ready) would
        # enqueue a redundant run-workflow job. The reconciler funnel
        # uses the same rowcount-based gate; convention is identical.
        if flipped:
            from app.services.orchestration.dispatch.resume_enqueue import (
                enqueue_resume_for_recipient,
            )
            await enqueue_resume_for_recipient(
                db,
                run_id=parent.run_id,
                recipient_id=parent.recipient_id,
                available_at=None,
                reason=f"ready:wati:{event_type}:{local_msg_id}",
            )
    else:
        # Non-resuming events (delivered / read / failed) merge progress
        # markers but must NOT flip waiting→ready — the recipient is parked
        # waiting for a reply, not a delivery receipt.
        await db.execute(
            update(WorkflowRunRecipientState)
            .where(
                WorkflowRunRecipientState.run_id == parent.run_id,
                WorkflowRunRecipientState.recipient_id == parent.recipient_id,
            )
            .values(payload=WorkflowRunRecipientState.payload.op("||")(base_delta))
        )
    await db.flush()


async def _find_parent_action(
    db: AsyncSession, *, tenant_id: uuid.UUID, payload: dict[str, Any]
) -> Optional[WorkflowRunRecipientAction]:
    local_msg_id = payload.get("localMessageId")
    if not local_msg_id:
        return None
    stmt = select(WorkflowRunRecipientAction).where(
        WorkflowRunRecipientAction.tenant_id == tenant_id,
        WorkflowRunRecipientAction.channel == "wati",
        WorkflowRunRecipientAction.action_type == "wa_dispatched",
        WorkflowRunRecipientAction.response["localMessageId"].astext == str(local_msg_id),
    ).limit(1)
    return (await db.execute(stmt)).scalar_one_or_none()


async def _resolve_recipient_from_localid(
    db: AsyncSession, *, tenant_id: uuid.UUID, payload: dict[str, Any]
) -> Optional[str]:
    parent = await _find_parent_action(db, tenant_id=tenant_id, payload=payload)
    return parent.recipient_id if parent else None


async def _flip_waiting_to_ready(
    db: AsyncSession,
    *,
    run_id: uuid.UUID,
    recipient_id: str,
    payload_delta: Optional[dict[str, Any]] = None,
) -> bool:
    """If a recipient is parked at any node in 'waiting' status, flip to 'ready'.

    Returns ``True`` when the flip actually moved a row, ``False`` when
    no waiting row matched (already ready/running, or the poller raced
    ahead). Callers gate the inline run-workflow resume enqueue on this
    return value to avoid duplicate jobs.

    Optionally JSONB-merges ``payload_delta`` into ``recipient.payload`` so
    downstream conditionals can route on data the webhook learned (e.g.
    ``wa_replied=True``). The merge runs unconditionally on the (run,
    recipient) row — late-arriving payload should still land even when
    the flip itself was a no-op.
    """
    flip_result = await db.execute(
        update(WorkflowRunRecipientState)
        .where(
            WorkflowRunRecipientState.run_id == run_id,
            WorkflowRunRecipientState.recipient_id == recipient_id,
            WorkflowRunRecipientState.status == "waiting",
        )
        .values(status="ready", wakeup_at=None)
    )
    flipped = bool(getattr(flip_result, "rowcount", 0))
    if payload_delta:
        await db.execute(
            update(WorkflowRunRecipientState)
            .where(
                WorkflowRunRecipientState.run_id == run_id,
                WorkflowRunRecipientState.recipient_id == recipient_id,
            )
            .values(payload=WorkflowRunRecipientState.payload.op("||")(payload_delta))
        )
    return flipped
