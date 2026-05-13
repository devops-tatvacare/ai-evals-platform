"""Phase 3 wiring layer between sync jobs and the Phase 2 mapper.

Owns the failure-counter book-keeping, the structured ``log_fact_population_run``
writes, and the upsert-into-fact step. Kept out of ``inside_sales_sync.py`` so
that file stays focused on LSQ ingestion shape and the wiring stays reusable
when other CRM apps adopt the mapper.

The failure counter is a process-local dict keyed on the mapping's
``(app_id, source_table, target_fact, activity_type)`` tuple. Prod is a single
Azure Container App replica today (CLAUDE.md "Worker topology" invariant), so
this is correct without DB persistence. A multi-replica deploy would move the
counter into ``analytics.mapping_state`` — out of scope for Phase 3.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.analytics_lead_facts import FactLeadActivity
from app.models.analytics_log import LogFactPopulationRun
from app.services.analytics.mirror_to_fact_mapper import (
    MappingProjectionError,
    MirrorToFactMapping,
)

_log = logging.getLogger(__name__)

_BLOCKING_SYNC_THRESHOLD = 3

_FAILURE_COUNTERS: dict[tuple[str, str, str, str], int] = {}


def _bump_failure_counter(mapping: MirrorToFactMapping) -> int:
    n = _FAILURE_COUNTERS.get(mapping.key, 0) + 1
    _FAILURE_COUNTERS[mapping.key] = n
    return n


def _reset_failure_counter(mapping: MirrorToFactMapping) -> None:
    _FAILURE_COUNTERS.pop(mapping.key, None)


def reset_failure_counter(mapping: MirrorToFactMapping) -> None:
    """Drop the per-mapping failure counter.

    Called when an operator disables or re-enables a mapping via the admin
    endpoint — both actions are the natural reset point. Idempotent.
    """
    _reset_failure_counter(mapping)


def reset_failure_counters_for_test() -> None:
    """Test hook — clears every counter so tests don't see prior-test state."""
    _FAILURE_COUNTERS.clear()


async def _upsert_fact_rows(
    db: AsyncSession, *, rows: list[dict[str, Any]]
) -> int:
    """``ON CONFLICT DO UPDATE`` on ``analytics.fact_lead_activity``.

    Phase 3 needs DO UPDATE (not DO NOTHING) because backfill replays must
    re-project from the current mirror state — invariant 1.1.7. The conflict
    key includes ``activity_type``; matches the unique index added in 0038.
    """
    if not rows:
        return 0
    stmt = pg_insert(FactLeadActivity).values(rows)
    excluded = stmt.excluded
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[
                FactLeadActivity.tenant_id,
                FactLeadActivity.app_id,
                FactLeadActivity.source_activity_id,
                FactLeadActivity.activity_type,
            ],
            set_={
                "activity_subtype": excluded.activity_subtype,
                "source_event_code": excluded.source_event_code,
                "occurred_at": excluded.occurred_at,
                "actor_type": excluded.actor_type,
                "actor_id": excluded.actor_id,
                "actor_label": excluded.actor_label,
                "lead_id": excluded.lead_id,
                "attributes": excluded.attributes,
                "sync_run_id": excluded.sync_run_id,
            },
        )
    )
    return len(rows)


