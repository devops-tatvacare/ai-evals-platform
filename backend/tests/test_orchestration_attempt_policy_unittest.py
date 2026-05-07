"""Phase 11 (Commit 2) — attempt policy contract tests.

Pure-Python tests for ``attempt_policy.run_with_attempt_policy``: every
behaviour of the executor is exercised here so the dispatch nodes can
delegate to the helper without re-testing their own retry semantics.

Companion node-level retry tests live alongside the existing per-handler
tests (``test_orchestration_crm_nodes_unittest.py`` etc.) — those assert
the success/exhausted edge wiring after a real provider call. This file
stays away from the DB.
"""
from __future__ import annotations

from typing import Optional

import pytest

from app.services.orchestration.attempt_policy import (
    AttemptOutcome,
    AttemptPolicy,
    run_with_attempt_policy,
)


class _RetryableError(Exception):
    pass


class _NonRetryableError(Exception):
    pass


def _classifier(exc: BaseException) -> Optional[str]:
    if isinstance(exc, _RetryableError):
        return "retryable"
    return None


@pytest.mark.asyncio
async def test_first_attempt_succeeds():
    policy = AttemptPolicy(max_attempts=3, retry_on=["retryable"])
    calls: list[int] = []

    async def _call(n: int) -> dict:
        calls.append(n)
        return {"ok": True}

    outcome = await run_with_attempt_policy(
        policy=policy, call=_call, classify_error=_classifier,
    )
    assert outcome.status == "success"
    assert outcome.attempts == 1
    assert outcome.payload == {"ok": True}
    assert calls == [1]


@pytest.mark.asyncio
async def test_retries_until_success():
    policy = AttemptPolicy(max_attempts=4, retry_on=["retryable"])
    calls: list[int] = []

    async def _call(n: int) -> dict:
        calls.append(n)
        if n < 3:
            raise _RetryableError(f"attempt {n} failed")
        return {"ok": True}

    outcome = await run_with_attempt_policy(
        policy=policy, call=_call, classify_error=_classifier,
    )
    assert outcome.status == "success"
    assert outcome.attempts == 3
    assert calls == [1, 2, 3]


@pytest.mark.asyncio
async def test_all_attempts_fail_yields_exhausted():
    policy = AttemptPolicy(max_attempts=3, retry_on=["retryable"])
    calls: list[int] = []

    async def _call(n: int) -> dict:
        calls.append(n)
        raise _RetryableError(f"attempt {n}")

    outcome = await run_with_attempt_policy(
        policy=policy, call=_call, classify_error=_classifier,
    )
    assert outcome.status == "exhausted"
    assert outcome.attempts == 3
    assert outcome.last_error is not None
    assert "attempt 3" in outcome.last_error
    assert calls == [1, 2, 3]


@pytest.mark.asyncio
async def test_non_retryable_error_short_circuits():
    policy = AttemptPolicy(max_attempts=5, retry_on=["retryable"])
    calls: list[int] = []

    async def _call(n: int) -> dict:
        calls.append(n)
        raise _NonRetryableError("boom")

    outcome = await run_with_attempt_policy(
        policy=policy, call=_call, classify_error=_classifier,
    )
    assert outcome.status == "exhausted"
    assert outcome.attempts == 1
    assert calls == [1]
    assert outcome.last_error is not None and "boom" in outcome.last_error


@pytest.mark.asyncio
async def test_token_not_in_retry_on_yields_exhausted():
    """Classifier returns a token that's classifiable as retryable in
    principle, but the policy's ``retry_on`` list explicitly excludes it."""
    policy = AttemptPolicy(max_attempts=5, retry_on=["other_token"])

    async def _call(_n: int) -> dict:
        raise _RetryableError("only-classified-as-retryable")

    outcome = await run_with_attempt_policy(
        policy=policy, call=_call, classify_error=_classifier,
    )
    assert outcome.status == "exhausted"
    assert outcome.attempts == 1


@pytest.mark.asyncio
async def test_empty_retry_on_accepts_any_classifiable_token():
    """When ``retry_on`` is empty, any non-None classifier token is retried."""
    policy = AttemptPolicy(max_attempts=3, retry_on=[])
    calls: list[int] = []

    async def _call(n: int) -> dict:
        calls.append(n)
        if n < 2:
            raise _RetryableError(f"attempt {n}")
        return {"ok": True}

    outcome = await run_with_attempt_policy(
        policy=policy, call=_call, classify_error=_classifier,
    )
    assert outcome.status == "success"
    assert outcome.attempts == 2


def test_default_attempt_policy_is_single_attempt():
    """A default ``AttemptPolicy()`` is one attempt — i.e. backwards-compatible
    with pre-Phase-11 dispatch nodes that emitted success/failed."""
    p = AttemptPolicy()
    assert p.max_attempts == 1
    assert p.backoff_kind == "immediate"
    assert p.delay_minutes == 0
    assert p.on_exhausted_output_id == "exhausted"


def test_attempt_policy_rejects_invalid_max_attempts():
    with pytest.raises(Exception):
        AttemptPolicy(max_attempts=0)


def test_attempt_outcome_carries_payload_only_on_success():
    succ: AttemptOutcome[dict] = AttemptOutcome(
        status="success", attempts=2, payload={"x": 1},
    )
    assert succ.payload == {"x": 1}
    exh: AttemptOutcome[dict] = AttemptOutcome(
        status="exhausted", attempts=3, last_error="boom",
    )
    assert exh.payload is None
    assert exh.last_error == "boom"
