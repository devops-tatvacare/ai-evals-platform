"""Shared per-recipient outbox dispatch path for retry-capable clinical handlers.

Phase 11 (Commit 2): every retry-capable clinical handler in
``backend/app/services/orchestration/nodes/clinical_*.py`` calls into
:func:`dispatch_outbox_with_attempt_policy` so the attempt loop, the
``success`` / ``exhausted`` partitioning, and the action-row bookkeeping
live in one place.

EMR write is *not* in this set — it is a mutation node and keeps
``success`` / ``failed`` (Phase 11 §6.7).
"""
from __future__ import annotations

from typing import Any, AsyncIterator, Callable, Optional

from app.services.orchestration.attempt_policy import (
    AttemptPolicy,
    run_with_attempt_policy,
)
from app.services.orchestration.node_protocol import (
    ActionDispatch,
    NodeResult,
    RecipientOutcome,
)


def _classify_outbox_error(exc: BaseException) -> Optional[str]:
    """Treat all outbox enqueue failures as retryable transport errors.

    The clinical outbox writer is a local DB write today — failures are
    almost certainly transient (deadlock, connection drop). A non-retryable
    case would have to surface a more specific exception class to opt out.
    """
    del exc
    return "outbox_error"


async def dispatch_outbox_with_attempt_policy(
    *,
    ctx,
    input_cohort: AsyncIterator[tuple[str, dict[str, Any]]],
    action_type: str,
    idem_parts: list[str],
    outbox_payload_for: Callable[[str, dict[str, Any]], dict[str, Any]],
    summary_extra: Optional[dict[str, Any]] = None,
    attempt_policy: AttemptPolicy,
    node_label: str,
) -> NodeResult:
    if ctx.services.clinical_outbox is None:
        raise RuntimeError(f"{node_label} requires ClinicalOutboxWriter")

    success: list[RecipientOutcome] = []
    exhausted: list[RecipientOutcome] = []
    on_exhausted = attempt_policy.on_exhausted_output_id

    async for rid, payload in input_cohort:
        outbox_payload = outbox_payload_for(rid, payload)
        idem = ctx.idempotency_key(rid, *idem_parts)
        results = await ctx.dispatch_actions([
            ActionDispatch(
                recipient_id=rid,
                channel="system",
                action_type=action_type,
                idempotency_key=idem,
                # Channel-agnostic recipient handle (migration 0027). For
                # clinical channels the recipient_id IS the patient
                # identifier — that's the natural ``contact``.
                payload={"contact": rid, **outbox_payload},
            )
        ])
        r = results[0]
        if r.status != "pending":
            if r.status == "success":
                success.append(RecipientOutcome(recipient_id=rid))
            else:
                exhausted.append(RecipientOutcome(recipient_id=rid))
            continue

        async def _attempt(
            _n: int,
            _rid: str = rid,
            _idem: str = idem,
            _payload: dict[str, Any] = outbox_payload,
        ) -> dict[str, Any]:
            del _n
            outbox_row_id = await ctx.services.clinical_outbox.enqueue(
                ctx.db,
                tenant_id=ctx.tenant_id,
                app_id=ctx.app_id,
                recipient_id=_rid,
                action_type=action_type,
                idempotency_key=_idem,
                payload=_payload,
            )
            return {"queued": True, "outbox_row_id": str(outbox_row_id) if outbox_row_id else None}

        outcome = await run_with_attempt_policy(
            policy=attempt_policy,
            call=_attempt,
            classify_error=_classify_outbox_error,
        )
        if outcome.status == "success":
            outcome_payload = outcome.payload or {}
            outbox_row_id = outcome_payload.get("outbox_row_id")
            await ctx.update_action_result(
                r.action_id, status="success",
                response={"queued": True, "attempts": outcome.attempts, **outcome_payload},
                # Outbox row id is the channel-agnostic correlation handle
                # — downstream EMR consumers correlate against it.
                provider_correlation_id=outbox_row_id,
            )
            success.append(RecipientOutcome(recipient_id=rid))
        else:
            await ctx.update_action_result(
                r.action_id, status="failed",
                error=f"exhausted after {outcome.attempts} attempts: {outcome.last_error}",
            )
            exhausted.append(RecipientOutcome(recipient_id=rid))

    summary: dict[str, Any] = {
        "success_count": len(success),
        "exhausted_count": len(exhausted),
    }
    if summary_extra:
        summary.update(summary_extra)
    return NodeResult(
        by_output_id={"success": success, on_exhausted: exhausted},
        summary=summary,
    )


__all__ = ["dispatch_outbox_with_attempt_policy"]
