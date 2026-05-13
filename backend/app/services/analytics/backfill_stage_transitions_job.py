"""Stage-transition backfill job (Phase 6).

Drives a keyset-paginated scan over ``analytics.crm_lead_record`` for one
``(tenant_id, app_id)`` pair and emits one row per lead with a non-empty
``prospect_stage`` into ``analytics.fact_lead_stage_transition``. Stamped
with ``sync_run_id`` so rollback is a single DELETE.

Phase 6 of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

Why this is a single "current stage" row per lead and not a reconstructed
history walk: the lead mirror's ``raw_payload`` is the LSQ Lead snapshot
(one stage at sync time, no event history). LSQ's per-activity payloads
on ``crm_call_record`` don't reliably carry the lead's stage-at-call-time.
A real historical timeline would require syncing LSQ's stage-modification
activity stream — that's a follow-up extension to the Phase 4 activity
sync path, not a Phase 6 LLM reconstruction.

The steady-state writer in ``inside_sales_sync._append_lead_stage_transitions``
captures every transition going forward, so the backfill's job is purely
to make ``fact_lead_stage_transition`` non-empty for leads that already
exist — giving Sherlock "how many leads in stage X" answers from day one.

CRM-agnostic naming. This is not "inside-sales stage backfill" — the same
path serves any future CRM-backed app via the ``app_id`` param.

Idempotency:
  * Upsert conflict key is the partial unique index
    ``uq_fact_lead_stage_transition_backfill`` =
    ``(tenant_id, app_id, lead_id, to_stage, detected_at) WHERE
    sync_run_id IS NOT NULL`` (migration 0041).
  * ``detected_at`` is derived from the lead's ``created_on`` (or
    ``first_synced_at`` when ``created_on`` is null). Source-state-derived,
    not wall-clock — so rerunning the backfill over leads whose mirror
    state has not changed produces the same ``detected_at`` and the
    upsert collapses to one row per ``(lead, to_stage)``.
  * If a lead's stage has since changed, the steady-state writer has
    already emitted a separate fact row with the newer ``to_stage`` and
    its own ``detected_at`` — so the backfill row stays correctly pinned
    to the original observation.

Rollback:
  * ``DELETE FROM analytics.fact_lead_stage_transition WHERE sync_run_id = '<id>'``.

Watermark:
  * Records ``MAX(crm_lead_record.last_synced_at)`` across the scanned
    window on the log row's ``metadata_.watermark_to``. Watermark advances
    on success only; failures leave it untouched so the next run replays
    the same window.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.analytics_lead_facts import FactLeadStageTransition
from app.models.analytics_log import LogFactPopulationRun
from app.models.source_records import CrmLeadRecord, LogCrmSourceSync

_log = logging.getLogger(__name__)

# ── tunables ─────────────────────────────────────────────────────────────

MIN_BATCH_SIZE = 100
MAX_BATCH_SIZE = 5_000
DEFAULT_BATCH_SIZE = 1_000

MIN_MAX_LEADS = 1
MAX_MAX_LEADS = 100_000
DEFAULT_MAX_LEADS = 100_000

# Unix epoch sentinel for leads whose mirror has neither ``created_on``
# nor ``first_synced_at`` populated. Should never happen in practice (the
# mirror writer guarantees ``first_synced_at`` server-default), but the
# sentinel keeps the partial unique key from collapsing across such rows.
_EPOCH_SENTINEL = datetime(1970, 1, 1, tzinfo=timezone.utc)


# ── request shape ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BackfillRequest:
    app_id: str
    dry_run: bool
    max_leads: int
    batch_size: int
    started_after: datetime | None
    ended_before: datetime | None


def parse_request(params: dict[str, Any]) -> BackfillRequest:
    """Parse + sanity-check params off a ``background_jobs.params`` dict.

    Duplicates the Pydantic validation in the admin endpoint so jobs
    submitted via other paths (replay tooling, ops console) still get
    bounds-checked. ``None`` / missing key → default; explicit 0 / negative
    → fail (no ``or DEFAULT`` shorthand because it masks 0 as "not present").
    """
    app_id = str(params.get("app_id") or "").strip()
    if not app_id:
        raise ValueError("backfill-stage-transitions requires app_id")

    raw_max_leads = params.get("max_leads")
    max_leads = (
        int(raw_max_leads) if raw_max_leads is not None else DEFAULT_MAX_LEADS
    )
    if not MIN_MAX_LEADS <= max_leads <= MAX_MAX_LEADS:
        raise ValueError(
            f"max_leads {max_leads} out of bounds "
            f"[{MIN_MAX_LEADS}, {MAX_MAX_LEADS}]"
        )

    raw_batch_size = params.get("batch_size")
    batch_size = (
        int(raw_batch_size) if raw_batch_size is not None else DEFAULT_BATCH_SIZE
    )
    if not MIN_BATCH_SIZE <= batch_size <= MAX_BATCH_SIZE:
        raise ValueError(
            f"batch_size {batch_size} out of bounds "
            f"[{MIN_BATCH_SIZE}, {MAX_BATCH_SIZE}]"
        )

    return BackfillRequest(
        app_id=app_id,
        dry_run=bool(params.get("dry_run")),
        max_leads=max_leads,
        batch_size=batch_size,
        started_after=_coerce_optional_datetime(params.get("started_after")),
        ended_before=_coerce_optional_datetime(params.get("ended_before")),
    )


def _coerce_optional_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    if isinstance(value, str):
        normalized = value.strip()
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError(
                f"invalid datetime literal {value!r}; expected ISO 8601"
            ) from exc
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    raise ValueError(
        f"unsupported datetime type {type(value).__name__} for backfill window"
    )


# ── counters ─────────────────────────────────────────────────────────────


@dataclass
class _BackfillCounters:
    leads_scanned: int = 0
    leads_projected: int = 0
    leads_skipped_blank_stage: int = 0
    rows_upserted: int = 0
    rows_inserted: int = 0
    rows_updated: int = 0
    last_error: str | None = None
    error_samples: list[dict[str, Any]] = field(default_factory=list)
    watermark_to: datetime | None = None

    def to_metadata(
        self,
        *,
        request: BackfillRequest,
        sync_run_id: uuid.UUID,
    ) -> dict[str, Any]:
        return {
            "app_id": request.app_id,
            "dry_run": request.dry_run,
            "max_leads": request.max_leads,
            "batch_size": request.batch_size,
            "started_after": (
                request.started_after.isoformat()
                if request.started_after else None
            ),
            "ended_before": (
                request.ended_before.isoformat()
                if request.ended_before else None
            ),
            "sync_run_id": str(sync_run_id),
            "leads_scanned": self.leads_scanned,
            "leads_projected": self.leads_projected,
            "leads_skipped_blank_stage": self.leads_skipped_blank_stage,
            "rows_upserted": self.rows_upserted,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "watermark_to": (
                self.watermark_to.isoformat() if self.watermark_to else None
            ),
            "error_samples": self.error_samples,
        }


# ── candidate count + detected_at derivation ────────────────────────────


async def count_candidate_leads(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    request: BackfillRequest,
) -> int:
    """Count leads with non-empty ``prospect_stage`` in the configured window.

    Capped at ``max_leads`` so dry-run estimates and the live cursor agree.
    Blank-stage leads are excluded because the backfill skips them anyway.
    """
    stmt = select(func.count(CrmLeadRecord.id)).where(
        CrmLeadRecord.tenant_id == tenant_id,
        CrmLeadRecord.app_id == request.app_id,
        # prospect_stage now lives inside raw_payload (Phase 9). Filter
        # via JSONB key access: row is in scope iff raw_payload->>'prospect_stage'
        # is non-empty after trimming.
        func.coalesce(
            func.nullif(
                func.trim(CrmLeadRecord.raw_payload.op("->>")("prospect_stage")),
                "",
            ),
            None,
        ) != None,  # noqa: E711
    )
    ts_col = func.coalesce(CrmLeadRecord.created_on, CrmLeadRecord.first_synced_at)
    if request.started_after is not None:
        stmt = stmt.where(ts_col >= request.started_after)
    if request.ended_before is not None:
        stmt = stmt.where(ts_col < request.ended_before)
    result = await session.execute(stmt)
    raw = int(result.scalar() or 0)
    return min(raw, request.max_leads)


def _detected_at_for(lead: CrmLeadRecord) -> datetime:
    """Source-state-derived observation time for the partial unique key.

    Prefers ``created_on`` (the LSQ-side creation timestamp — stable across
    reruns and across mirror replays). Falls back to ``first_synced_at``
    when LSQ never returned a ``CreatedOn``. Epoch sentinel as a last
    resort so the partial unique key never collapses across malformed rows.
    """
    raw = lead.created_on or lead.first_synced_at
    if raw is None:
        return _EPOCH_SENTINEL
    return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)


# ── main entrypoint ──────────────────────────────────────────────────────


async def run_backfill_stage_transitions(
    *,
    job_id: Any,
    params: dict[str, Any],
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Job handler body. Returns a summary dict for ``BackgroundJob.result``."""
    request = parse_request(params)
    started_at = datetime.now(timezone.utc)
    counters = _BackfillCounters()

    if request.dry_run:
        async with async_session() as session:
            lead_count = await count_candidate_leads(
                session, tenant_id=tenant_id, request=request
            )
        return {
            "dry_run": True,
            "lead_count": lead_count,
        }

    sync_run_id: uuid.UUID | None = None
    log_row_id: uuid.UUID | None = None

    try:
        async with async_session() as bookkeeping:
            async with bookkeeping.begin():
                sync_run = LogCrmSourceSync(
                    tenant_id=tenant_id,
                    app_id=request.app_id,
                    source_system="backfill",
                    source_family="stage_transitions",
                    sync_mode="backfill",
                    status="running",
                    requested_by_user_id=user_id,
                    watermark_from=(
                        request.started_after.isoformat()
                        if request.started_after else None
                    ),
                    watermark_to=(
                        request.ended_before.isoformat()
                        if request.ended_before else None
                    ),
                    started_at=started_at,
                    details={
                        "jobType": "backfill-stage-transitions",
                        "maxLeads": request.max_leads,
                        "batchSize": request.batch_size,
                    },
                    job_id=_coerce_uuid(job_id),
                    is_scheduled_run=False,
                )
                bookkeeping.add(sync_run)
                await bookkeeping.flush()
                sync_run_id = sync_run.id

                log_row = LogFactPopulationRun(
                    tenant_id=tenant_id,
                    app_id=request.app_id,
                    job_type="backfill-stage-transitions",
                    status="running",
                    started_at=started_at,
                    metadata_={"sync_run_id": str(sync_run_id)},
                )
                bookkeeping.add(log_row)
                await bookkeeping.flush()
                log_row_id = log_row.id

        assert sync_run_id is not None
        assert log_row_id is not None

        await _drive_backfill(
            job_id=job_id,
            request=request,
            tenant_id=tenant_id,
            sync_run_id=sync_run_id,
            counters=counters,
        )

        await _finalize_log_row(
            log_row_id=log_row_id,
            sync_run_id=sync_run_id,
            started_at=started_at,
            status="success",
            error_message=None,
            counters=counters,
            request=request,
        )
    except Exception as exc:
        if log_row_id is not None and sync_run_id is not None:
            try:
                await _finalize_log_row(
                    log_row_id=log_row_id,
                    sync_run_id=sync_run_id,
                    started_at=started_at,
                    status="error",
                    error_message=f"{type(exc).__name__}: {exc}",
                    counters=counters,
                    request=request,
                )
            except Exception:
                _log.exception(
                    "failed to finalize stage-transition backfill log; "
                    "surfacing original job error"
                )
        _log.exception(
            "backfill-stage-transitions failed sync_run_id=%s app_id=%s",
            sync_run_id,
            request.app_id,
        )
        raise

    return {
        "dry_run": False,
        "sync_run_id": str(sync_run_id),
        "leads_scanned": counters.leads_scanned,
        "leads_projected": counters.leads_projected,
        "leads_skipped_blank_stage": counters.leads_skipped_blank_stage,
        "rows_upserted": counters.rows_upserted,
        "rows_inserted": counters.rows_inserted,
        "rows_updated": counters.rows_updated,
        "watermark_to": (
            counters.watermark_to.isoformat() if counters.watermark_to else None
        ),
    }


