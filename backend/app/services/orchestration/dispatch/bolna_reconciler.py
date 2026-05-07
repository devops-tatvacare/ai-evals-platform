"""Bolna-specific terminal event handling.

Both ingress paths (webhook + poller) call ``apply_event`` with the
upstream payload. This module owns:

- the terminal-status set per Bolna's documented call lifecycle
  (https://www.bolna.ai/docs/list-phone-call-status), and
- the canonical ``bolna_*`` outcome string the existing graphs route on
  (`bolna_answered` / `bolna_rnr` / `bolna_failed`).

The actual persistence happens in ``_reconciler.apply_terminal_event``.
"""
from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import WorkflowRunRecipientAction
from app.services.orchestration.dispatch._reconciler import apply_terminal_event


# Per Bolna docs, calls reach a terminal state when status becomes one of
# these — every other status (``queued`` / ``in-progress`` / ``ringing``)
# is an in-flight signal we ignore.
TERMINAL_STATUSES: frozenset[str] = frozenset({
    "completed",
    "answered",
    "success",
    "failed",
    "canceled",
    "cancelled",
    "no-answer",
    "rnr",
    "busy",
    "error",
    "stopped",
    "balance-low",
})

# The status / status_reason combinations that classify as the three
# routing outcomes our graphs use. Order matters — RNR-shaped reasons
# attached to a "completed" status fall into ``rnr``, not ``answered``.
_RNR_TOKENS = ("no-answer", "rnr", "busy")
_BOLNA_COST_DIVISOR = Decimal("100")
_BOLNA_COST_PRECISION = Decimal("0.0001")


def is_terminal(status: Optional[str]) -> bool:
    if not status:
        return False
    return status.lower() in TERMINAL_STATUSES


def classify_outcome(status: Optional[str], status_reason: Optional[str]) -> str:
    """Pure function — same contract as the original ``_classify_outcome``
    in ``webhook_handlers/bolna.py`` so existing graphs that route on
    ``bolna_outcome`` keep working unchanged."""
    s = (status or "").lower()
    r = (status_reason or "").lower()
    if (
        s in ("completed", "answered", "success")
        and "no-answer" not in r
        and "rnr" not in r
        and "busy" not in r
    ):
        return "bolna_answered"
    if any(tok in s or tok in r for tok in _RNR_TOKENS):
        return "bolna_rnr"
    return "bolna_failed"


def _normalize_cost_scalar(value: Any) -> Any:
    """Normalize Bolna's cost subunits into major-unit decimals.

    Bolna execution payloads expose ``total_cost`` / ``cost_breakdown`` in
    provider subunits (for example ``27.04`` for a dashboard value shown as
    ``0.2704``). Persist normalized major-unit values on the action/recipient
    surfaces while preserving the raw upstream event under ``last_event``.
    """
    if value is None or isinstance(value, bool):
        return value
    try:
        numeric = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return value
    normalized = (numeric / _BOLNA_COST_DIVISOR).quantize(
        _BOLNA_COST_PRECISION,
        rounding=ROUND_HALF_UP,
    )
    return float(normalized)


def _normalize_cost_tree(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _normalize_cost_tree(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_cost_tree(item) for item in value]
    return _normalize_cost_scalar(value)


def _extract_post_call_payload(event: dict[str, Any]) -> dict[str, Any]:
    """Pull the post-execution capture fields the run-detail UI surfaces.

    Bolna's webhook + the ``GET /v2/agent/{id}/executions`` endpoint use
    the same field names; we look in both top-level and nested
    ``telephony_data`` for the ones that historically split.
    """
    telephony = event.get("telephony_data")
    if not isinstance(telephony, dict):
        telephony = {}

    def _pick(key: str, *fallbacks: str) -> Any:
        v = event.get(key)
        if v is not None:
            return v
        for f in fallbacks:
            v = event.get(f)
            if v is not None:
                return v
            v = telephony.get(f)
            if v is not None:
                return v
        return telephony.get(key)

    return {
        "transcript": _pick("transcript"),
        "recording_url": _pick("recording_url", "recordingUrl"),
        "duration_sec": _pick("duration", "duration_seconds"),
        "total_cost": _normalize_cost_scalar(_pick("total_cost", "cost")),
        "cost_breakdown": _normalize_cost_tree(_pick("cost_breakdown")),
        "error_message": _pick("error_message", "error"),
        "extracted_data": _pick("extracted_data"),
        "hangup_reason": _pick("hangup_reason", "status_reason"),
        "telephony_provider": _pick("telephony_provider"),
    }


async def apply_event(
    db: AsyncSession,
    *,
    action: WorkflowRunRecipientAction,
    event: dict[str, Any],
) -> bool:
    """Funnel a Bolna terminal event through the shared reconciler.

    Returns ``True`` when the event was newly applied. Caller (webhook
    handler or poller) uses the boolean to decide whether to log a
    "first time we saw this" line.
    """
    status = event.get("status")
    status_reason = event.get("status_reason")
    if not is_terminal(status):
        return False

    outcome = classify_outcome(status, status_reason)
    capture = _extract_post_call_payload(event)
    capture_clean = {k: v for k, v in capture.items() if v is not None}

    # Patch the parent action with the full upstream event + capture
    # fields so the run-detail UI has everything it needs. The poller
    # also writes ``provider_status`` / ``provider_terminal`` into the
    # response so callers can tell at a glance whether the row needs
    # another reconcile pass.
    response_patch: dict[str, Any] = {
        "provider_status": (status or "").lower(),
        "provider_terminal": True,
        "bolna_outcome": outcome,
        **capture_clean,
        # Preserve the raw event verbatim for debugging / replay.
        "last_event": event,
    }
    payload_patch: dict[str, Any] = {"bolna_outcome": outcome}
    recording = capture_clean.get("recording_url")
    if recording is not None:
        payload_patch["bolna_recording_url"] = recording
    duration = capture_clean.get("duration_sec")
    if duration is not None:
        payload_patch["bolna_duration_sec"] = duration
    transcript = capture_clean.get("transcript")
    if transcript is not None:
        payload_patch["bolna_transcript"] = transcript
    total_cost = capture_clean.get("total_cost")
    if total_cost is not None:
        payload_patch["bolna_total_cost"] = total_cost

    execution_id = (
        event.get("execution_id")
        or (action.response or {}).get("execution_id")
        or "unknown"
    )
    child_idem = f"webhook|bolna|{execution_id}|{outcome}"

    return await apply_terminal_event(
        db,
        action=action,
        response_patch=response_patch,
        recipient_payload_patch=payload_patch,
        provider_status=(status or "").lower(),
        child_action_type=outcome,
        child_idempotency_key=child_idem,
    )


def _id() -> uuid.UUID:
    """Hook for tests — patched to inject a deterministic id."""
    return uuid.uuid4()
