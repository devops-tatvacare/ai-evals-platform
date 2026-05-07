"""In-DB pub/sub via Postgres LISTEN/NOTIFY for orchestration run streams.

Channel naming: ``orch_run_<run_id_no_dashes>`` (one channel per run; bounded
by hex namespace so it never collides with other Postgres channels).

Why fully detached from the SQLAlchemy engine pool: telemetry must never
couple to the caller's transaction. Two distinct concerns:

1. **Transaction independence.** Traversal / run_handler hold long-running
   transactions owned by the worker boundary. Mid-traversal commits would
   leak partial run-state writes. So publish_event opens a brand-new
   asyncpg connection, NOTIFY-commits, and closes. Failures are logged and
   swallowed — telemetry must never fail a run.

2. **Loop-binding.** SQLAlchemy's pooled async connections are bound to the
   event loop they were created on. SSE streams (and pytest-asyncio tests)
   routinely cross loops, so reusing the pool produces "Future attached to a
   different loop" runtime errors. A fresh asyncpg connection per call is
   the correct architecture and is what asyncpg's docs recommend for pub/sub.

Subscribe holds one long-lived asyncpg connection for the SSE stream's
lifetime — same loop-binding reasoning, plus LISTEN state contaminates pool
connections (next checkout would inherit leftover listeners).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any, AsyncIterator

import asyncpg
from sqlalchemy.engine import make_url

from app.database import engine


_log = logging.getLogger(__name__)

_NOTIFY_PAYLOAD_LIMIT = 7800  # leaves headroom under Postgres' 8000-byte cap


def _channel_for_run(run_id: uuid.UUID) -> str:
    return f"orch_run_{run_id.hex}"


def _truncate_oversized(event: dict[str, Any]) -> dict[str, Any]:
    """Defensive truncation of any oversize string/list/dict field in `event`."""
    out = {**event, "_truncated": True}
    for k, v in list(out.items()):
        if isinstance(v, (dict, list, str)) and len(str(v)) > 1000:
            out[k] = "<truncated>"
    return out


def _asyncpg_connect_kwargs() -> dict[str, Any]:
    """Translate the runtime DB URL into asyncpg.connect kwargs.

    The pub/sub path uses direct asyncpg connections rather than the SQLAlchemy
    pool. Tests may point live-DB fixtures at a different port via
    ``TEST_DATABASE_URL``, so honor that explicit override first.
    """
    raw_url = os.environ.get("TEST_DATABASE_URL") or engine.url.render_as_string(
        hide_password=False
    )
    url = make_url(raw_url)
    return {
        "user": url.username,
        "password": url.password,
        "host": url.host,
        "port": url.port,
        "database": url.database,
    }


async def publish_event(*, run_id: uuid.UUID, event: dict[str, Any]) -> None:
    """Fire-and-forget NOTIFY on a fresh asyncpg connection. Never raises.

    Caller does not pass a session. A new asyncpg connection is opened, used
    for one ``pg_notify`` call, and closed — so the caller's transaction
    stays untouched and the publish is loop-independent. ``pg_notify``
    auto-commits, so no explicit COMMIT needed.
    """
    payload = json.dumps(event, default=str)
    if len(payload) > _NOTIFY_PAYLOAD_LIMIT:
        payload = json.dumps(_truncate_oversized(event), default=str)

    channel = _channel_for_run(run_id)
    try:
        conn = await asyncpg.connect(**_asyncpg_connect_kwargs())
        try:
            await conn.execute("SELECT pg_notify($1, $2)", channel, payload)
        finally:
            await conn.close()
    except Exception:
        _log.exception("publish_event failed (run=%s, type=%s)", run_id, event.get("type"))


async def subscribe(
    run_id: uuid.UUID,
    *,
    max_events: int | None = None,
    idle_timeout: float = 30.0,
) -> AsyncIterator[dict[str, Any]]:
    """Yield events for ``run_id`` until ``max_events`` reached or ``idle_timeout`` elapses.

    Opens a fresh asyncpg connection (not from the engine pool — see module
    docstring) and registers an ``add_listener`` callback that drops events
    onto an asyncio.Queue. The generator yields events as they arrive.
    """
    channel = _channel_for_run(run_id)
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    def _on_notify(_conn, _pid, _channel, payload):
        try:
            queue.put_nowait(json.loads(payload))
        except (json.JSONDecodeError, asyncio.QueueFull):
            pass

    conn = await asyncpg.connect(**_asyncpg_connect_kwargs())
    try:
        await conn.add_listener(channel, _on_notify)
        try:
            seen = 0
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=idle_timeout)
                except asyncio.TimeoutError:
                    return
                yield event
                seen += 1
                if max_events is not None and seen >= max_events:
                    return
        finally:
            try:
                await conn.remove_listener(channel, _on_notify)
            except Exception:
                _log.debug("remove_listener failed for channel %s", channel, exc_info=True)
    finally:
        try:
            await conn.close()
        except Exception:
            _log.debug("asyncpg close failed", exc_info=True)
