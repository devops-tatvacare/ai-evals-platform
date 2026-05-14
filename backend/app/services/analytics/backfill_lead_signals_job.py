"""Lead-signal backfill job — the operator-triggered ``llm_profile`` driver.

Phase 5 introduced this; Phase 11B rewired it onto the signal derivation
framework. The job is now pure **orchestration**: cost budget + dry-run,
bookkeeping (``log_crm_source_sync`` + ``log_fact_population_run``),
keyset pagination, watermark, cancellation. The per-lead derivation —
extraction input, the LLM call, projection to signal rows — lives in the
``llm_profile`` strategy (``signal_derivation/llm_profile_strategy.py``).

Source surface: ``analytics.dim_lead`` — the normalized serving surface
(invariant 21), never ``crm_lead_record`` / ``raw_payload``. The job
keyset-paginates ``dim_lead`` by ``(updated_at, lead_id)`` and hands each
batch to the strategy via ``get_strategy("llm_profile").derive(...)``,
then persists with the shared ``upsert_derived_signals`` keyed on
``uq_fact_lead_signal_framework``. Every row carries
``signal_definition_id`` (the resolved ``llm_profile`` definition) and
``sync_run_id`` (this run's rollback handle).

LLM contract: the strategy receives a ``LoggingLLMWrapper`` via the
``StrategyContext`` so ``analytics.fact_llm_generation`` records one row
per call; the per-call usage callback aggregates actual cost.

Idempotency: ``detected_at`` is ``dim_lead.updated_at`` (source-state-
derived), so a re-run over unchanged lead state collapses on the
framework key; a re-synced lead advances ``updated_at`` and emits a fresh
observation. Rollback: ``DELETE FROM analytics.fact_lead_signal WHERE
sync_run_id = '<id>'`` (LLM cost is not recoverable).
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.analytics_lead_facts import DimLead
from app.models.analytics_log import LogFactPopulationRun
from app.models.analytics_signal_definition import SignalDefinition
from app.models.source_records import LogCrmSourceSync
from app.services.analytics.signal_derivation.base import StrategyContext
from app.services.analytics.signal_derivation.persistence import (
    upsert_derived_signals,
)
from app.services.analytics.signal_derivation.registry import get_strategy
from app.services.analytics.signal_derivation.resolution import (
    resolve_effective_definition,
)

_log = logging.getLogger(__name__)

# ── tunables ─────────────────────────────────────────────────────────────

MIN_BATCH_SIZE = 100
MAX_BATCH_SIZE = 5_000
DEFAULT_BATCH_SIZE = 500

MIN_MAX_LEADS = 1
MAX_MAX_LEADS = 50_000
DEFAULT_MAX_LEADS = 30_000

# Conservative default in USD. Operator can raise if dry-run reports a
# higher projection. The handler refuses to start if the dry-run estimate
# exceeds this budget.
DEFAULT_COST_BUDGET_USD = 15.0

# Plan §11 targets ~$10 for ~30k leads on the inside-sales backfill, which
# lands at ~$0.0004 per lead on Gemini 2.5 Flash class (the plan's headline
# "~$0.01 per lead" was a transcription error — $0.01 × 30k = $300, not $10).
# Override-able by operator; used purely for the dry-run / pre-flight
# estimate (real cost comes from the per-call usage callback aggregate).
DEFAULT_PER_LEAD_COST_USD = 0.0004
DEFAULT_PROMPT_TOKEN_ESTIMATE = 1_200

# Extraction subsystem label written on every analytics.fact_llm_generation
# row so cost dashboards can isolate the backfill from steady-state LLM use.
USAGE_SUBSYSTEM = "lead_signal_backfill"
USAGE_CALL_PURPOSE = "lead_signal_extraction"

# The LLM response schema, prompt, and per-lead extraction logic moved into
# ``signal_derivation/llm_profile_strategy.py`` (Phase 11B). This module is
# now just the job orchestration: pagination, cost budget, bookkeeping,
# watermark — it calls the ``llm_profile`` strategy for the derivation.


# ── request shape ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BackfillRequest:
    app_id: str
    dry_run: bool
    max_leads: int
    batch_size: int
    cost_budget_usd: float
    started_after: datetime | None
    ended_before: datetime | None


def parse_request(params: dict[str, Any]) -> BackfillRequest:
    """Parse + sanity-check params off a ``background_jobs.params`` dict.

    The admin endpoint validates against a Pydantic schema; this parser is
    the second line of defense for jobs submitted via other paths (replay
    tooling, ops console). A malformed payload should crash loudly.
    """
    app_id = str(params.get("app_id") or "").strip()
    if not app_id:
        raise ValueError("backfill-lead-signals requires app_id")

    # ``None`` / missing key → default; an explicit 0 / negative value → fail.
    # The ``or DEFAULT`` shorthand would mask 0 as "not present"; tests
    # depend on the strict reading.
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

    raw_budget = params.get("cost_budget_usd")
    cost_budget_usd = (
        float(raw_budget) if raw_budget is not None else DEFAULT_COST_BUDGET_USD
    )
    if cost_budget_usd <= 0:
        raise ValueError("cost_budget_usd must be positive")

    return BackfillRequest(
        app_id=app_id,
        dry_run=bool(params.get("dry_run")),
        max_leads=max_leads,
        batch_size=batch_size,
        cost_budget_usd=cost_budget_usd,
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


# ── counters / breadcrumb shape ──────────────────────────────────────────


@dataclass
class _BackfillCounters:
    # Phase 11B — the per-lead derivation moved into the llm_profile
    # strategy, which logs and skips a failed lead internally. The job
    # tracks only what it can still observe: a failed lead produces no
    # rows, so it folds into ``leads_skipped``; ``rows_upserted`` is the
    # framework upsert's row count (no insert/update split).
    leads_scanned: int = 0
    leads_extracted: int = 0
    leads_skipped: int = 0
    rows_upserted: int = 0
    llm_calls: int = 0
    cost_usd_actual: float = 0.0
    watermark_to: datetime | None = None

    def to_metadata(
        self,
        *,
        request: BackfillRequest,
        sync_run_id: uuid.UUID,
        estimated_cost_usd: float,
    ) -> dict[str, Any]:
        return {
            "app_id": request.app_id,
            "dry_run": request.dry_run,
            "max_leads": request.max_leads,
            "batch_size": request.batch_size,
            "cost_budget_usd": request.cost_budget_usd,
            "estimated_cost_usd": estimated_cost_usd,
            "cost_usd_actual": self.cost_usd_actual,
            "started_after": (
                request.started_after.isoformat() if request.started_after else None
            ),
            "ended_before": (
                request.ended_before.isoformat() if request.ended_before else None
            ),
            "sync_run_id": str(sync_run_id),
            "leads_scanned": self.leads_scanned,
            "leads_extracted": self.leads_extracted,
            "leads_skipped": self.leads_skipped,
            "rows_upserted": self.rows_upserted,
            "llm_calls": self.llm_calls,
            "watermark_to": (
                self.watermark_to.isoformat() if self.watermark_to else None
            ),
        }


# ── cost estimate ────────────────────────────────────────────────────────


def estimate_cost(
    lead_count: int,
    *,
    per_lead_cost_usd: float = DEFAULT_PER_LEAD_COST_USD,
) -> float:
    """Operator-visible USD projection. Conservative, single-knob."""
    if lead_count <= 0:
        return 0.0
    return round(lead_count * per_lead_cost_usd, 4)


async def count_candidate_leads(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    request: BackfillRequest,
) -> int:
    """SELECT COUNT(*) over the configured window — used by dry-run + budget check.

    Counts ``dim_lead`` (the normalized surface the ``llm_profile`` strategy
    reads — invariant 21), windowed on ``updated_at``. Capped at
    ``max_leads`` so an oversized window doesn't bias the cost estimate
    upward and trip the budget gate. This is a conservative upper bound —
    the strategy skips no-payload leads at extraction time.
    """
    stmt = select(func.count(DimLead.id)).where(
        DimLead.tenant_id == tenant_id,
        DimLead.app_id == request.app_id,
    )
    if request.started_after is not None:
        stmt = stmt.where(DimLead.updated_at >= request.started_after)
    if request.ended_before is not None:
        stmt = stmt.where(DimLead.updated_at < request.ended_before)
    result = await session.execute(stmt)
    raw = int(result.scalar() or 0)
    return min(raw, request.max_leads)


# ── main entrypoint ──────────────────────────────────────────────────────


async def run_backfill_lead_signals(
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

    # Dry-run path: count + estimate only, no LLM, no rows. Returned to the
    # admin endpoint via the BackgroundJob.result for inspection.
    if request.dry_run:
        async with async_session() as session:
            lead_count = await count_candidate_leads(
                session, tenant_id=tenant_id, request=request
            )
        estimated = estimate_cost(lead_count)
        return {
            "dry_run": True,
            "lead_count": lead_count,
            "estimated_cost_usd": estimated,
            "prompt_token_estimate": DEFAULT_PROMPT_TOKEN_ESTIMATE,
            "model": None,
        }

    # Pre-flight budget gate. Refuse before opening any sessions / writing any
    # bookkeeping rows so a rejected run leaves no audit clutter.
    async with async_session() as session:
        lead_count = await count_candidate_leads(
            session, tenant_id=tenant_id, request=request
        )
    estimated_cost_usd = estimate_cost(lead_count)
    if estimated_cost_usd > request.cost_budget_usd:
        raise ValueError(
            f"estimated cost ${estimated_cost_usd:.2f} exceeds "
            f"cost_budget_usd ${request.cost_budget_usd:.2f}; "
            f"raise the budget or tighten the window"
        )

    # Resolve the llm_profile signal definition for this (tenant, app) —
    # tenant override, else the system template (Phase 11B). Fail fast,
    # before any bookkeeping rows, if none is registered.
    async with async_session() as session:
        definition = await resolve_effective_definition(
            session,
            tenant_id=tenant_id,
            app_id=request.app_id,
            strategy="llm_profile",
        )
    if definition is None:
        raise ValueError(
            f"no enabled llm_profile signal definition for app "
            f"{request.app_id!r}; seed one before running this backfill"
        )

    sync_run_id: uuid.UUID | None = None
    log_row_id: uuid.UUID | None = None

    try:
        async with async_session() as bookkeeping:
            async with bookkeeping.begin():
                sync_run = LogCrmSourceSync(
                    tenant_id=tenant_id,
                    app_id=request.app_id,
                    source_system="backfill",
                    source_family="signals",
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
                        "jobType": "backfill-lead-signals",
                        "maxLeads": request.max_leads,
                        "batchSize": request.batch_size,
                        "estimatedCostUsd": estimated_cost_usd,
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
                    job_type="backfill-lead-signals",
                    status="running",
                    started_at=started_at,
                    metadata_={
                        "sync_run_id": str(sync_run_id),
                        "estimated_cost_usd": estimated_cost_usd,
                    },
                )
                bookkeeping.add(log_row)
                await bookkeeping.flush()
                log_row_id = log_row.id

        assert sync_run_id is not None
        assert log_row_id is not None

        provider = await _build_llm_provider(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=request.app_id,
            job_id=_coerce_uuid(job_id),
            counters=counters,
        )

        await _drive_backfill(
            job_id=job_id,
            request=request,
            tenant_id=tenant_id,
            definition=definition,
            provider=provider,
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
            estimated_cost_usd=estimated_cost_usd,
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
                    estimated_cost_usd=estimated_cost_usd,
                )
            except Exception:
                _log.exception(
                    "failed to finalize lead-signal backfill log; "
                    "surfacing original job error"
                )
        _log.exception(
            "backfill-lead-signals failed sync_run_id=%s app_id=%s",
            sync_run_id,
            request.app_id,
        )
        raise

    return {
        "dry_run": False,
        "sync_run_id": str(sync_run_id),
        "leads_scanned": counters.leads_scanned,
        "leads_extracted": counters.leads_extracted,
        "leads_skipped": counters.leads_skipped,
        "rows_upserted": counters.rows_upserted,
        "llm_calls": counters.llm_calls,
        "estimated_cost_usd": estimated_cost_usd,
        "cost_usd_actual": counters.cost_usd_actual,
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


# ── LLM provider construction ────────────────────────────────────────────


async def _build_llm_provider(
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    job_id: uuid.UUID | None,
    counters: _BackfillCounters,
) -> Any:
    """Build a LoggingLLMWrapper around the tenant/user's configured provider.

    Imports stay local so test stubs can monkeypatch this function without
    pulling in the full LLM stack at module import time.
    """
    from app.services.evaluators.llm_base import LoggingLLMWrapper, create_llm_provider
    from app.services.evaluators.runner_utils import make_usage_callback
    from app.services.evaluators.settings_helper import get_llm_settings_from_db

    db_settings = await get_llm_settings_from_db(
        tenant_id=str(tenant_id),
        user_id=str(user_id),
        auth_intent="managed_job",
    )
    provider_name = db_settings.get("provider", "gemini")
    model_name = db_settings.get("selected_model", "")
    api_key = db_settings.get("api_key", "")
    if not model_name:
        raise ValueError(
            "backfill-lead-signals requires an LLM model in user settings"
        )
    if not api_key and not db_settings.get("service_account_path"):
        raise ValueError(
            "backfill-lead-signals requires LLM credentials in user settings"
        )

    inner = create_llm_provider(
        provider=provider_name,
        model_name=model_name,
        api_key=api_key,
        service_account_path=db_settings.get("service_account_path", ""),
        azure_endpoint=db_settings.get("azure_endpoint", ""),
        api_version=db_settings.get("api_version", ""),
    )

    base_usage_cb = make_usage_callback(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        owner_type="job",
        owner_id=job_id,
        subsystem=USAGE_SUBSYSTEM,
        default_call_purpose=USAGE_CALL_PURPOSE,
    )

    async def _counting_usage_cb(entry: dict) -> None:
        # Count calls + accrue actual cost so the log row reflects what the
        # run really spent, not just the upfront estimate.
        counters.llm_calls += 1
        # ``record_llm_usage`` resolves pricing downstream; we only see
        # ``usd_cost`` on the entry if the wrapper / inner provider stamped
        # it. Fall back gracefully if absent — the rollup job will reconcile.
        cost = entry.get("usd_cost")
        if cost is None:
            meta = entry.get("metadata") or {}
            cost = meta.get("usd_cost")
        if cost is not None:
            try:
                counters.cost_usd_actual += float(cost)
            except (TypeError, ValueError):
                pass
        await base_usage_cb(entry)

    wrapped = LoggingLLMWrapper(inner, usage_callback=_counting_usage_cb)
    wrapped.set_call_purpose(USAGE_CALL_PURPOSE)
    return wrapped


# -- batching ------------------------------------------------------------


def _dim_lead_to_dict(obj: DimLead) -> dict[str, Any]:
    """A dim_lead ORM row as a plain dict -- the shape the llm_profile
    strategy resolves its source fields against."""
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


async def _fetch_lead_batch(
    session: AsyncSession,
    *,
    request: BackfillRequest,
    tenant_id: uuid.UUID,
    after: tuple[datetime | None, str | None],
    limit: int,
) -> list[DimLead]:
    """Keyset-paginated SELECT over dim_lead -- the normalized surface the
    llm_profile strategy reads (invariant 21).

    Cursor is ``(updated_at, lead_id)``. Strict ``(ts, id) > (last_ts,
    last_id)`` via the OR clause so a row with a duplicate timestamp at the
    page boundary is included.
    """
    ts_col = DimLead.updated_at

    stmt = select(DimLead).where(
        DimLead.tenant_id == tenant_id,
        DimLead.app_id == request.app_id,
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
                ((ts_col > last_ts) | (DimLead.lead_id > last_lead_id)),
            )
        )

    stmt = stmt.order_by(ts_col, DimLead.lead_id).limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def _drive_backfill(
    *,
    job_id: Any,
    request: BackfillRequest,
    tenant_id: uuid.UUID,
    definition: SignalDefinition,
    provider: Any,
    sync_run_id: uuid.UUID,
    counters: _BackfillCounters,
) -> None:
    """Walk dim_lead keyset-paginated; per batch hand the rows to the
    ``llm_profile`` strategy and upsert what it derives."""
    from app.services.job_worker import (
        JobCancelledError,
        is_job_cancelled,
        update_job_progress,
    )

    strategy = get_strategy(definition.strategy)
    last_ts: datetime | None = None
    last_lead_id: str | None = None
    leads_remaining = request.max_leads

    while leads_remaining > 0:
        if await is_job_cancelled(job_id, tenant_id=tenant_id):
            raise JobCancelledError("Lead-signal backfill cancelled")

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

                source_rows = [_dim_lead_to_dict(lead) for lead in leads]
                ctx = StrategyContext(
                    tenant_id=tenant_id,
                    app_id=request.app_id,
                    llm_provider=provider,
                    sync_run_id=sync_run_id,
                )
                derived = await strategy.derive(
                    definition=definition.definition,
                    source_rows=source_rows,
                    ctx=ctx,
                )
                if derived:
                    upserted = await upsert_derived_signals(
                        batch_session,
                        derived,
                        tenant_id=tenant_id,
                        app_id=request.app_id,
                        signal_definition_id=definition.id,
                    )
                    counters.rows_upserted += upserted

                extracted = {d.lead_id for d in derived}
                counters.leads_extracted += len(extracted)
                # No-payload + per-lead-errored leads (the strategy logs the
                # latter) both fold into skipped -- they produced no row.
                counters.leads_skipped += len(leads) - len(extracted)

                for lead in leads:
                    if lead.updated_at is not None and (
                        counters.watermark_to is None
                        or lead.updated_at > counters.watermark_to
                    ):
                        counters.watermark_to = lead.updated_at

                tail = leads[-1]
                last_ts = tail.updated_at
                last_lead_id = tail.lead_id

        leads_remaining -= len(leads)

        await update_job_progress(
            job_id,
            counters.leads_scanned,
            counters.leads_scanned + page_limit,
            f"Extracted signals for {counters.leads_extracted} lead(s); "
            f"{counters.rows_upserted} rows upserted",
            sync_run_id=str(sync_run_id),
        )

        if len(leads) < page_limit:
            break


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
    estimated_cost_usd: float,
) -> None:
    """Close out the log row + sync_run row. Watermark advances on success."""
    completed_at = datetime.now(timezone.utc)
    duration_ms = max(0.0, (completed_at - started_at).total_seconds() * 1000.0)

    async with async_session() as session:
        async with session.begin():
            log_row = await session.get(LogFactPopulationRun, log_row_id)
            if log_row is not None:
                log_row.status = status
                log_row.completed_at = completed_at
                log_row.duration_ms = duration_ms
                # rows_upserted is the framework upsert's row count — no
                # insert/update split is available, so the dedicated
                # columns stay at their default and metadata_ carries the
                # real number.
                log_row.error_message = error_message
                log_row.metadata_ = counters.to_metadata(
                    request=request,
                    sync_run_id=sync_run_id,
                    estimated_cost_usd=estimated_cost_usd,
                )

            sync_run = await session.get(LogCrmSourceSync, sync_run_id)
            if sync_run is not None:
                sync_run.status = "completed" if status == "success" else "failed"
                sync_run.completed_at = completed_at
                sync_run.records_scanned = counters.leads_scanned
                sync_run.records_upserted = counters.rows_upserted
                if error_message is not None:
                    sync_run.error_message = error_message
                # Watermark advances ONLY on success. On failure we keep
                # the previous watermark_to so the next run replays the
                # same window rather than skipping over it.
                if status == "success" and counters.watermark_to is not None:
                    sync_run.watermark_to = counters.watermark_to.isoformat()
                sync_run.details = dict(sync_run.details or {}, **{
                    "leadsScanned": counters.leads_scanned,
                    "leadsExtracted": counters.leads_extracted,
                    "leadsSkipped": counters.leads_skipped,
                    "llmCalls": counters.llm_calls,
                    "costUsdActual": counters.cost_usd_actual,
                })


__all__ = [
    "BackfillRequest",
    "DEFAULT_BATCH_SIZE",
    "DEFAULT_COST_BUDGET_USD",
    "DEFAULT_MAX_LEADS",
    "DEFAULT_PER_LEAD_COST_USD",
    "DEFAULT_PROMPT_TOKEN_ESTIMATE",
    "MAX_BATCH_SIZE",
    "MAX_MAX_LEADS",
    "MIN_BATCH_SIZE",
    "MIN_MAX_LEADS",
    "USAGE_CALL_PURPOSE",
    "USAGE_SUBSYSTEM",
    "count_candidate_leads",
    "estimate_cost",
    "parse_request",
    "run_backfill_lead_signals",
]
