"""In-process pricing cache with TTL + stampede protection + NOTIFY invalidation.

Keyed by ``(provider, model, at_minute)``. ``at_minute`` is the UTC timestamp
truncated to the minute — the cache is effective-date aware without re-fetching
on every nanosecond-different call.

Invalidation paths:
1. TTL (default 5 minutes) — always eventually consistent.
2. ``NOTIFY cost_pricing_invalidated`` — fast path when available. The LISTEN
   subscriber is optional; absence does not break correctness.
3. Explicit ``invalidate()`` call — used by pricing mutation handlers.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.cost_tracking.pricing import PricingRow, fetch_pricing

_log = logging.getLogger(__name__)

_DEFAULT_TTL_SECONDS = 300
_MAX_ENTRIES = 1024

_CacheKey = tuple[str, str, int]


class _Entry:
    __slots__ = ('value', 'expires_at')

    def __init__(self, value: PricingRow | None, expires_at: float) -> None:
        self.value = value
        self.expires_at = expires_at


class PricingCache:
    """LRU-style cache with per-key asyncio locks to coalesce cold-start stampedes."""

    def __init__(self, ttl_seconds: int = _DEFAULT_TTL_SECONDS, max_entries: int = _MAX_ENTRIES) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._entries: OrderedDict[_CacheKey, _Entry] = OrderedDict()
        self._locks: dict[_CacheKey, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

    def _key(self, provider: str, model: str, at: datetime) -> _CacheKey:
        # Bucket by minute so effective-date rollover still hits the DB cleanly
        # without thrashing per-second.
        ts_minute = int(at.replace(second=0, microsecond=0).timestamp())
        return (provider, model, ts_minute)

    def _get_fresh(self, key: _CacheKey) -> PricingRow | None | _MissingType:
        entry = self._entries.get(key)
        if entry is None:
            return _MISSING
        if entry.expires_at < time.monotonic():
            self._entries.pop(key, None)
            return _MISSING
        self._entries.move_to_end(key)
        return entry.value

    def _put(self, key: _CacheKey, value: PricingRow | None) -> None:
        self._entries[key] = _Entry(value, time.monotonic() + self._ttl)
        self._entries.move_to_end(key)
        while len(self._entries) > self._max:
            self._entries.popitem(last=False)

    async def get(
        self, db: AsyncSession, provider: str, model: str, at: datetime
    ) -> PricingRow | None:
        """Return the effective pricing row, loading and caching on miss."""
        key = self._key(provider, model, at)

        cached = self._get_fresh(key)
        if cached is not _MISSING:
            return cached

        lock = await self._get_lock(key)
        async with lock:
            cached = self._get_fresh(key)
            if cached is not _MISSING:
                return cached
            row = await fetch_pricing(db, provider, model, at)
            self._put(key, row)
            return row

    async def _get_lock(self, key: _CacheKey) -> asyncio.Lock:
        async with self._global_lock:
            lock = self._locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[key] = lock
            return lock

    def invalidate(self) -> None:
        """Drop every cached row. Called after a pricing mutation or LISTEN ping."""
        self._entries.clear()
        _log.debug('pricing_cache: invalidated')

    def size(self) -> int:
        return len(self._entries)


class _MissingType:
    pass


_MISSING = _MissingType()


# Module-level singleton used by the recorder. Tests may construct local
# instances via ``PricingCache(...)`` without touching the singleton.
pricing_cache = PricingCache()


async def refresh_pricing_cache() -> None:
    """Invalidate the shared cache. Safe to call from anywhere (LISTEN handlers, routes)."""
    pricing_cache.invalidate()


__all__ = ['PricingCache', 'pricing_cache', 'refresh_pricing_cache']
