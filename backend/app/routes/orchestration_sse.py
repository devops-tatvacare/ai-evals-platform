"""SSE stream for live orchestration run overlay.

GET /api/orchestration/runs/{run_id}/stream
  - Bearer auth required (same as the rest of /api/orchestration/*).
  - Tenant-gates the run before opening the stream.
  - Emits `event: hello` immediately so the client knows the channel is live,
    then forwards `node_step.*` and `run.*` events as they arrive.

Held connections: each subscriber holds one DB connection from the pool for
the lifetime of the SSE stream (see ``sse_publisher.subscribe`` for pool-cap
notes). Streams self-terminate after ``idle_timeout`` of silence — clients
are expected to reconnect for long-running runs.
"""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.database import get_db
from app.models.orchestration import WorkflowRun
from app.services.orchestration.sse_publisher import subscribe


router = APIRouter(prefix="/api/orchestration", tags=["orchestration-sse"])


@router.get("/runs/{run_id}/stream")
async def stream_run(
    run_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(WorkflowRun.tenant_id, WorkflowRun.app_id).where(WorkflowRun.id == run_id)
    )
    row = res.first()
    if row is None or row[0] != auth.tenant_id:
        raise HTTPException(status_code=404, detail="run not found")
    await ensure_registered_app_access(db, auth, row[1])

    async def event_gen():
        yield f"event: hello\ndata: {json.dumps({'run_id': str(run_id)})}\n\n"
        async for event in subscribe(run_id, idle_timeout=120.0):
            etype = event.get("type", "message")
            yield f"event: {etype}\ndata: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