def _coerce_uuid(value: Any) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None


# ── batching ─────────────────────────────────────────────────────────────


async def _drive_backfill(
    *,
    job_id: Any,
    request: BackfillRequest,
    tenant_id: uuid.UUID,
    sync_run_id: uuid.UUID,
    counters: _BackfillCounters,
) -> None:
    """Walk the lead mirror keyset-paginated; project + upsert per batch."""
    from app.services.job_worker import (
        JobCancelledError,
        is_job_cancelled,
        update_job_progress,
    )

    last_ts: datetime | None = None
    last_lead_id: str | None = None
    leads_remaining = request.max_leads

    while leads_remaining > 0:
        if await is_job_cancelled(job_id, tenant_id=tenant_id):
            raise JobCancelledError("Stage-transition backfill cancelled")

        page_limit = min(request.batch_size, leads_remaining)

        async with async_session() as batch_session:
            async with batch_session.begin():
                leads = await _fetch_lead_batch(
                    batch_session,
                    request=request,
                    tenant_id=tenant_id,
                    after=(last_ts, last_lead_id),
                    limit=page_limit,
                )
                if not leads:
                    break
                counters.leads_scanned += len(leads)

                projected_rows: list[dict[str, Any]] = []
                for lead in leads:
                    # Resilient to legacy test stubs that may not carry a
                    # ``bag`` property — fall back to attribute access.
                    bag = getattr(lead, "bag", None)
                    if isinstance(bag, dict):
                        raw_stage = bag.get("prospect_stage")
                    else:
                        raw_stage = getattr(lead, "prospect_stage", None)
                    current_stage = (raw_stage or "").strip()
                    if not current_stage:
                        counters.leads_skipped_blank_stage += 1
                        continue
                    projected_rows.append(
                        {
                            "id": uuid.uuid4(),
                            "tenant_id": lead.tenant_id,
                            "app_id": lead.app_id,
                            "lead_id": lead.lead_id,
                            "from_stage": None,
                            "to_stage": current_stage,
                            "detected_at": _detected_at_for(lead),
                            "transition_at": None,
                            "sync_run_id": sync_run_id,
                            "attributes": {},
                        }
                    )
                    counters.leads_projected += 1

                if projected_rows:
                    inserted, updated = await _upsert_stage_rows(
                        batch_session, rows=projected_rows
                    )
                    counters.rows_upserted += inserted + updated
                    counters.rows_inserted += inserted
                    counters.rows_updated += updated

                # Advance the cursor + the watermark.
                tail = leads[-1]
                last_ts = tail.created_on or tail.first_synced_at
                last_lead_id = tail.lead_id
                if tail.last_synced_at is not None:
                    tail_synced = (
                        tail.last_synced_at
                        if tail.last_synced_at.tzinfo
                        else tail.last_synced_at.replace(tzinfo=timezone.utc)
                    )
                    if (
                        counters.watermark_to is None
                        or tail_synced > counters.watermark_to
                    ):
                        counters.watermark_to = tail_synced

                leads_remaining -= len(leads)

        await update_job_progress(
            job_id,
            counters.leads_scanned,
            counters.leads_scanned + request.batch_size,
            f"Backfilled {counters.rows_upserted} stage transitions across "
            f"{counters.leads_scanned} lead(s)",
            sync_run_id=str(sync_run_id),
        )


