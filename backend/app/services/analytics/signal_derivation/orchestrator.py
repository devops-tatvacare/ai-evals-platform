"""Signal derivation framework — the Transform-pass orchestrator.

Phase 11A of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

``run_signal_derivation`` is the shared core: load enabled scheduled
``signal_definition`` rows, resolve their strategy plugin, load rows from
the declared normalized source surface, derive signals, and upsert them
into ``analytics.fact_lead_signal`` keyed on
``uq_fact_lead_signal_framework``.

The scheduled ``derive-signals`` job calls this with no scope (all
tenants / apps — the "T" of ELT), but only for definitions whose
``execution_mode`` is ``scheduled_scan``. Eval-run projection and
operator-triggered LLM backfills have their own callers/context. It is
idempotent: re-running upserts in place, so a pass over unchanged lead
state collapses to one row per ``(lead, signal_type, detected_at)``.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_lead_facts import DimLead
from app.models.analytics_log import LogFactPopulationRun
from app.models.analytics_signal_definition import SignalDefinition
from app.services.analytics.signal_derivation.base import StrategyContext
from app.services.analytics.signal_derivation.persistence import (
    upsert_derived_signals,
)
from app.services.analytics.signal_derivation.registry import get_strategy
from app.services.analytics.signal_derivation.resolution import (
    resolve_target_tenants,
)

_log = logging.getLogger(__name__)

JOB_TYPE = "derive-signals"
_BATCH_SIZE = 1000


# ── Source-surface loaders ─────────────────────────────────────────────
# A signal definition reads ONE normalized surface. Each loader yields
# batches of plain-dict rows for one ``(tenant_id, app_id)``. Strategies
# resolve their ``field`` paths against these dicts. The LLM strategies
# (Phase 11B) are invoked at their own triggers (per-eval-run /
# operator backfill), not through this scheduled scan.

def _orm_row_to_dict(obj: Any) -> dict[str, Any]:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


async def _load_dim_lead_batches(
    db: AsyncSession, *, tenant_id: uuid.UUID, app_id: str
) -> AsyncIterator[list[dict[str, Any]]]:
    """Keyset-paginate ``analytics.dim_lead`` by ``lead_id``."""
    cursor: str | None = None
    while True:
        stmt = (
            select(DimLead)
            .where(DimLead.tenant_id == tenant_id, DimLead.app_id == app_id)
            .order_by(DimLead.lead_id)
            .limit(_BATCH_SIZE)
        )
        if cursor is not None:
            stmt = stmt.where(DimLead.lead_id > cursor)
        rows = (await db.execute(stmt)).scalars().all()
        if not rows:
            return
        yield [_orm_row_to_dict(r) for r in rows]
        if len(rows) < _BATCH_SIZE:
            return
        cursor = rows[-1].lead_id


_SOURCE_LOADERS = {
    "dim_lead": _load_dim_lead_batches,
}


def _enabled_scheduled_definition_stmt():
    """Enabled definitions runnable by this scheduled scan.

    ``enabled`` says the definition is active. ``execution_mode`` says which
    caller may run it. Keeping both fields separate prevents the bulk scheduler
    from dispatching eval-run and operator-backfill plugins without their
    required context.
    """
    return select(SignalDefinition).where(
        SignalDefinition.enabled.is_(True),
        SignalDefinition.execution_mode == "scheduled_scan",
    )


# ── Orchestrator ───────────────────────────────────────────────────────

async def _run_one_definition(
    db: AsyncSession, definition: SignalDefinition
) -> dict[str, Any]:
    """Derive + upsert every signal for one definition, across every tenant
    the definition applies to (a system template fans out; a tenant-owned
    definition is just its own tenant). Commits per batch."""
    strategy = get_strategy(definition.strategy)
    strategy.validate(definition.definition)

    loader = _SOURCE_LOADERS.get(definition.source_surface)
    if loader is None:
        raise ValueError(
            f"signal_definition {definition.id}: no loader for source_surface "
            f"{definition.source_surface!r} (known: {sorted(_SOURCE_LOADERS)})"
        )

    target_tenants = await resolve_target_tenants(db, definition)
    rows_written = 0
    leads_seen = 0
    for tenant_id in target_tenants:
        ctx = StrategyContext(tenant_id=tenant_id, app_id=definition.app_id)
        async for batch in loader(
            db, tenant_id=tenant_id, app_id=definition.app_id
        ):
            leads_seen += len(batch)
            derived = await strategy.derive(
                definition=definition.definition, source_rows=batch, ctx=ctx
            )
            rows_written += await upsert_derived_signals(
                db,
                derived,
                tenant_id=tenant_id,
                app_id=definition.app_id,
                signal_definition_id=definition.id,
            )
            await db.commit()

    return {
        "signal_definition_id": str(definition.id),
        "signal_set": definition.signal_set,
        "strategy": definition.strategy,
        "target_tenants": len(target_tenants),
        "leads_seen": leads_seen,
        "rows_written": rows_written,
    }


async def run_signal_derivation(
    db: AsyncSession,
    *,
    scope_tenant_id: uuid.UUID | None = None,
    scope_app_id: str | None = None,
) -> dict[str, Any]:
    """Run the signal-derivation Transform across enabled definitions.

    No scope → all tenants / apps (the scheduled platform pass). Scope
    args narrow it (used by tests and, later, the one-shot path).
    """
    stmt = _enabled_scheduled_definition_stmt()
    if scope_tenant_id is not None:
        stmt = stmt.where(SignalDefinition.tenant_id == scope_tenant_id)
    if scope_app_id is not None:
        stmt = stmt.where(SignalDefinition.app_id == scope_app_id)
    definitions = (await db.execute(stmt)).scalars().all()

    per_definition: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for definition in definitions:
        # Snapshot the values we need for logging + error reporting BEFORE
        # we enter the try block. `await db.rollback()` in the except path
        # expires every attribute on every ORM object in the identity map;
        # accessing them afterwards from synchronous code (e.g. logger arg
        # evaluation) triggers an async refresh that can't spawn its
        # greenlet wrapper and raises sqlalchemy.exc.MissingGreenlet,
        # masking the real exception. Capture as primitives now.
        definition_id = str(definition.id)
        signal_set = definition.signal_set
        try:
            per_definition.append(await _run_one_definition(db, definition))
        except Exception as exc:  # noqa: BLE001 — one bad definition must not
            # sink the whole pass; record it and move on.
            await db.rollback()
            _log.exception(
                "signal_derivation.definition_failed id=%s set=%s",
                definition_id,
                signal_set,
            )
            errors.append(
                {"signal_definition_id": definition_id, "error": str(exc)}
            )

    summary: dict[str, Any] = {
        "definitions_run": len(per_definition),
        "definitions_failed": len(errors),
        "rows_written": sum(d["rows_written"] for d in per_definition),
        "per_definition": per_definition,
        "errors": errors,
    }

    # One audit breadcrumb per pass. Tenant/app are the run's scope or the
    # system tenant for the unscoped platform pass.
    from app.constants import SYSTEM_TENANT_ID

    db.add(
        LogFactPopulationRun(
            tenant_id=scope_tenant_id or SYSTEM_TENANT_ID,
            app_id=scope_app_id or "",
            job_type=JOB_TYPE,
            status="error" if errors else "completed",
            metadata_=summary,
        )
    )
    await db.commit()
    return summary
