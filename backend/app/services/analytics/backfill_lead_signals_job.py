"""Lead-signal backfill job (Phase 5).

Drives a keyset-paginated scan over ``analytics.crm_lead_record`` for one
``(tenant_id, app_id)`` pair, runs an LLM extraction over each lead's
``mql_signals`` + typed bag columns + the lead's ``dim_lead.attributes_at_first_seen``,
and upserts the resulting signals into ``analytics.fact_lead_signal`` with
``sync_run_id`` stamped on every row.

Why this lives next to ``backfill_facts_from_mirror_job.py`` and not under
the eval-run-coupled ``signal_extractor.py``: Phase 5 reads the CRM lead
mirror (no eval-run lineage), Phase 5 makes LLM calls (the eval-run path is
pure), and Phase 5 owns its own rollback via ``sync_run_id`` (the eval-run
path keys off ``eval_run_id``). The two writers share the table but not the
unique key — see ``FactLeadSignal`` docstring + migration 0040.

CRM-agnostic naming. This is not "inside-sales signal backfill" — Phase 13
adds a Frappe-backed app that reuses the same path.

LLM contract:
  * Every call goes through ``LoggingLLMWrapper`` with
    ``make_usage_callback`` so ``analytics.fact_llm_generation`` records one
    row per call. Cost aggregation is a downstream rollup.
  * One call per lead (the prompt covers the entire lead). Per-lead cost is
    recorded in the usage callback closure aggregate.
  * ``generate_json`` with a strict response schema so output is parseable
    without ad-hoc regex.

Idempotency:
  * Upsert conflict key is the partial unique index
    ``uq_fact_lead_signal_backfill`` =
    ``(tenant_id, app_id, lead_id, signal_type, detected_at) WHERE
    sync_run_id IS NOT NULL``.
  * ``detected_at`` is derived from ``crm_lead_record.last_synced_at``
    (falling back to ``created_on`` for the rare null case) — i.e. it
    represents the **source state** the extraction was based on, not
    wall-clock at extraction time. Rerunning the backfill over leads
    whose mirror state has not changed therefore produces the same
    ``detected_at`` for each lead and the upsert collapses to a single
    row per ``(lead, signal_type)``. When a lead re-syncs (``last_synced_at``
    advances), a re-run correctly emits a fresh observation row.

Rollback:
  * ``DELETE FROM analytics.fact_lead_signal WHERE sync_run_id = '<id>'``.
  * LLM cost is not recoverable.

Watermark:
  * After a successful run we record the high watermark
    ``MAX(crm_lead_record.last_synced_at)`` for the scanned window on the
    log row's ``metadata_.watermark_to``. The next operator-driven backfill
    can read it back to scope the next window — Phase 5 does not run on a
    schedule today; advancement is operator-decided.
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.analytics_lead_facts import DimLead, FactLeadSignal
from app.models.analytics_log import LogFactPopulationRun
from app.models.source_records import CrmLeadRecord, LogCrmSourceSync
from app.services.analytics.signal_taxonomy import coerce_signal_type

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

# Strict JSON schema the LLM must return. The extractor only consumes
# ``signal_type`` against the controlled vocabulary; anything else maps to
# ``other_notable_signal`` via ``coerce_signal_type``.
SIGNAL_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "signals": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "signal_type": {"type": "string"},
                    "signal_value": {"type": ["string", "null"]},
                    "signal_value_numeric": {"type": ["number", "null"]},
                    "confidence": {"type": ["number", "null"]},
                    "supporting_quote": {"type": ["string", "null"]},
                    "signal_at": {"type": ["string", "null"]},
                },
                "required": ["signal_type"],
            },
        }
    },
    "required": ["signals"],
}


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
    leads_scanned: int = 0
    leads_extracted: int = 0
    leads_skipped: int = 0
    leads_errored: int = 0
    rows_upserted: int = 0
    rows_inserted: int = 0
    rows_updated: int = 0
    llm_calls: int = 0
    cost_usd_actual: float = 0.0
    last_error: str | None = None
    error_samples: list[dict[str, Any]] = field(default_factory=list)
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
            "leads_errored": self.leads_errored,
            "rows_upserted": self.rows_upserted,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "llm_calls": self.llm_calls,
            "watermark_to": (
                self.watermark_to.isoformat() if self.watermark_to else None
            ),
            "error_samples": self.error_samples,
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

    Capped at ``max_leads`` so an oversized window doesn't bias the cost
    estimate upward and trip the budget gate.
    """
    stmt = select(func.count(CrmLeadRecord.id)).where(
        CrmLeadRecord.tenant_id == tenant_id,
        CrmLeadRecord.app_id == request.app_id,
    )
    ts_col = func.coalesce(CrmLeadRecord.last_synced_at, CrmLeadRecord.created_on)
    if request.started_after is not None:
        stmt = stmt.where(ts_col >= request.started_after)
    if request.ended_before is not None:
        stmt = stmt.where(ts_col < request.ended_before)
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
        "leads_errored": counters.leads_errored,
        "rows_upserted": counters.rows_upserted,
        "rows_inserted": counters.rows_inserted,
        "rows_updated": counters.rows_updated,
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