async def project_and_upsert_facts(
    db: AsyncSession,
    *,
    mapping: MirrorToFactMapping,
    mirror_rows: list[dict[str, Any]],
    sync_run_id: uuid.UUID | None,
) -> int:
    """Project ``mirror_rows`` via ``mapping`` and upsert into the fact table.

    Caller MUST already hold an open DB transaction on ``db``. Raises on the
    first projection error; the caller's enclosing transaction is expected to
    roll back the mirror writes alongside.

    ``tenant_id`` and ``app_id`` are read off each mirror row individually,
    not threaded in as function args. This is defense in depth: if a future
    caller ever lands cross-tenant rows in the same batch (the current
    inside-sales sync does not, but the helper is shared with backfill),
    each fact row gets the tenant of its source. A single function arg
    would silently tag everything with the caller's tenant — exactly the
    silent-mistag bug class this plan exists to prevent.
    """
    if not mirror_rows:
        return 0

    fact_rows: list[dict[str, Any]] = []
    for row in mirror_rows:
        if "tenant_id" not in row or "app_id" not in row:
            raise KeyError(
                "mirror row missing tenant_id/app_id; cannot project to fact "
                f"(activity_id={row.get('activity_id')!r}, mapping={mapping.key})"
            )
        projected = mapping.project(row, sync_run_id=sync_run_id)
        # The mapper deliberately doesn't write ``id``/``tenant_id``/``app_id``;
        # those are caller-supplied (Phase 2 ADR, project() docstring).
        projected["id"] = uuid.uuid4()
        projected["tenant_id"] = row["tenant_id"]
        projected["app_id"] = row["app_id"]
        fact_rows.append(projected)

    await _upsert_fact_rows(db, rows=fact_rows)
    return len(fact_rows)


async def record_mapping_failure(
    mapping: MirrorToFactMapping,
    *,
    error: BaseException,
    tenant_id: uuid.UUID,
) -> int:
    """Bump the failure counter; on threshold-3 write a blocking_sync log row.

    Runs in a fresh ``async_session`` (not the caller's transaction) so the
    log row survives the sync transaction's rollback. Returns the post-bump
    counter value so callers can log it alongside their own error path.
    """
    count = _bump_failure_counter(mapping)
    _log.warning(
        "mirror_to_fact_mapping_failure key=%s consecutive=%d error=%r",
        mapping.key,
        count,
        error,
    )

    if count < _BLOCKING_SYNC_THRESHOLD:
        return count

    error_text = (
        f"{type(error).__name__}: {error}"
        if isinstance(error, MappingProjectionError)
        else f"{type(error).__name__}: {error}"
    )
    metadata = {
        "mapping_key": list(mapping.key),
        "consecutive_failures": count,
        "threshold": _BLOCKING_SYNC_THRESHOLD,
        "error_type": type(error).__name__,
    }
    async with async_session() as session:
        async with session.begin():
            session.add(
                LogFactPopulationRun(
                    tenant_id=tenant_id,
                    app_id=mapping.app_id,
                    job_type="sync-external-source",
                    status="blocking_sync",
                    error_message=error_text,
                    metadata_=metadata,
                )
            )
    _log.error(
        "mirror_to_fact_mapping_blocking_sync key=%s consecutive=%d "
        "operator action required: disable via /api/admin/analytics/mappings",
        mapping.key,
        count,
    )
    return count


async def record_mapping_success(mapping: MirrorToFactMapping) -> None:
    """Reset the per-mapping failure counter after a clean run."""
    _reset_failure_counter(mapping)


async def record_mirror_only_mode(
    mapping: MirrorToFactMapping, *, tenant_id: uuid.UUID
) -> None:
    """Structured log + persisted breadcrumb when a sync runs mirror-only.

    Plan §1.1.6: a disabled mapping does NOT mean drift is acceptable; it
    means a follow-up backfill is required before re-enable. We persist
    a ``mirror_only`` row per sync run so the operator can audit the gap
    later.
    """
    _log.warning(
        "mirror_to_fact_mapping_disabled key=%s — sync proceeding mirror-only "
        "(fact writes skipped); follow-up backfill required before re-enable",
        mapping.key,
    )
    async with async_session() as session:
        async with session.begin():
            session.add(
                LogFactPopulationRun(
                    tenant_id=tenant_id,
                    app_id=mapping.app_id,
                    job_type="sync-external-source",
                    status="mirror_only",
                    metadata_={
                        "mapping_key": list(mapping.key),
                        "reason": "mapping disabled in analytics.mapping_state",
                    },
                )
            )


__all__ = [
    "project_and_upsert_facts",
    "record_mapping_failure",
    "record_mapping_success",
    "record_mirror_only_mode",
    "reset_failure_counter",
    "reset_failure_counters_for_test",
]
