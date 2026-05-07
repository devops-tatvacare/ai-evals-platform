"""Per-correlation Bolna poll — replaces the every-minute cron sweep.

Each ``crm.place_bolna_call`` dispatch enqueues exactly one
``poll-bolna-correlation`` BackgroundJob per distinct correlation id
(execution_id for singles, batch_id for batches). The job executes
``poll_correlation_once`` below: fetches the upstream state, hands every
terminal event to ``bolna_reconciler.apply_event`` (the same funnel the
webhook uses), then either re-enqueues itself with backoff or exits when
the correlation is fully reconciled.

Lifecycle ownership: the dispatch node creates the chain, the chain
self-terminates when nothing's left to reconcile. No global cron, no
idle wakeups, no upstream calls when the platform is quiet.

Backoff: 30s → 60s → 2m → 5m → 10m → 15m, capped at 15m thereafter.
Hard ceiling: 6 hours since first attempt — any rows still open after
that window are flushed terminal with ``bolna_outcome='bolna_poll_timeout'``
and routed via the existing ``bolna_failed`` outcome edge so workflows
that branch on outcome can dispose of the recipient.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import BackgroundJob
from app.models.orchestration import WorkflowRunRecipientAction
from app.models.provider_connection import ProviderConnection
from app.services.orchestration.connections.crypto import decrypt
from app.services.orchestration.dispatch import bolna_reconciler


_log = logging.getLogger(__name__)


# Backoff schedule per attempt. attempt=1 already fired ~30s after dispatch
# (set by the dispatch node). For attempt=2 onwards we read the delay
# below — the index is ``next_attempt - 2`` so the second wake-up uses 60s.
_BACKOFF_SECONDS: tuple[int, ...] = (60, 120, 300, 600, 900)
_BACKOFF_TAIL_SECONDS = 900  # used past the explicit schedule
_CEILING_HOURS = 6


@dataclass(frozen=True)
class CorrelationResult:
    """Per-tick outcome — what the handler returns up to the worker."""

    status: str  # 'done' | 'rescheduled' | 'ceiling_reached' | 'connection_missing' | 'no_open_rows'
    events_reconciled: int = 0
    attempt: int = 1
    next_attempt: Optional[int] = None
    error: Optional[str] = None


def _backoff_for_next_attempt(next_attempt: int) -> int:
    """Return the seconds to wait before ``next_attempt`` fires.

    ``next_attempt`` is 2-based here — the first attempt was scheduled by
    the dispatch node at +30s, so the *second* attempt onwards consults
    the table.
    """
    if next_attempt < 2:
        return 30
    idx = next_attempt - 2
    if idx < len(_BACKOFF_SECONDS):
        return _BACKOFF_SECONDS[idx]
    return _BACKOFF_TAIL_SECONDS


def _index_executions(executions: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Index batch executions by recipient_id (preferred) and execution_id."""
    out: dict[str, dict[str, Any]] = {}
    for exec_row in executions:
        if not isinstance(exec_row, dict):
            continue
        ctx = exec_row.get("context_details") or {}
        user_data = (ctx.get("recipient_data") or {}) if isinstance(ctx, dict) else {}
        if not isinstance(user_data, dict):
            user_data = exec_row.get("user_data") or {}
        recipient_id = (
            user_data.get("recipient_id")
            if isinstance(user_data, dict)
            else None
        )
        execution_id = exec_row.get("execution_id") or exec_row.get("id")
        if recipient_id:
            out[f"recipient:{recipient_id}"] = exec_row
        if execution_id:
            out[f"execution:{execution_id}"] = exec_row
    return out


async def _fetch_open_actions(
    db: AsyncSession,
    *,
    correlation_id: str,
    kind: str,
) -> list[WorkflowRunRecipientAction]:
    if kind == "execution":
        column = WorkflowRunRecipientAction.bolna_execution_id
    elif kind == "batch":
        column = WorkflowRunRecipientAction.bolna_batch_id
    else:
        raise ValueError(f"unknown correlation kind: {kind!r}")

    stmt = (
        select(WorkflowRunRecipientAction)
        .where(
            column == correlation_id,
            WorkflowRunRecipientAction.channel == "bolna",
            WorkflowRunRecipientAction.action_type == "bolna_queued",
            WorkflowRunRecipientAction.provider_terminal.is_(False),
        )
    )
    return list((await db.execute(stmt)).scalars().all())


async def _live_poll_jobs_count(
    db: AsyncSession, *, correlation_id: str,
) -> int:
    """Count currently-live polling jobs for this correlation. Used by
    the anomaly sweep to detect orphan correlations whose chain broke."""
    stmt = (
        select(func.count())
        .select_from(BackgroundJob)
        .where(
            BackgroundJob.job_type == "poll-bolna-correlation",
            BackgroundJob.idempotency_key.like(f"bolna-poll:{correlation_id}:%"),
            BackgroundJob.status.in_(("queued", "running", "retryable_failed")),
        )
    )
    return int((await db.execute(stmt)).scalar() or 0)