# ── batching ─────────────────────────────────────────────────────────────


async def _drive_backfill(
    *,
    job_id: Any,
    request: BackfillRequest,
    tenant_id: uuid.UUID,
    provider: Any,
    sync_run_id: uuid.UUID,
    counters: _BackfillCounters,
) -> None:
    """Walk the lead mirror keyset-paginated; per-lead LLM extract + upsert."""
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

                attrs_by_lead = await _load_attributes_at_first_seen(
                    batch_session,
                    tenant_id=tenant_id,
                    app_id=request.app_id,
                    lead_ids=[lead.lead_id for lead in leads],
                )

                projected_rows: list[dict[str, Any]] = []
                for lead in leads:
                    extraction_input = _build_extraction_input(
                        lead, attrs_by_lead.get(lead.lead_id)
                    )
                    if not extraction_input["has_payload"]:
                        counters.leads_skipped += 1
                        continue
                    try:
                        signals = await _extract_signals(provider, extraction_input)
                    except Exception as exc:
                        counters.leads_errored += 1
                        message = f"{type(exc).__name__}: {exc}"
                        counters.last_error = message[:500]
                        if len(counters.error_samples) < 5:
                            counters.error_samples.append(
                                {"lead_id": lead.lead_id, "error": message[:500]}
                            )
                        continue

                    # detected_at is derived from the lead's source state, NOT
                    # wall-clock at extraction time. This is what makes reruns
                    # idempotent: same source state → same detected_at → upsert
                    # collides on the partial unique key. Falling back to
                    # created_on covers the rare last_synced_at=NULL case.
                    detected_at = _detected_at_for(lead)
                    rows = _project_signal_rows(
                        lead=lead,
                        signals=signals,
                        tenant_id=tenant_id,
                        sync_run_id=sync_run_id,
                        detected_at=detected_at,
                    )
                    if rows:
                        projected_rows.extend(rows)
                        counters.leads_extracted += 1
                    else:
                        counters.leads_skipped += 1

                    # Track high watermark for the run.
                    lead_ts = lead.last_synced_at or lead.created_on
                    if lead_ts is not None and (
                        counters.watermark_to is None
                        or lead_ts > counters.watermark_to
                    ):
                        counters.watermark_to = lead_ts

                if projected_rows:
                    inserted, updated = await _upsert_signal_rows(
                        batch_session, rows=projected_rows
                    )
                    counters.rows_upserted += inserted + updated
                    counters.rows_inserted += inserted
                    counters.rows_updated += updated

                tail = leads[-1]
                last_ts = tail.last_synced_at or tail.created_on
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