async def _fetch_lead_batch(
    session: AsyncSession,
    *,
    request: BackfillRequest,
    tenant_id: uuid.UUID,
    after: tuple[datetime | None, str | None],
    limit: int,
) -> list[CrmLeadRecord]:
    """Keyset-paginated SELECT over crm_lead_record.

    Cursor is ``(coalesce(created_on, first_synced_at), lead_id)`` so the
    cursor key matches the ``detected_at`` derivation — pages don't re-emit
    rows already processed. Strict ``(ts, tb) > (last_ts, last_lead_id)``
    via the OR clause; rows with duplicate timestamps at page boundaries
    advance correctly.
    """
    ts_col = func.coalesce(CrmLeadRecord.created_on, CrmLeadRecord.first_synced_at)

    stmt = select(CrmLeadRecord).where(
        CrmLeadRecord.tenant_id == tenant_id,
        CrmLeadRecord.app_id == request.app_id,
        # prospect_stage now lives inside raw_payload (Phase 9). Filter
        # via JSONB key access: row is in scope iff raw_payload->>'prospect_stage'
        # is non-empty after trimming.
        func.coalesce(
            func.nullif(
                func.trim(CrmLeadRecord.raw_payload.op("->>")("prospect_stage")),
                "",
            ),
            None,
        ) != None,  # noqa: E711
    )
    if request.started_after is not None:
        stmt = stmt.where(ts_col >= request.started_after)
    if request.ended_before is not None:
        stmt = stmt.where(ts_col < request.ended_before)

    last_ts, last_lead_id = after
    if last_ts is not None and last_lead_id is not None:
        stmt = stmt.where(
            and_(
                ts_col >= last_ts,
                ((ts_col > last_ts) | (CrmLeadRecord.lead_id > last_lead_id)),
            )
        )

    stmt = stmt.order_by(ts_col, CrmLeadRecord.lead_id).limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def _upsert_stage_rows(
    session: AsyncSession, *, rows: list[dict[str, Any]]
) -> tuple[int, int]:
    """ON CONFLICT DO UPDATE on the backfill partial unique key.

    Conflict target = ``(tenant_id, app_id, lead_id, detected_at)`` with
    ``index_where`` matching the partial predicate
    ``sync_run_id IS NOT NULL`` so Postgres picks the right index.
    ``to_stage`` is UPDATEd on conflict, not part of the key: a lead has
    exactly one ``prospect_stage`` at any single observation moment, so
    a rerun against the same source state (same ``detected_at``) should
    refresh the seed row's ``to_stage`` rather than fork into a second
    row. ``xmax`` distinguishes inserted (0) vs updated (non-zero) in
    one round-trip.
    """
    if not rows:
        return (0, 0)

    from sqlalchemy import text as _text

    stmt = pg_insert(FactLeadStageTransition).values(rows)
    excluded = stmt.excluded
    stmt = stmt.on_conflict_do_update(
        index_elements=[
            FactLeadStageTransition.tenant_id,
            FactLeadStageTransition.app_id,
            FactLeadStageTransition.lead_id,
            FactLeadStageTransition.detected_at,
        ],
        index_where=_text("sync_run_id IS NOT NULL"),
        set_={
            "from_stage": excluded.from_stage,
            "to_stage": excluded.to_stage,
            "transition_at": excluded.transition_at,
            "attributes": excluded.attributes,
            "sync_run_id": excluded.sync_run_id,
        },
    ).returning(_text("xmax"))

    result = await session.execute(stmt)
    inserted = 0
    updated = 0
    for (xmax,) in result.all():
        try:
            xmax_int = int(xmax or 0)
        except (TypeError, ValueError):
            xmax_int = 0
        if xmax_int == 0:
            inserted += 1
        else:
            updated += 1
    return (inserted, updated)


