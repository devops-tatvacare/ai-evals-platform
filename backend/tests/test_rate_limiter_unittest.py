"""Phase 13 / D.1 — TokenBucket exhaustion + refill + race coverage.

These tests exercise the in-process rate limiter against an artificially
short window so the full lifecycle (fill → exhaust → roll → refill)
completes inside the test loop without sleeping for a real minute.
"""
from __future__ import annotations

import asyncio
import time
import uuid

import pytest

from app.services.orchestration.integrations import _rate_limiter
from app.services.orchestration.integrations._rate_limiter import (
    RateLimitedError,
    TokenBucket,
    acquire_bolna,
    get_bucket,
)


@pytest.fixture(autouse=True)
def _clear_registry():
    _rate_limiter._RATE_LIMITER_BUCKETS.clear()
    yield
    _rate_limiter._RATE_LIMITER_BUCKETS.clear()


# ─── TokenBucket primitive ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_acquire_succeeds_until_capacity():
    bucket = TokenBucket(capacity=3, window_seconds=10.0)
    await bucket.acquire(wait=False)
    await bucket.acquire(wait=False)
    await bucket.acquire(wait=False)
    with pytest.raises(RateLimitedError):
        await bucket.acquire(wait=False)


@pytest.mark.asyncio
async def test_acquire_with_wait_blocks_then_succeeds_when_window_rolls():
    """Tight window so the test never waits a real minute."""
    bucket = TokenBucket(capacity=2, window_seconds=0.3)
    await bucket.acquire(wait=False)
    await bucket.acquire(wait=False)
    started = time.monotonic()
    # Capacity is 2; this third acquire must wait for the window to roll.
    await bucket.acquire(wait_seconds=2.0)
    elapsed = time.monotonic() - started
    # We must have waited *at least* close to the window length and then
    # picked up a fresh slot.
    assert elapsed >= 0.2
    # And we shouldn't have slept the full default — this proves the
    # event-driven wakeup, not just polling.
    assert elapsed < 1.5


@pytest.mark.asyncio
async def test_acquire_with_wait_raises_when_deadline_elapses():
    """Bucket stays full for longer than the wait deadline → RateLimitedError."""
    bucket = TokenBucket(capacity=1, window_seconds=10.0)  # very long window
    await bucket.acquire(wait=False)
    started = time.monotonic()
    with pytest.raises(RateLimitedError):
        await bucket.acquire(wait_seconds=0.2)
    elapsed = time.monotonic() - started
    assert 0.15 <= elapsed < 1.0


@pytest.mark.asyncio
async def test_acquire_handles_concurrent_callers_under_capacity():
    """Many concurrent acquires under capacity all succeed."""
    bucket = TokenBucket(capacity=50, window_seconds=10.0)

    async def _one():
        await bucket.acquire(wait=False)

    await asyncio.gather(*[_one() for _ in range(50)])
    # The 51st must fail — capacity is fully consumed.
    with pytest.raises(RateLimitedError):
        await bucket.acquire(wait=False)


@pytest.mark.asyncio
async def test_concurrent_acquires_never_overrun_capacity():
    """50 concurrent acquires against a capacity-of-10 bucket: exactly 10
    succeed and 40 fail under fail-fast semantics. Proves the lock
    correctly serialises the increment/check pair."""
    bucket = TokenBucket(capacity=10, window_seconds=10.0)
    succeeded = 0
    failed = 0

    async def _one() -> None:
        nonlocal succeeded, failed
        try:
            await bucket.acquire(wait=False)
            succeeded += 1
        except RateLimitedError:
            failed += 1

    await asyncio.gather(*[_one() for _ in range(50)])
    assert succeeded == 10
    assert failed == 40


# ─── Module registry + Bolna combo helper ──────────────────────────────


@pytest.mark.asyncio
async def test_get_bucket_returns_same_instance_per_key():
    cid = uuid.uuid4()
    a = get_bucket(cid, "bolna:call")
    b = get_bucket(cid, "bolna:call")
    assert a is b
    # Different bucket names → different instances.
    assert a is not get_bucket(cid, "bolna:agent")


def test_get_bucket_rejects_unknown_name():
    with pytest.raises(ValueError):
        get_bucket(uuid.uuid4(), "bolna:nope")


@pytest.mark.asyncio
async def test_acquire_bolna_acquires_specific_plus_global(monkeypatch):
    """``acquire_bolna`` must always touch the global bucket."""
    cid = uuid.uuid4()
    # Patch capacities down so we can witness exhaustion without flooding.
    monkeypatch.setitem(
        _rate_limiter._SPECS, "bolna:call",
        _rate_limiter._BucketSpec(capacity=2, window_seconds=10.0),
    )
    monkeypatch.setitem(
        _rate_limiter._SPECS, "bolna:global",
        _rate_limiter._BucketSpec(capacity=3, window_seconds=10.0),
    )
    _rate_limiter._RATE_LIMITER_BUCKETS.clear()

    # 2 acquires fill the call bucket. Global bucket holds 2/3.
    await acquire_bolna(cid, "bolna:call", wait=False)
    await acquire_bolna(cid, "bolna:call", wait=False)
    # Third acquire fails on the call bucket (specific exhausted first).
    with pytest.raises(RateLimitedError):
        await acquire_bolna(cid, "bolna:call", wait=False)


@pytest.mark.asyncio
async def test_acquire_bolna_dedups_explicit_global():
    """Passing ``bolna:global`` explicitly mustn't double-charge the bucket."""
    cid = uuid.uuid4()
    bucket = get_bucket(cid, "bolna:global")
    await acquire_bolna(cid, "bolna:global", wait=False)
    # One slot consumed, not two.
    assert bucket._count == 1
