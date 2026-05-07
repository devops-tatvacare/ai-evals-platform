"""Phase 11 — attempt policy contract for retry-capable dispatch nodes.

Replaces ad-hoc graph-loop retries with an in-node attempt model. A
dispatch handler delegates the per-recipient retry sequence to
:func:`run_with_attempt_policy` so retry, backoff, and the
``success`` / ``exhausted`` edge decision live in one place.

Contract (Phase 11 §3.5):

    AttemptPolicy = {
        max_attempts: int             # >= 1
        backoff_kind: 'immediate' | 'fixed_delay' | 'exponential'
        delay_minutes?: int           # base delay; ignored when backoff_kind='immediate'
        retry_on: list[str]           # provider-specific failure classes
        on_exhausted_output_id: str   # usually 'exhausted'
    }

Workflow-visible outputs collapse to two terminal outcomes:

    - 'success'    — at least one attempt returned success
    - 'exhausted'  — every attempt exhausted (or a non-retryable failure)

Per-attempt retryable failure handling stays *inside* the node + this
helper; it is never modeled as a graph branch.

Backoff caveat
--------------
Phase 11 lands the *contract* and the in-tick attempt loop. Each retry
runs on the same task tick — the helper does **not** call
``asyncio.sleep`` between attempts because that would block the run
loop for every parked recipient on every node visit. ``delay_minutes``
is parsed and surfaced on the resulting attempt records but is not
honoured as wall-clock backoff in this commit; the suspend-and-resume
backoff is a follow-up task. Tests should drive failure cascades via
classifier returns rather than by depending on observed sleep.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Generic, Literal, Optional, TypeVar

from pydantic import BaseModel, Field, field_validator


BackoffKind = Literal["immediate", "fixed_delay", "exponential"]


class AttemptPolicy(BaseModel):
    """Per-node attempt policy. Default = single attempt with no retry."""

    max_attempts: int = Field(default=1, ge=1, le=10)
    backoff_kind: BackoffKind = "immediate"
    delay_minutes: int = Field(default=0, ge=0, le=60 * 24)
    retry_on: list[str] = Field(default_factory=list)
    on_exhausted_output_id: str = "exhausted"

    @field_validator("on_exhausted_output_id")
    @classmethod
    def _on_exhausted_must_be_safe(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("on_exhausted_output_id must be a non-empty stable id")
        return v.strip()


def attempt_policy_json_schema_extra() -> dict[str, Any]:
    """``json_schema_extra`` payload for the editor to render the AttemptPolicyEditor."""
    return {"x-type": "attempt_policy"}


# ─── Executor ──────────────────────────────────────────────────────────────────

T = TypeVar("T")


class AttemptOutcome(BaseModel, Generic[T]):
    """Result of one full per-recipient attempt run.

    ``status`` collapses the per-attempt history into the workflow-visible
    outcome. ``last_error`` is set when ``status='exhausted'``. ``attempts``
    counts every attempt that ran (including the one that ultimately
    succeeded). ``payload`` is whatever the node-supplied ``call`` returned
    on the successful attempt — passed back so the handler can persist
    provider correlation identifiers without re-running the call.
    """

    status: Literal["success", "exhausted"]
    attempts: int
    last_error: Optional[str] = None
    payload: Optional[T] = None


# Classifier signature: (exception) -> retry_on token if retryable else None.
ErrorClassifier = Callable[[BaseException], Optional[str]]


async def run_with_attempt_policy(
    *,
    policy: AttemptPolicy,
    call: Callable[[int], Awaitable[T]],
    classify_error: ErrorClassifier,
) -> AttemptOutcome[T]:
    """Run ``call(attempt_index)`` up to ``policy.max_attempts`` times.

    ``call`` MUST accept the 1-indexed attempt number. It returns the
    handler-defined success payload (e.g. provider response dict) on
    success, or raises on failure. The classifier inspects the raised
    exception and returns the matching ``retry_on`` token when the failure
    is retryable, or ``None`` otherwise.

    Behaviour:
      - non-retryable exception → exhausted immediately (single-attempt failure)
      - retryable exception, attempts < max_attempts → retry on the same tick
      - retryable exception, attempts == max_attempts → exhausted

    The helper deliberately does not sleep between attempts — see the
    module docstring's backoff caveat. Future work: route ``fixed_delay``
    / ``exponential`` policies through the suspend-and-resume path so
    delays don't block the run loop.
    """
    last_error: Optional[str] = None
    attempts_run = 0
    for attempt in range(1, policy.max_attempts + 1):
        attempts_run = attempt
        try:
            payload = await call(attempt)
            return AttemptOutcome[T](status="success", attempts=attempt, payload=payload)
        except BaseException as exc:  # noqa: BLE001 — surfaced via classifier
            last_error = repr(exc)
            token = classify_error(exc)
            if token is None:
                # Non-retryable: bail with the single attempt counted.
                return AttemptOutcome[T](
                    status="exhausted",
                    attempts=attempt,
                    last_error=last_error,
                )
            if policy.retry_on and token not in policy.retry_on:
                # Retryable in principle but not configured for retry on this token.
                return AttemptOutcome[T](
                    status="exhausted",
                    attempts=attempt,
                    last_error=last_error,
                )
            # Retryable + token allowed; loop iterates if attempts remain.
    return AttemptOutcome[T](
        status="exhausted",
        attempts=attempts_run,
        last_error=last_error,
    )


__all__ = [
    "AttemptPolicy",
    "AttemptOutcome",
    "BackoffKind",
    "ErrorClassifier",
    "attempt_policy_json_schema_extra",
    "run_with_attempt_policy",
]
