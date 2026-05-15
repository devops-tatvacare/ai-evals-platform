"""Evaluation-linkage helpers consumed by the inside-sales listing surfaces.

These functions overlay the latest eval result onto a call DTO and project
eval history. They are read-only against `evaluation_run_thread_results`;
the eval runner itself does not import this module.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult

INSIDE_SALES_VISIBLE_EVAL_STATUSES = ("completed", "completed_with_errors")


@dataclass(frozen=True)
class InsideSalesEvalOverlay:
    eval_count: int
    latest_score: float | None
    latest_result: dict[str, Any] | None
    latest_run_id: str | None = None


def extract_inside_sales_eval_score(result: dict[str, Any] | None) -> float | None:
    raw = result or {}
    evaluations = raw.get("evaluations") or []
    if evaluations:
        output = evaluations[0].get("output") or {}
        score = output.get("overall_score")
        if score is not None:
            return score
    return (raw.get("output") or {}).get("overall_score")


async def fetch_latest_eval_overlays(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    thread_ids: Sequence[str],
    statuses: Sequence[str] = INSIDE_SALES_VISIBLE_EVAL_STATUSES,
) -> dict[str, InsideSalesEvalOverlay]:
    clean_thread_ids = tuple(thread_id for thread_id in thread_ids if thread_id)
    if not clean_thread_ids:
        return {}

    latest_eval_subquery = (
        select(
            EvaluationRunThreadResult.thread_id,
            func.max(EvaluationRunThreadResult.id).label("latest_id"),
            func.count(EvaluationRunThreadResult.id).label("eval_count"),
        )
        .join(EvaluationRun, EvaluationRunThreadResult.run_id == EvaluationRun.id)
        .where(
            EvaluationRunThreadResult.thread_id.in_(clean_thread_ids),
            EvaluationRun.tenant_id == tenant_id,
            EvaluationRun.user_id == user_id,
            EvaluationRun.app_id == app_id,
            EvaluationRun.status.in_(tuple(statuses)),
        )
        .group_by(EvaluationRunThreadResult.thread_id)
        .subquery()
    )
    result = await db.execute(
        select(
            EvaluationRunThreadResult.thread_id,
            EvaluationRunThreadResult.run_id,
            EvaluationRunThreadResult.result,
            latest_eval_subquery.c.eval_count,
        ).join(latest_eval_subquery, EvaluationRunThreadResult.id == latest_eval_subquery.c.latest_id)
    )
    return {
        str(thread_id): InsideSalesEvalOverlay(
            eval_count=int(eval_count or 0),
            latest_score=extract_inside_sales_eval_score(eval_result),
            latest_result=eval_result,
            latest_run_id=str(run_id),
        )
        for thread_id, run_id, eval_result, eval_count in result.all()
    }


async def list_eval_history_entries(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    thread_ids: Sequence[str],
    statuses: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    clean_thread_ids = tuple(thread_id for thread_id in thread_ids if thread_id)
    if not clean_thread_ids:
        return []

    statement = (
        select(EvaluationRunThreadResult)
        .join(EvaluationRun, EvaluationRunThreadResult.run_id == EvaluationRun.id)
        .where(
            EvaluationRunThreadResult.thread_id.in_(clean_thread_ids),
            EvaluationRun.tenant_id == tenant_id,
            EvaluationRun.user_id == user_id,
            EvaluationRun.app_id == app_id,
        )
        .order_by(EvaluationRunThreadResult.id.desc())
    )
    if statuses:
        statement = statement.where(EvaluationRun.status.in_(tuple(statuses)))

    result = await db.execute(statement)
    return [
        {
            "id": str(thread_evaluation.id),
            "thread_id": thread_evaluation.thread_id,
            "run_id": str(thread_evaluation.run_id),
            "result": thread_evaluation.result or {},
            "created_at": _format_eval_history_timestamp(thread_evaluation.created_at),
        }
        for thread_evaluation in result.scalars().all()
    ]


def _format_eval_history_timestamp(value: datetime | None) -> str:
    return str(value) if value is not None else ""