async def _fetch_lead_batch(
    session: AsyncSession,
    *,
    request: BackfillRequest,
    tenant_id: uuid.UUID,
    after: tuple[datetime | None, str | None],
    limit: int,
) -> list[CrmLeadRecord]:
    """Keyset-paginated SELECT over crm_lead_record.

    Cursor is ``(coalesce(last_synced_at, created_on), lead_id)``. Same
    cursor shape as Phase 4 — strict `(ts, tb) > (last_ts, last_lead_id)`
    so a row with a duplicate timestamp at the page boundary is included
    via the OR clause.
    """
    ts_col = func.coalesce(CrmLeadRecord.last_synced_at, CrmLeadRecord.created_on)

    stmt = select(CrmLeadRecord).where(
        CrmLeadRecord.tenant_id == tenant_id,
        CrmLeadRecord.app_id == request.app_id,
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


async def _load_attributes_at_first_seen(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    lead_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """Look up dim_lead.attributes_at_first_seen for a batch of leads.

    Returned as ``{lead_id: attributes_dict}``. Missing dim rows map to
    ``{}`` rather than raising — the lead may have been synced via the
    mirror before dim_lead was wired up.
    """
    if not lead_ids:
        return {}
    stmt = select(DimLead.lead_id, DimLead.attributes_at_first_seen).where(
        DimLead.tenant_id == tenant_id,
        DimLead.app_id == app_id,
        DimLead.lead_id.in_(lead_ids),
    )
    result = await session.execute(stmt)
    return {row.lead_id: (row.attributes_at_first_seen or {}) for row in result.all()}


# ── input normalization ──────────────────────────────────────────────────


def _build_extraction_input(
    lead: CrmLeadRecord,
    attributes_at_first_seen: dict[str, Any] | None,
) -> dict[str, Any]:
    """Assemble the prompt-input payload from mirror + dim columns.

    Centralizes the "what does the LLM see" decision so tests can stub it
    without rerouting the mirror scan. ``has_payload`` short-circuits leads
    with no signal-bearing content; ``mql_signals`` shape is normalized
    here so the prompt always sees a list of {"signal_type", "value", "raw"}
    dicts rather than dict-vs-list-vs-string-encoded-JSON polymorphism.
    """
    bag = _lead_bag(lead)
    mql_signals_normalized = _normalize_mql_signals(bag.get("mql_signals"))
    typed_bag = {
        "hba1c_band": bag.get("hba1c_band"),
        "condition": bag.get("condition"),
        "age_group": bag.get("age_group"),
        "intent_to_pay": bag.get("intent_to_pay"),
        "plan_name": bag.get("plan_name"),
        # ``city`` is still a typed column on the mirror (PII; not lifted
        # to raw_payload). Read attribute directly.
        "city": lead.city,
        "source": bag.get("source"),
        "source_campaign": bag.get("source_campaign"),
        "prospect_stage": bag.get("prospect_stage"),
        "mql_score": bag.get("mql_score"),
    }
    # Drop empty / zero / None to keep the prompt tight.
    typed_bag = {
        k: v
        for k, v in typed_bag.items()
        if v not in (None, "", 0)
    }

    has_payload = bool(mql_signals_normalized) or bool(typed_bag) or bool(
        attributes_at_first_seen
    )

    return {
        "lead_id": lead.lead_id,
        "mql_score": bag.get("mql_score"),
        "mql_signals": mql_signals_normalized,
        "typed_bag": typed_bag,
        "attributes_at_first_seen": attributes_at_first_seen or {},
        "has_payload": has_payload,
    }


def _lead_bag(lead: Any) -> dict[str, Any]:
    """Read accessor used by the extractor.

    Phase 9 moves domain-typed columns into ``raw_payload``. Prefer the
    model's ``bag`` property when present (real CrmLeadRecord instances);
    fall back to attribute access for legacy test stubs that don't carry
    a ``bag`` accessor.
    """
    bag = getattr(lead, "bag", None)
    if isinstance(bag, dict):
        return bag
    # Legacy test stub fallback — synthesize a bag from attribute reads
    # so unit tests built before Phase 9 keep passing.
    return {
        key: getattr(lead, key, None)
        for key in (
            "hba1c_band", "condition", "age_group", "intent_to_pay",
            "plan_name", "source", "source_campaign", "prospect_stage",
            "mql_score", "mql_signals",
        )
    }


def _normalize_mql_signals(raw: Any) -> list[dict[str, Any]]:
    """Make ``crm_lead_record.mql_signals`` a stable list of dicts.

    Production rows are mostly ``{signal_type: value}`` dicts but defensive:
    list shapes (sometimes already-projected payloads), JSON-encoded
    strings (legacy paths), and non-dict scalars all coerce to a list of
    ``{"signal_type", "value", "raw"}`` entries the prompt can iterate.
    """
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            return [{"signal_type": "raw", "value": raw, "raw": raw}]
    if isinstance(raw, dict):
        normalized: list[dict[str, Any]] = []
        for key, value in raw.items():
            label = str(key).strip()
            if not label:
                continue
            normalized.append({"signal_type": label, "value": value, "raw": value})
        return normalized
    if isinstance(raw, list):
        normalized = []
        for item in raw:
            if isinstance(item, dict):
                label = str(
                    item.get("signal_type") or item.get("type") or ""
                ).strip()
                if not label:
                    continue
                normalized.append(
                    {
                        "signal_type": label,
                        "value": item.get("signal_value") or item.get("value"),
                        "raw": item,
                    }
                )
            elif isinstance(item, str) and item.strip():
                normalized.append(
                    {"signal_type": item.strip(), "value": None, "raw": item}
                )
        return normalized
    return []


# ── LLM call ─────────────────────────────────────────────────────────────


_EXTRACTION_SYSTEM_PROMPT = (
    "You extract structured sales-intelligence signals from a CRM lead "
    "snapshot. Return JSON matching the provided schema. Each signal must "
    "use one of these signal_type values exactly; anything else will be "
    "coerced to other_notable_signal. Be conservative — only emit signals "
    "the snapshot directly supports."
)


def _build_extraction_prompt(extraction_input: dict[str, Any]) -> str:
    """Render the per-lead user prompt.

    Kept as a single string so the LLM cost estimate per lead is stable
    across the run and a token-count audit is straightforward.
    """
    return (
        "Lead snapshot:\n"
        f"  lead_id: {extraction_input['lead_id']}\n"
        f"  mql_score: {extraction_input.get('mql_score')}\n"
        f"  typed_bag: {json.dumps(extraction_input['typed_bag'], default=str)}\n"
        f"  mql_signals: {json.dumps(extraction_input['mql_signals'], default=str)}\n"
        f"  attributes_at_first_seen: "
        f"{json.dumps(extraction_input['attributes_at_first_seen'], default=str)}\n"
        "\n"
        "Return JSON: {\"signals\": [{signal_type, signal_value?, "
        "signal_value_numeric?, confidence?, supporting_quote?, "
        "signal_at?}, ...]}"
    )


async def _extract_signals(provider: Any, extraction_input: dict[str, Any]) -> list[dict[str, Any]]:
    """One LLM call per lead. Provider MUST be a LoggingLLMWrapper.

    The LoggingLLMWrapper invariant guarantees an analytics.fact_llm_generation
    row is written on every call. We don't double-check the type here because
    the wrapper is constructed in _build_llm_provider and tests stub the
    whole function — but the contract is documented for future readers.
    """
    prompt = _build_extraction_prompt(extraction_input)
    response = await provider.generate_json(
        prompt=prompt,
        system_prompt=_EXTRACTION_SYSTEM_PROMPT,
        json_schema=SIGNAL_RESPONSE_SCHEMA,
    )
    if not isinstance(response, dict):
        return []
    signals = response.get("signals") or []
    if not isinstance(signals, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for item in signals:
        if isinstance(item, dict) and item.get("signal_type"):
            cleaned.append(item)
    return cleaned


# ── projection + upsert ──────────────────────────────────────────────────


def _project_signal_rows(
    *,
    lead: CrmLeadRecord,
    signals: list[dict[str, Any]],
    tenant_id: uuid.UUID,
    sync_run_id: uuid.UUID,
    detected_at: datetime,
) -> list[dict[str, Any]]:
    """Project LLM output → fact_lead_signal row dicts ready for ON CONFLICT.

    Dedupes by ``signal_type`` within the lead (the partial unique index is
    keyed on lead_id/signal_type/detected_at, so emitting two rows with the
    same signal_type collides). The first occurrence wins; later ones land
    in attributes.duplicates so nothing is silently dropped on the floor.
    """
    seen: dict[str, dict[str, Any]] = {}
    for ordinal, raw in enumerate(signals):
        raw_type = (raw.get("signal_type") or "").strip()
        if not raw_type:
            continue
        attributes = raw.get("attributes") or {}
        if not isinstance(attributes, dict):
            attributes = {"raw_attributes": attributes}
        signal_type, attributes = coerce_signal_type(raw_type, attributes=attributes)
        if signal_type in seen:
            seen[signal_type].setdefault("_duplicates", []).append(raw)
            continue
        seen[signal_type] = {
            "id": uuid.uuid4(),
            "tenant_id": tenant_id,
            "app_id": lead.app_id,
            "eval_run_id": None,
            "thread_evaluation_id": None,
            "sync_run_id": sync_run_id,
            "lead_id": lead.lead_id,
            "source_activity_id": None,
            "signal_type": signal_type,
            "signal_value": _safe_str(raw.get("signal_value")),
            "signal_value_numeric": _coerce_decimal(raw.get("signal_value_numeric")),
            "signal_at": _coerce_signal_at(raw.get("signal_at")),
            "detected_at": detected_at,
            "confidence": _coerce_decimal(raw.get("confidence")),
            "supporting_quote": _safe_str(raw.get("supporting_quote")),
            "ordinal": ordinal,
            "attributes": attributes,
        }
    out: list[dict[str, Any]] = []
    for row in seen.values():
        duplicates = row.pop("_duplicates", None)
        if duplicates:
            attrs = dict(row.get("attributes") or {})
            attrs["duplicates"] = duplicates
            row["attributes"] = attrs
        out.append(row)
    return out


def _safe_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_decimal(raw: Any) -> Decimal | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return None
    try:
        return Decimal(str(raw))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _detected_at_for(lead: CrmLeadRecord) -> datetime:
    """Resolve the canonical ``detected_at`` for a lead.

    Source-state-derived (not wall-clock), so reruns over unchanged leads
    collide on the partial unique key and the upsert collapses to one row.
    Falls back to ``created_on`` for the rare null case, then to the unix
    epoch if both are missing — the latter is purely a safety valve so the
    NOT NULL upsert never crashes; missing-timestamp leads are exceptional
    enough that ops should investigate before relying on the value.
    """
    raw = lead.last_synced_at or lead.created_on
    if raw is None:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)


def _coerce_signal_at(raw: Any) -> datetime | None:
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    text = str(raw).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def _upsert_signal_rows(
    session: AsyncSession, *, rows: list[dict[str, Any]]
) -> tuple[int, int]:
    """ON CONFLICT DO UPDATE on the backfill partial unique key.

    Conflict target is ``(tenant_id, app_id, lead_id, signal_type,
    detected_at)`` — same columns the migration's partial unique index
    declares. ``index_where`` matches the partial predicate so Postgres
    picks the right index.
    """
    if not rows:
        return (0, 0)

    from sqlalchemy import text as _text

    stmt = pg_insert(FactLeadSignal).values(rows)
    excluded = stmt.excluded
    stmt = stmt.on_conflict_do_update(
        index_elements=[
            FactLeadSignal.tenant_id,
            FactLeadSignal.app_id,
            FactLeadSignal.lead_id,
            FactLeadSignal.signal_type,
            FactLeadSignal.detected_at,
        ],
        index_where=_text("sync_run_id IS NOT NULL"),
        set_={
            "signal_value": excluded.signal_value,
            "signal_value_numeric": excluded.signal_value_numeric,
            "signal_at": excluded.signal_at,
            "confidence": excluded.confidence,
            "supporting_quote": excluded.supporting_quote,
            "ordinal": excluded.ordinal,
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
                log_row.rows_inserted = counters.rows_inserted
                log_row.rows_updated = counters.rows_updated
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
                sync_run.records_failed = counters.leads_errored
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
                    "leadsErrored": counters.leads_errored,
                    "rowsInserted": counters.rows_inserted,
                    "rowsUpdated": counters.rows_updated,
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
    "SIGNAL_RESPONSE_SCHEMA",
    "USAGE_CALL_PURPOSE",
    "USAGE_SUBSYSTEM",
    "count_candidate_leads",
    "estimate_cost",
    "parse_request",
    "run_backfill_lead_signals",
]
