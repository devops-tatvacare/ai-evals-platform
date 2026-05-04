"""Single source of truth for delayed BackgroundJob enqueue (resume + poll).

Two helpers, two call shapes — both idempotent on the
``uq_background_jobs_user_idempotency_key`` partial unique index. Concurrent
producers (webhook + poller, dispatch retry, anomaly-sweep TOCTOU) collapse
into a single live job instead of raising ``IntegrityError``.

  1. ``enqueue_resume_for_recipient`` — drives the workflow forward when a
     recipient transitions to ``ready`` (webhook/poller path) or its
     ``wakeup_at`` arrives (logic.wait suspend). Replaces the every-minute
     ``resume-waiting-cohorts`` cron.

  2. ``enqueue_bolna_correlation_poll`` — kicks off (attempt 1) or restarts
     (anomaly sweep) a per-correlation Bolna polling chain. Replaces the
     every-minute ``poll-bolna-executions`` cron.

Both write through ``pg_insert(...).on_conflict_do_nothing(...)`` so a
duplicate idempotency key doesn't blow up the caller's transaction. The
helpers return the new job id when the row was inserted, ``None`` on
conflict — callers can use the return value to decide whether to log
"first time scheduled" telemetry without retrying the insert.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_USER_ID
from app.models.job import BackgroundJob
from app.models.orchestration import WorkflowRun


_log = logging.getLogger(__name__)


# The dedup contract is a *partial unique index* (see
# ``app/models/job.py::uq_background_jobs_user_idempotency_key`` —
# ``unique=True`` + ``postgresql_where=text("idempotency_key IS NOT NULL")``).
# Postgres ``ON CONFLICT ON CONSTRAINT`` only works for declared
# constraints, not for indexes — so the inferred form (column tuple +
# index_where) is the correct target. The shape of these tuples MUST
# stay in sync with the index definition; tests assert that explicitly.
_IDEMPOTENCY_INDEX_ELEMENTS: tuple[str, ...] = (
    "tenant_id", "user_id", "idempotency_key",
)
_IDEMPOTENCY_INDEX_WHERE = text("idempotency_key IS NOT NULL")


async def _idempotent_insert(
    db: AsyncSession, *, values: dict,
) -> Optional[uuid.UUID]:
    """``pg_insert(...).on_conflict_do_nothing(...).returning(id)`` — the
    canonical "create or no-op" idiom for BackgroundJob. Returns the new
    job id when the insert succeeded, ``None`` when the partial unique
    index already had a live row with the same idempotency key."""
    stmt = (
        pg_insert(BackgroundJob)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=list(_IDEMPOTENCY_INDEX_ELEMENTS),
            index_where=_IDEMPOTENCY_INDEX_WHERE,
        )
        .returning(BackgroundJob.id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


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
    tick, ±~1s). A timestamp parks the job until then — used by
    ``logic.wait`` to schedule the wake-up at the exact instant.

    ``reason`` is folded into the idempotency key so different wake-up
    paths for the same recipient don't collide. Examples used today:
      - ``ready:bolna:<execution_id>:<outcome>`` — webhook flipped to ready
      - ``ready:wati:<event>:<localMessageId>`` — WATI webhook
      - ``ready:reconcile:<action_id>`` — shared reconciler funnel
      - ``wakeup:<unix-epoch>`` — logic.wait timer expired

    Returns the new job id when scheduled, ``None`` if a live job with the
    same idempotency key already exists (legitimate de-dup), or ``None``
    with a warning log when the run row can't be resolved.
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

    # Normalize to UTC-aware so the worker's ``now <= available_at`` check
    # is comparable. Naïve timestamps silently mis-compare under asyncpg.
    av_at = available_at
    if av_at is not None and av_at.tzinfo is None:
        av_at = av_at.replace(tzinfo=timezone.utc)

    return await _idempotent_insert(
        db,
        values={
            "id": uuid.uuid4(),
            "tenant_id": run.tenant_id,
            "app_id": run.app_id,
            "user_id": user_id,
            "job_type": "run-workflow",
            "queue_class": "standard",
            "priority": 5,
            "status": "queued",
            "available_at": av_at,
            "idempotency_key": idem,
            "params": {
                "run_id": str(run_id),
                "resume_recipient_ids": [recipient_id],
                "tenant_id": str(run.tenant_id),
                "user_id": str(user_id),
            },
        },
    )


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
    """Schedule the first poll for a freshly dispatched Bolna correlation.

    Idempotency key: ``bolna-poll:{correlation_id}:attempt-1`` — guarantees
    that two concurrent dispatch passes for the same correlation collapse
    into one polling chain instead of duplicating it.

    Two call modes:
      - **Dispatch path** (common): pass ``run_id``; helper resolves
        ``user_id`` from the WorkflowRun.
      - **Anomaly-sweep path**: pass ``user_id`` directly (typically
        ``SYSTEM_USER_ID``) when no run is in scope.

    Returns the new job id, or ``None`` on conflict / unresolved run.
    """
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

    return await _idempotent_insert(
        db,
        values={
            "id": uuid.uuid4(),
            "tenant_id": tenant_id,
            "app_id": app_id,
            "user_id": resolved_user_id,
            "job_type": "poll-bolna-correlation",
            "queue_class": "standard",
            "priority": 4,
            "status": "queued",
            "available_at": available_at,
            "idempotency_key": f"bolna-poll:{correlation_id}:attempt-1",
            "params": {
                "tenant_id": str(tenant_id),
                "user_id": str(resolved_user_id),
                "app_id": app_id,
                "connection_id": str(connection_id),
                "correlation_id": correlation_id,
                "kind": kind,
                "attempt": 1,
                "first_attempt_at": now.isoformat(),
            },
        },
    )