async def _force_timeout(
    db: AsyncSession,
    *,
    actions: list[WorkflowRunRecipientAction],
) -> int:
    """Mark every still-open row terminal with a synthetic event so the
    workflow can move on. Routes via the existing ``bolna_failed`` edge —
    no new outcome label introduced."""
    timed_out = 0
    synthetic = {
        "status": "error",
        "status_reason": "bolna_poll_timeout",
        "error_message": (
            "Bolna did not return a terminal status within the polling "
            "ceiling — marking failed so the workflow can advance."
        ),
    }
    for action in actions:
        if action.provider_terminal:
            continue
        applied = await bolna_reconciler.apply_event(db, action=action, event=synthetic)
        if applied:
            timed_out += 1
    return timed_out


async def poll_correlation_once(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    connection_id: uuid.UUID,
    correlation_id: str,
    kind: str,
    attempt: int,
    first_attempt_at: Optional[datetime] = None,
) -> CorrelationResult:
    """One tick of the per-correlation poll.

    Caller (the BackgroundJob handler) opens the session, calls this,
    commits. The function does not commit — keeps the handler responsible
    for transaction boundaries.
    """
    actions = await _fetch_open_actions(db, correlation_id=correlation_id, kind=kind)
    if not actions:
        return CorrelationResult(status="done", attempt=attempt)

    conn = await db.scalar(
        select(ProviderConnection).where(ProviderConnection.id == connection_id)
    )
    if conn is None or conn.provider != "bolna":
        return CorrelationResult(
            status="connection_missing",
            attempt=attempt,
            error=f"provider_connection {connection_id} not found or wrong provider",
        )
    config = decrypt(conn.config_encrypted)

    # Lazy-import the integration so an empty queue tick doesn't pull
    # httpx into the worker for no reason.
    from app.services.orchestration.integrations.bolna import (
        BolnaService,
        BolnaServiceError,
    )
    from app.services.orchestration.integrations.bolna_batch import (
        BolnaBatchService,
    )

    events_reconciled = 0
    upstream_error: Optional[str] = None
    try:
        if kind == "execution":
            svc = BolnaService(
                base_url=str(config.get("base_url") or ""),
                api_key=str(config.get("api_key") or ""),
                connection_id=connection_id,
            )
            event = await svc.get_execution(execution_id=correlation_id)
            if bolna_reconciler.is_terminal(event.get("status")):
                # Singles: every action carrying this execution_id gets the
                # same upstream event. In practice there's exactly one
                # action per execution_id (idempotency-keyed at dispatch).
                for action in actions:
                    if await bolna_reconciler.apply_event(db, action=action, event=event):
                        events_reconciled += 1
        else:
            bsvc = BolnaBatchService(
                base_url=str(config.get("base_url") or ""),
                api_key=str(config.get("api_key") or ""),
                connection_id=connection_id,
            )
            executions: list[dict[str, Any]] = []
            page = 1
            while True:
                payload = await bsvc.list_batch_executions(
                    correlation_id, page=page, page_size=100,
                )
                page_rows = payload.get("executions") or []
                if not isinstance(page_rows, list):
                    break
                executions.extend(page_rows)
                total = payload.get("total")
                if not isinstance(total, int):
                    break
                if len(executions) >= total or not page_rows:
                    break
                page += 1
            index = _index_executions(executions)
            for action in actions:
                event = (
                    index.get(f"recipient:{action.recipient_id}")
                    or (
                        index.get(f"execution:{action.bolna_execution_id}")
                        if action.bolna_execution_id else None
                    )
                )
                if not event or not bolna_reconciler.is_terminal(event.get("status")):
                    continue
                if await bolna_reconciler.apply_event(db, action=action, event=event):
                    events_reconciled += 1
    except BolnaServiceError as exc:
        upstream_error = f"bolna_service_error: {exc}"
        _log.warning(
            "orchestration.poll_bolna.upstream_error correlation_id=%s kind=%s attempt=%s err=%s",
            correlation_id, kind, attempt, exc,
        )
    except Exception as exc:  # noqa: BLE001 — keep the chain alive
        upstream_error = f"{exc.__class__.__name__}: {exc}"
        _log.warning(
            "orchestration.poll_bolna.transport_error correlation_id=%s kind=%s attempt=%s err=%r",
            correlation_id, kind, attempt, exc,
        )

    # Re-fetch open rows after reconciliation. If everything closed, the
    # chain dies here.
    remaining = await _fetch_open_actions(
        db, correlation_id=correlation_id, kind=kind,
    )
    if not remaining:
        return CorrelationResult(
            status="done",
            attempt=attempt,
            events_reconciled=events_reconciled,
            error=upstream_error,
        )

    # Ceiling check. ``first_attempt_at`` is supplied by the dispatch node
    # so every chain has a stable start point; missing → treat now as the
    # ceiling anchor (fresh chain).
    now = datetime.now(timezone.utc)
    anchor = first_attempt_at or now
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    ceiling = anchor + timedelta(hours=_CEILING_HOURS)
    if now >= ceiling:
        timed_out = await _force_timeout(db, actions=remaining)
        _log.warning(
            "orchestration.poll_bolna.ceiling_reached correlation_id=%s kind=%s "
            "attempts=%s timed_out=%s",
            correlation_id, kind, attempt, timed_out,
        )
        return CorrelationResult(
            status="ceiling_reached",
            attempt=attempt,
            events_reconciled=events_reconciled + timed_out,
            error=upstream_error,
        )

    # Self-replicate. Cap the next available_at at the ceiling so we don't
    # schedule past it.
    next_attempt = attempt + 1
    delay_seconds = _backoff_for_next_attempt(next_attempt)
    next_at = now + timedelta(seconds=delay_seconds)
    if next_at > ceiling:
        next_at = ceiling

    # ON CONFLICT DO NOTHING is the idempotency contract for the chain.
    # If this handler crashes after committing the next-attempt insert
    # but before the worker marks the current job complete, the worker's
    # retry runs the handler again — and the same insert lands on the
    # partial unique index ``uq_background_jobs_user_idempotency_key``,
    # silently no-ops, and the chain continues exactly once. The shared
    # ``_idempotent_insert`` helper owns the index_elements / index_where
    # tuple so the inferred ON CONFLICT target stays consistent with
    # the partial-index definition on BackgroundJob.
    from app.services.orchestration.dispatch.resume_enqueue import (
        _idempotent_insert,
    )
    await _idempotent_insert(
        db,
        values={
            "id": uuid.uuid4(),
            "tenant_id": tenant_id,
            "user_id": user_id,
            "app_id": app_id,
            "job_type": "poll-bolna-correlation",
            "queue_class": "standard",
            "priority": 4,
            "status": "queued",
            "available_at": next_at,
            "idempotency_key": f"bolna-poll:{correlation_id}:attempt-{next_attempt}",
            "params": {
                "tenant_id": str(tenant_id),
                "user_id": str(user_id),
                "app_id": app_id,
                "connection_id": str(connection_id),
                "correlation_id": correlation_id,
                "kind": kind,
                "attempt": next_attempt,
                "first_attempt_at": anchor.isoformat(),
            },
        },
    )
    return CorrelationResult(
        status="rescheduled",
        attempt=attempt,
        next_attempt=next_attempt,
        events_reconciled=events_reconciled,
        error=upstream_error,
    )


