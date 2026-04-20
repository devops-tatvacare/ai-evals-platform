"""Enumerated chartability gate.

Rules run top-to-bottom; first match wins. The gate is a pure function over a
``TypedResultSet`` — no I/O, no side effects, fully unit-testable.

Reason codes (locked):
    CG_EMPTY              rows == 0
    CG_SINGLE_VALUE       1 row, 1 measure (+ at most 1 other col)
    CG_FIELD_CARD         1 row, multi-column
    CG_NO_MEASURE         no measure columns
    CG_ALL_IDS            every non-measure column is identifier/key
    CG_DEGENERATE_MEASURE measure is constant or >95% null
    CG_HIGH_CARD          x-axis candidate > 50 distinct values (non-temporal)

Everything else is chartable.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from app.services.chat_engine.result_set_typer import TypedResultSet

ReasonCode = Literal[
    "CG_EMPTY",
    "CG_SINGLE_VALUE",
    "CG_FIELD_CARD",
    "CG_NO_MEASURE",
    "CG_ALL_IDS",
    "CG_DEGENERATE_MEASURE",
    "CG_HIGH_CARD",
]
Fallback = Literal["empty", "kpi", "summary", "table", "chart", "chart_with_warning"]

HIGH_CARD_THRESHOLD = 50
TOP_N = 25
DEGENERATE_NULL_FRAC = 0.95


@dataclass(frozen=True)
class GateResult:
    chartable: bool
    reason_code: Optional[ReasonCode]
    fallback: Fallback
    warning: Optional[str] = None
    top_n: Optional[int] = None


def evaluate(rs: TypedResultSet) -> GateResult:
    rows = rs.rows
    measures = [c for c in rs.columns if c.role == "measure"]
    dims = [
        c for c in rs.columns
        if c.role in ("dimension", "ordered_categorical", "temporal")
    ]

    # 1. Empty
    if not rows:
        return GateResult(False, "CG_EMPTY", "empty")

    # 2. Single value → KPI (1 row, 1 measure column, nothing else)
    # When the row has additional columns (e.g. an identifier for context)
    # the ``summary`` fallback at rule 3 is the better render.
    if len(rows) == 1 and len(measures) == 1 and len(rs.columns) == 1:
        return GateResult(False, "CG_SINGLE_VALUE", "kpi")

    # 3. Field card (1 row, multiple columns) → summary
    if len(rows) == 1 and len(rs.columns) > 1:
        return GateResult(False, "CG_FIELD_CARD", "summary")

    # 4. No measure columns → table
    if not measures:
        return GateResult(False, "CG_NO_MEASURE", "table")

    # 5. Degenerate measure (constant or mostly null) → table
    # Runs before CG_ALL_IDS so "SELECT thread_id, 1 AS is_failed FROM …"
    # (per plan Zoom-2 walkthrough L269-275) degrades on the useless measure
    # before being classified as all-ids with a healthy count.
    for m in measures:
        if m.is_constant:
            return GateResult(
                False,
                "CG_DEGENERATE_MEASURE",
                "table",
                warning=(
                    f'All values in "{m.name}" are the same; '
                    "showing as a list instead of a chart."
                ),
            )
        if m.null_frac > DEGENERATE_NULL_FRAC:
            return GateResult(
                False,
                "CG_DEGENERATE_MEASURE",
                "table",
                warning=(
                    f'"{m.name}" is almost entirely null; '
                    "showing as a list instead of a chart."
                ),
            )

    # 6. Every non-measure column is an identifier → table
    non_measures = [c for c in rs.columns if c.role != "measure"]
    if non_measures and all(
        c.role in ("identifier", "key") for c in non_measures
    ):
        return GateResult(
            False,
            "CG_ALL_IDS",
            "table",
            warning="Showing as a list — no chartable dimension present.",
        )

    # 7. High cardinality on candidate x-axis → chart + top-N warning
    candidate_x = next(
        (c for c in dims if c.role != "temporal"), None
    ) or (dims[0] if dims else None)
    if (
        candidate_x is not None
        and candidate_x.role != "temporal"
        and candidate_x.cardinality > HIGH_CARD_THRESHOLD
    ):
        return GateResult(
            True,
            "CG_HIGH_CARD",
            "chart_with_warning",
            top_n=TOP_N,
            warning=(
                f"Showing top {TOP_N} of {candidate_x.cardinality} "
                f'"{candidate_x.name}" values.'
            ),
        )

    # Happy path
    return GateResult(True, None, "chart")
