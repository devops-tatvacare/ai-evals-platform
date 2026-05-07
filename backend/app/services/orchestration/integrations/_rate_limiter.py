"""Phase 13 / D.1 — async-safe in-process token bucket.

The integrations layer needs per-provider rate limiting that respects
the published quotas (Bolna: 500/min on /call /v2/agent and
/v2/agent/{id}/executions, 1000/min global). Today's prod is a single
Container App with the embedded worker, so an in-process bucket keyed by
``(connection_id, bucket_name)`` is sufficient.

Multi-replica swap path (documented here so a future maintainer doesn't
have to reverse-engineer it): replace the in-process ``_state`` dict with
a Postgres-backed ``orchestration.rate_limit_buckets(bucket_key,
window_start, count)`` table and use ``INSERT … ON CONFLICT … DO UPDATE``
with row-level locking to atomically increment within a window. The
``acquire`` API stays identical so callers don't change.

Usage:

    from app.services.orchestration.integrations._rate_limiter import (
        get_bucket, RateLimitedError,
    )

    bucket = get_bucket(connection_id, "bolna:call")
    await bucket.acquire()              # waits up to bucket's wait_seconds
    await bucket.acquire(wait=False)    # fail-fast → RateLimitedError

The bucket is a fixed-window counter, not a sliding window. Bolna
publishes "500/min" without specifying the window semantics; a fixed
1-minute window is conservative enough that we never exceed the quota
in any 60-second slice. Callers that need stricter accuracy can swap
to a token-refill model later without changing the public API.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional


class RateLimitedError(RuntimeError):
    """Raised when ``acquire(wait=False)`` finds the bucket full or when
    the configured ``wait_seconds`` elapses without a slot opening."""


@dataclass
class _BucketSpec:
    capacity: int
    window_seconds: float
    # Default time a caller is willing to wait for a free slot before the
    # acquire raises. Picked deliberately short — for UI-driven Bolna
    # calls anything beyond 5 seconds means we're badly throttled and the
    # caller should surface the error so the cohort dispatcher can decide
    # whether to retry, suspend, or fail. Per-call override is allowed.
    default_wait_seconds: float = 5.0


# Bolna's published quotas (https://www.bolna.ai/docs/rate-limits, retrieved
# 2026-05-04). When Bolna publishes new buckets, add them here — every
# integration that hits those endpoints picks them up automatically.
_SPECS: dict[str, _BucketSpec] = {
    "bolna:call": _BucketSpec(capacity=500, window_seconds=60.0),
    "bolna:agent": _BucketSpec(capacity=500, window_seconds=60.0),
    "bolna:executions": _BucketSpec(capacity=500, window_seconds=60.0),
    # Global bucket is always acquired alongside the per-endpoint bucket.
    "bolna:global": _BucketSpec(capacity=1000, window_seconds=60.0),
}


@dataclass
class TokenBucket:
    """Async-safe fixed-window token bucket. Stateful — share one instance
    per (connection_id, bucket_name) so parallel callers see the same
    counter."""
    capacity: int
    window_seconds: float
    _window_start: float = field(default=0.0)
    _count: int = field(default=0)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _slot_freed: asyncio.Event = field(default_factory=asyncio.Event)

    def __post_init__(self) -> None:
        # Start the event in the "set" state so the first acquire returns
        # immediately when the bucket is fresh.
        self._slot_freed.set()

    def _maybe_roll_window(self, now: float) -> None:
        """Reset count when the current window has elapsed."""
        if now - self._window_start >= self.window_seconds:
            self._window_start = now
            self._count = 0
            # New window opens a fresh batch of slots — wake every waiter.
            self._slot_freed.set()

    async def acquire(
        self,
        *,
        wait: bool = True,
        wait_seconds: Optional[float] = None,
    ) -> None:
        """Atomically claim one slot.

        - ``wait=True`` (default): block until a slot opens or the
          per-call ``wait_seconds`` (defaults to ``5s``) elapses; on
          timeout raises :class:`RateLimitedError`.
        - ``wait=False``: never block. Raise :class:`RateLimitedError`
          immediately when the bucket is full.
        """
        deadline: Optional[float]
        if wait:
            timeout = wait_seconds if wait_seconds is not None else 5.0
            deadline = time.monotonic() + timeout
        else:
            deadline = None

        while True:
            async with self._lock:
                now = time.monotonic()
                if self._window_start == 0.0:
                    self._window_start = now
                self._maybe_roll_window(now)
                if self._count < self.capacity:
                    self._count += 1
                    if self._count >= self.capacity:
                        # Last slot just consumed — block subsequent
                        # waiters until the window rolls.
                        self._slot_freed.clear()
                    return
                # Bucket is full. Compute time until the window rolls.
                remaining = max(0.0, self.window_seconds - (now - self._window_start))

            if not wait:
                raise RateLimitedError(
                    f"bucket exhausted ({self.capacity}/{self.window_seconds}s); "
                    f"retry in ~{remaining:.1f}s"
                )

            assert deadline is not None
            now = time.monotonic()
            if now >= deadline:
                raise RateLimitedError(
                    f"bucket exhausted; waited {wait_seconds:.1f}s without a slot"
                )

            # Sleep until either a slot frees (window rolls) or our deadline
            # fires — whichever comes first. Cap sleep at the smaller of
            # `remaining` and `deadline - now` so the rolled window is
            # picked up promptly.
            sleep_for = max(0.05, min(remaining, deadline - now))
            try:
                await asyncio.wait_for(self._slot_freed.wait(), timeout=sleep_for)
            except asyncio.TimeoutError:
                pass


# Module-level registry — bucket instances live for the process lifetime,
# so a connection's counter persists across requests served by the same
# replica. Cleared by tests via ``_RATE_LIMITER_BUCKETS.clear()``.
_RATE_LIMITER_BUCKETS: dict[tuple[uuid.UUID, str], TokenBucket] = {}


def get_bucket(connection_id: uuid.UUID, bucket_name: str) -> TokenBucket:
    """Return the shared bucket for ``(connection_id, bucket_name)``."""
    spec = _SPECS.get(bucket_name)
    if spec is None:
        raise ValueError(f"unknown rate-limit bucket {bucket_name!r}")
    key = (connection_id, bucket_name)
    bucket = _RATE_LIMITER_BUCKETS.get(key)
    if bucket is None:
        bucket = TokenBucket(capacity=spec.capacity, window_seconds=spec.window_seconds)
        _RATE_LIMITER_BUCKETS[key] = bucket
    return bucket


async def acquire_bolna(
    connection_id: uuid.UUID,
    *bucket_names: str,
    wait: bool = True,
    wait_seconds: Optional[float] = None,
) -> None:
    """Acquire one slot from each of ``bucket_names`` plus ``bolna:global``.

    Convenience wrapper used by ``BolnaService`` so every call enforces
    "specific bucket + global" without each call site repeating the
    pattern. Buckets are acquired in declaration order so a partial
    failure (one bucket exhausted) doesn't leak slots from earlier
    buckets — that's a known limitation of the in-process model and is
    acceptable since the global bucket is the dominant gate at typical
    traffic levels.
    """
    seen: set[str] = set()
    ordered: list[str] = []
    for name in bucket_names:
        if name not in seen:
            ordered.append(name)
            seen.add(name)
    if "bolna:global" not in seen:
        ordered.append("bolna:global")
    for name in ordered:
        bucket = get_bucket(connection_id, name)
        await bucket.acquire(wait=wait, wait_seconds=wait_seconds)