@dataclass(frozen=True)
class OrphanCorrelation:
    connection_id: uuid.UUID
    correlation_id: str
    kind: str  # 'execution' | 'batch'
    app_id: str
    tenant_id: uuid.UUID


async def find_orphan_correlations(
    db: AsyncSession, *, older_than: timedelta,
) -> list[OrphanCorrelation]:
    """Anomaly-sweep helper. Returns one entry per (connection_id,
    correlation_id, kind) whose chain has broken — i.e. open Bolna rows
    older than ``older_than`` with no live polling job.

    The polling job's idempotency-key prefix is
    ``bolna-poll:{correlation_id}:`` — the LIKE check filters live jobs
    scoped to this correlation. Runs at most once a day; correctness
    over micro-optimisation.
    """
    cutoff = datetime.now(timezone.utc) - older_than
    open_rows_stmt = (
        select(WorkflowRunRecipientAction)
        .where(
            WorkflowRunRecipientAction.channel == "bolna",
            WorkflowRunRecipientAction.action_type == "bolna_queued",
            WorkflowRunRecipientAction.provider_terminal.is_(False),
            WorkflowRunRecipientAction.created_at < cutoff,
            or_(
                WorkflowRunRecipientAction.bolna_execution_id.isnot(None),
                WorkflowRunRecipientAction.bolna_batch_id.isnot(None),
            ),
        )
    )
    rows = list((await db.execute(open_rows_stmt)).scalars().all())

    seen: set[tuple[str, str]] = set()
    out: list[OrphanCorrelation] = []
    for row in rows:
        if row.bolna_execution_id:
            kind = "execution"
            correlation_id = str(row.bolna_execution_id)
        else:
            kind = "batch"
            correlation_id = str(row.bolna_batch_id)
        if (kind, correlation_id) in seen:
            continue
        seen.add((kind, correlation_id))
        if await _live_poll_jobs_count(db, correlation_id=correlation_id) > 0:
            continue
        payload = row.payload or {}
        cid_raw = payload.get("connection_id")
        if not cid_raw:
            continue
        try:
            connection_id = uuid.UUID(str(cid_raw))
        except (TypeError, ValueError):
            continue
        out.append(
            OrphanCorrelation(
                connection_id=connection_id,
                correlation_id=correlation_id,
                kind=kind,
                app_id=row.app_id,
                tenant_id=row.tenant_id,
            )
        )
    return out
