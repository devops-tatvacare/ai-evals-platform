"""SQL-pushdown selection resolver.

One function. Takes a binding + spec + tenant/user/app context. Returns
typed records + per-stage diagnostics. Every predicate is pushed to SQL — no
in-memory post-filters, no row-by-row Python iteration over thousands of rows.

Stages produced in `SelectionDiagnostics`:
  universe_total           — rows matching `binding.base_predicate` only
  after_universe_predicates — rows after spec-derived predicates
  after_skip_evaluated     — rows after the NOT EXISTS skip-evaluated subquery
  selected                 — final returned count (mode-aware)
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult
from app.services.evaluators.selection.binding import BindContext, DatasetBinding
from app.services.evaluators.selection.record import (
    ResolvedSelection,
    SelectionDiagnostics,
    SpecificSelectionMissingError,
)
from app.services.evaluators.selection.spec import EvaluationSelectionSpec


async def resolve_selection(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    binding: DatasetBinding,
    spec: EvaluationSelectionSpec,
) -> ResolvedSelection:
    """Resolve `spec` against `binding` and return typed records + diagnostics."""
    ctx = BindContext(tenant_id=tenant_id, app_id=app_id)
    base_clauses = binding.base_predicate(ctx)

    if spec.mode == "specific":
        return await _resolve_specific(
            db, ctx=ctx, binding=binding, spec=spec, base_clauses=base_clauses
        )

    return await _resolve_universe(
        db,
        ctx=ctx,
        binding=binding,
        spec=spec,
        base_clauses=base_clauses,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
    )


async def _resolve_specific(
    db: AsyncSession,
    *,
    ctx: BindContext,  # noqa: ARG001 — kept for signature uniformity with universe path
    binding: DatasetBinding,
    spec: EvaluationSelectionSpec,
    base_clauses: list[Any],
) -> ResolvedSelection:
    """mode='specific' — fetch by id, ignore universe predicates.

    User-selected specific records must not be silently dropped by UI filter
    defaults. Skip_evaluated is also ignored — the user's explicit pick wins.
    """
    requested = tuple(rid for rid in spec.selected_ids if rid)
    universe_total = await _count(db, binding, base_clauses)

    rows_stmt = select(binding.table).where(
        and_(*base_clauses, binding.id_column.in_(requested))
    )
    rows = (await db.execute(rows_stmt)).scalars().all()
    found_ids = {getattr(row, binding.id_column.key) for row in rows}
    missing = [rid for rid in requested if rid not in found_ids]
    if missing:
        raise SpecificSelectionMissingError(missing)

    records = [binding.row_to_record(row) for row in rows]
    return ResolvedSelection(
        records=records,
        diagnostics=SelectionDiagnostics(
            universe_total=universe_total,
            after_universe_predicates=len(records),
            after_skip_evaluated=len(records),
            selected=len(records),
            predicate_summary=spec.predicate_summary(),
        ),
    )


async def _resolve_universe(
    db: AsyncSession,
    *,
    ctx: BindContext,
    binding: DatasetBinding,
    spec: EvaluationSelectionSpec,
    base_clauses: list[Any],
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
) -> ResolvedSelection:
    """mode='all' or 'sample' — apply universe predicates, optional skip-eval, optional sample."""
    universe_total = await _count(db, binding, base_clauses)

    spec_clauses = binding.predicate_builder(ctx, spec)
    after_predicates_total = await _count(db, binding, base_clauses + spec_clauses)

    skip_clauses = list(spec_clauses)
    if spec.skip_evaluated:
        skip_clauses.append(
            _build_skip_evaluated_clause(
                binding=binding,
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=app_id,
                scope=spec.skip_evaluated_scope,
            )
        )
    after_skip_total = (
        await _count(db, binding, base_clauses + skip_clauses)
        if spec.skip_evaluated
        else after_predicates_total
    )

    rows_stmt = select(binding.table).where(and_(*base_clauses, *skip_clauses))
    if spec.mode == "sample":
        # sample_size validated non-None by the spec
        rows_stmt = rows_stmt.order_by(binding.random_order_expression).limit(
            spec.sample_size
        )

    rows = (await db.execute(rows_stmt)).scalars().all()
    records = [binding.row_to_record(row) for row in rows]

    return ResolvedSelection(
        records=records,
        diagnostics=SelectionDiagnostics(
            universe_total=universe_total,
            after_universe_predicates=after_predicates_total,
            after_skip_evaluated=after_skip_total,
            selected=len(records),
            predicate_summary=spec.predicate_summary(),
        ),
    )


def _build_skip_evaluated_clause(
    *,
    binding: DatasetBinding,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    scope: str,
) -> Any:
    """NOT EXISTS subquery against `evaluation_run_thread_results.thread_id`.

    `scope='self'` restricts to runs the same user owns; `'tenant'` widens to
    every run under the tenant. Both filter to `app_id` and to runs that
    finalised cleanly (no point skipping a row whose only past attempt failed).
    """
    subq = select(EvaluationRunThreadResult.id).join(
        EvaluationRun, EvaluationRunThreadResult.run_id == EvaluationRun.id
    ).where(
        EvaluationRun.tenant_id == tenant_id,
        EvaluationRun.app_id == app_id,
        EvaluationRun.status.in_(("completed", "completed_with_errors")),
        EvaluationRunThreadResult.thread_id == binding.id_column,
    )
    if scope == "self":
        subq = subq.where(EvaluationRun.user_id == user_id)
    return ~exists(subq)


async def _count(
    db: AsyncSession,
    binding: DatasetBinding,
    clauses: list[Any],
) -> int:
    stmt = (
        select(func.count())
        .select_from(binding.table)
        .where(and_(*clauses))
    )
    result = await db.execute(stmt)
    return int(result.scalar_one() or 0)


__all__ = ["resolve_selection"]