# ── log row finalization ─────────────────────────────────────────────────


async def _finalize_log_row(
    *,
    log_row_id: uuid.UUID,
    sync_run_id: uuid.UUID,
    started_at: datetime,
    status: str,
    error_message: str | None,
    counters: _BackfillCounters,
    request: BackfillRequest,
) -> None:
    """Close out the log row + sync_run row. Watermark advances on success only."""
    completed_at = datetime.now(timezone.utc)
    duration_ms = max(0.0, (completed_at - started_at).total_seconds() * 1000.0)

    async with async_session() as session:
        async with session.begin():
            log_row = await session.get(LogFactPopulationRun, log_row_id)
            if log_row is not None:
                log_row.status = status
                log_row.completed_at = completed_at
                log_row.duration_ms = duration_ms
                log_row.rows_inserted = counters.rows_inserted
                log_row.rows_updated = counters.rows_updated
                log_row.error_message = error_message
                log_row.metadata_ = counters.to_metadata(
                    request=request,
                    sync_run_id=sync_run_id,
                )

            sync_run = await session.get(LogCrmSourceSync, sync_run_id)
            if sync_run is not None:
                sync_run.status = "completed" if status == "success" else "failed"
                sync_run.completed_at = completed_at
                sync_run.records_scanned = counters.leads_scanned
                sync_run.records_upserted = counters.rows_upserted
                sync_run.records_failed = 0
                if error_message is not None:
                    sync_run.error_message = error_message
                # Watermark advances ONLY on success.
                if status == "success" and counters.watermark_to is not None:
                    sync_run.watermark_to = counters.watermark_to.isoformat()
                sync_run.details = dict(sync_run.details or {}, **{
                    "leadsScanned": counters.leads_scanned,
                    "leadsProjected": counters.leads_projected,
                    "leadsSkippedBlankStage": counters.leads_skipped_blank_stage,
                    "rowsInserted": counters.rows_inserted,
                    "rowsUpdated": counters.rows_updated,
                })


__all__ = [
    "BackfillRequest",
    "DEFAULT_BATCH_SIZE",
    "DEFAULT_MAX_LEADS",
    "MAX_BATCH_SIZE",
    "MAX_MAX_LEADS",
    "MIN_BATCH_SIZE",
    "MIN_MAX_LEADS",
    "count_candidate_leads",
    "parse_request",
    "run_backfill_stage_transitions",
]
