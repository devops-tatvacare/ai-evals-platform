"""Single source of truth for "wake up this recipient now / at T".

Three call sites converge here:

  1. ``_reconciler.apply_terminal_event`` — when a dispatch reconciliation
     flips a recipient ``waiting → ready`` (webhook or poller path).
  2. ``logic.wait`` suspend path in traversal — when a recipient parks
     with ``wakeup_at=T``.
  3. WATI / Bolna webhook handlers (the legacy ones that don't yet route
     through the shared funnel).

The helper writes a deterministic ``run-workflow`` BackgroundJob row with
``available_at`` set to the wake-up time (or ``None`` for "now"), keyed by
an idempotency token so duplicate calls collapse into a single live job.

Replaces the every-minute ``resume-waiting-cohorts`` cron sweep — the
worker pickup loop already runs every second and respects ``available_at``,
so wake-up latency drops from ±60s to ±~1s.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_USER_ID
from app.models.job import BackgroundJob
from app.models.orchestration import WorkflowRun


_log = logging.getLogger(__name__)


async def enqueue_resume_for_recipient(
    db: AsyncSession,
    *,
    run_id: uuid.UUID,
    recipient_id: str,
    available_at: Optional[datetime] = None,
    reason: str,
) -> Optional[uuid.UUID]:
    """Insert a delayed ``run-workflow`` resume job for a single recipient.

    ``available_at=None`` means run-now (worker picks it up on the next
    tick, ~1s). A timestamp parks the job until then.

    ``reason`` is folded into the idempotency key so different wake-up
    paths for the same recipient don't collide. Examples:
      - ``ready:bolna:<execution_id>`` — webhook/poller flipped to ready
      - ``wakeup:<unix-epoch>`` — logic.wait timer expired
    The same ``(run_id, recipient_id, reason)`` tuple resolves to the
    same idempotency key so retries don't duplicate.

    Returns the new job id, or ``None`` if the run can't be resolved
    (caller decides whether that's an error worth raising).
    """
    run = await db.scalar(
        select(WorkflowRun).where(WorkflowRun.id == run_id)
    )
    if run is None:
        _log.warning(
            "orchestration.resume_enqueue.run_missing run_id=%s recipient_id=%s",
            run_id, recipient_id,
        )
        return None

    user_id = run.triggered_by_user_id or SYSTEM_USER_ID
    idem = f"run-resume:{run_id}:{recipient_id}:{reason}"

    # Normalize to UTC-aware so the worker's `now <= available_at` check
    # is comparable. Naïve timestamps confuse the comparison silently.
    av_at = available_at
    if av_at is not None and av_at.tzinfo is None:
        av_at = av_at.replace(tzinfo=timezone.utc)

    job = BackgroundJob(
        id=uuid.uuid4(),
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        user_id=user_id,
        job_type="run-workflow",
        queue_class="standard",
        priority=5,
        status="queued",
        available_at=av_at,
        idempotency_key=idem,
        params={
            "run_id": str(run_id),
            "resume_recipient_ids": [recipient_id],
            "tenant_id": str(run.tenant_id),
            "user_id": str(user_id),
        },
    )
    db.add(job)
    return job.id


async def enqueue_bolna_correlation_poll(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    connection_id: uuid.UUID,
    correlation_id: str,
    kind: str,  # 'execution' | 'batch'
    run_id: Optional[uuid.UUID] = None,
    user_id: Optional[uuid.UUID] = None,
    initial_delay_seconds: int = 30,
) -> Optional[uuid.UUID]:
    """Insert the first poll-bolna-correlation job for a freshly dispatched
    correlation. Subsequent attempts are self-enqueued by the handler.

    Idempotency-keyed on ``bolna-poll:{correlation_id}:attempt-1`` so two
    dispatch passes for the same correlation collapse to one chain.

    Two call modes:
      - **Dispatch path** (the common case): pass ``run_id``; helper
        resolves user_id from the WorkflowRun.
      - **Anomaly-sweep path**: pass ``user_id`` directly (typically
        ``SYSTEM_USER_ID``) when the run lookup isn't worthwhile.
    """
    from datetime import timedelta

    resolved_user_id: Optional[uuid.UUID] = user_id
    if resolved_user_id is None and run_id is not None:
        run = await db.scalar(
            select(WorkflowRun).where(WorkflowRun.id == run_id)
        )
        if run is None:
            _log.warning(
                "orchestration.poll_enqueue.run_missing run_id=%s correlation_id=%s",
                run_id, correlation_id,
            )
            return None
        resolved_user_id = run.triggered_by_user_id or SYSTEM_USER_ID
    if resolved_user_id is None:
        resolved_user_id = SYSTEM_USER_ID

    now = datetime.now(timezone.utc)
    available_at = now + timedelta(seconds=initial_delay_seconds)

    job = BackgroundJob(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        job_type="poll-bolna-correlation",
        queue_class="standard",
        priority=4,
        status="queued",
        available_at=available_at,
        idempotency_key=f"bolna-poll:{correlation_id}:attempt-1",
        params={
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "app_id": app_id,
            "connection_id": str(connection_id),
            "correlation_id": correlation_id,
            "kind": kind,
            "attempt": 1,
            "first_attempt_at": now.isoformat(),
        },
    )
    db.add(job)
    return job.id
