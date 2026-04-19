"""Server-side aggregation helpers over ``llm_usage``.

Used today by the Sherlock SSE ``done`` event (§7.6 of the plan) to summarise a
turn's recorded calls in one shot. Entity drill-down and chip lookups (Phase 4)
will reuse the same shape but queried differently.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, TypedDict

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost import LlmUsage


class TurnUsageSummary(TypedDict, total=False):
    """Camel-cased shape emitted on the SSE ``done`` payload."""

    inputTokens: int
    outputTokens: int
    cachedReadTokens: int
    cachedWriteTokens: int
    reasoningTokens: int
    toolUsePromptTokens: int
    totalTokens: int
    costUsd: float
    callCount: int


async def aggregate_turn_usage(
    db: AsyncSession,
    *,
    owner_type: str,
    owner_id: uuid.UUID,
) -> TurnUsageSummary | None:
    """Return a token + cost summary for a single owning entity.

    Returns ``None`` when there are zero rows so callers can omit the field
    entirely (keeps SSE payloads backward-compatible).
    """
    stmt = (
        select(
            func.coalesce(func.sum(LlmUsage.input_tokens), 0),
            func.coalesce(func.sum(LlmUsage.output_tokens), 0),
            func.coalesce(func.sum(LlmUsage.cached_read_tokens), 0),
            func.coalesce(func.sum(LlmUsage.cached_write_tokens), 0),
            func.coalesce(func.sum(LlmUsage.reasoning_tokens), 0),
            func.coalesce(func.sum(LlmUsage.tool_use_prompt_tokens), 0),
            func.coalesce(func.sum(LlmUsage.total_tokens), 0),
            func.coalesce(func.sum(LlmUsage.cost_usd), 0),
            func.count(LlmUsage.id),
        )
        .where(LlmUsage.owner_type == owner_type)
        .where(LlmUsage.owner_id == owner_id)
    )
    row: Any = (await db.execute(stmt)).one()
    call_count = int(row[8])
    if call_count == 0:
        return None
    cost = row[7]
    cost_float = float(cost) if isinstance(cost, (Decimal, int, float)) else 0.0
    return TurnUsageSummary(
        inputTokens=int(row[0]),
        outputTokens=int(row[1]),
        cachedReadTokens=int(row[2]),
        cachedWriteTokens=int(row[3]),
        reasoningTokens=int(row[4]),
        toolUsePromptTokens=int(row[5]),
        totalTokens=int(row[6]),
        costUsd=cost_float,
        callCount=call_count,
    )
