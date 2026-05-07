"""SSE publisher writes one NOTIFY per event; subscribers receive it.

Hits live Postgres via the ``db_session`` fixture infrastructure (LISTEN/NOTIFY
isn't simulatable). The publisher opens its own short-lived session — it does
not piggyback on the test's session — which is the structural fix for the
mid-traversal commit problem (see sse_publisher.py module docstring).
"""
from __future__ import annotations

import asyncio
import uuid

import pytest

from app.services.orchestration.sse_publisher import publish_event, subscribe


@pytest.mark.asyncio
async def test_publish_then_subscribe_receives_event():
    run_id = uuid.uuid4()
    received: list[dict] = []

    async def consumer():
        async for event in subscribe(run_id, max_events=1, idle_timeout=3.0):
            received.append(event)
            return

    async def producer():
        # Give the consumer time to install its LISTEN before NOTIFYing.
        await asyncio.sleep(0.3)
        await publish_event(
            run_id=run_id,
            event={
                "type": "node_step.completed",
                "node_id": "n1",
                "outputs_summary": {"by_output_id": {"success": 5}},
            },
        )

    await asyncio.gather(consumer(), producer())
    assert len(received) == 1
    assert received[0]["type"] == "node_step.completed"
    assert received[0]["node_id"] == "n1"


@pytest.mark.asyncio
async def test_subscribe_idle_timeout_terminates_cleanly():
    run_id = uuid.uuid4()
    seen = 0
    async for _ in subscribe(run_id, idle_timeout=0.5):
        seen += 1
    assert seen == 0


@pytest.mark.asyncio
async def test_publish_event_swallows_failures(monkeypatch):
    """Failure to NOTIFY must not raise — telemetry is fire-and-forget."""
    import app.services.orchestration.sse_publisher as mod

    async def _boom_connect(**_kwargs):
        raise RuntimeError("simulated DB unavailable")

    monkeypatch.setattr(mod.asyncpg, "connect", _boom_connect)
    # Must not raise.
    await publish_event(run_id=uuid.uuid4(), event={"type": "run.started"})


@pytest.mark.asyncio
async def test_publish_truncates_oversized_payload():
    run_id = uuid.uuid4()
    received: list[dict] = []

    async def consumer():
        async for event in subscribe(run_id, max_events=1, idle_timeout=3.0):
            received.append(event)
            return

    async def producer():
        await asyncio.sleep(0.3)
        big_blob = "x" * 9000
        await publish_event(
            run_id=run_id,
            event={"type": "node_step.completed", "outputs_summary": big_blob},
        )

    await asyncio.gather(consumer(), producer())
    assert len(received) == 1
    assert received[0].get("_truncated") is True
