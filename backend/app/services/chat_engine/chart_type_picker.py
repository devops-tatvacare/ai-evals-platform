"""Deterministic chart-type picker.

Rules lifted from Wren AI's ``chart_generation`` prompt and encoded as
Python. Returns one of 7 marks:

    bar | grouped_bar | stacked_bar | line | multi_line | area | pie

The picker is pure — no I/O, no LLM. Callers run the chartability gate
first; the picker assumes the gate already ruled the input chartable
(in particular, there is at least one measure column).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from app.services.chat_engine.result_set_typer import TypedColumn, TypedResultSet

Mark = Literal[
    "bar", "grouped_bar", "stacked_bar", "line", "multi_line", "area", "pie"
]

PIE_MAX_SLICES = 8
# Part-of-whole semantic types: appropriate for stacked/pie when a single
# measure sums to a meaningful total across a dimension.
PART_OF_WHOLE_SEMTYPES = frozenset({"percent"})


@dataclass(frozen=True)
class PickedChart:
    mark: Mark
    x_field: str
    y_field: str
    color_field: Optional[str] = None


def _non_temporal_dims(rs: TypedResultSet) -> list[TypedColumn]:
    return [
        c for c in rs.columns
        if c.role in ("dimension", "ordered_categorical")
        and c.data_type != "temporal"
    ]


def _temporal_dims(rs: TypedResultSet) -> list[TypedColumn]:
    return [c for c in rs.columns if c.role == "temporal" or c.data_type == "temporal"]


def _measures(rs: TypedResultSet) -> list[TypedColumn]:
    return [c for c in rs.columns if c.role == "measure"]


def pick(
    rs: TypedResultSet,
    *,
    cumulative_measures: Optional[set[str]] = None,
) -> PickedChart:
    """Pick one of the 7 supported marks from a typed result set.

    ``cumulative_measures`` is an optional set of column names that the
    caller knows are running totals; these promote line → area. By default
    no column is considered cumulative.
    """
    cumulative_measures = cumulative_measures or set()
    measures = _measures(rs)
    temporals = _temporal_dims(rs)
    nominal_dims = _non_temporal_dims(rs)

    if not measures:
        raise ValueError(
            "Picker called on result with no measure; gate should have rejected."
        )

    # 1 temporal + 1 measure → line (or area if cumulative)
    if temporals and not nominal_dims and len(measures) == 1:
        m = measures[0]
        mark: Mark = "area" if m.name in cumulative_measures else "line"
        return PickedChart(mark=mark, x_field=temporals[0].name, y_field=m.name)

    # 1 temporal + 1 nominal + 1 measure → multi_line with nominal as color
    if temporals and len(nominal_dims) == 1 and len(measures) == 1:
        return PickedChart(
            mark="multi_line",
            x_field=temporals[0].name,
            y_field=measures[0].name,
            color_field=nominal_dims[0].name,
        )

    # 1 temporal + ≥2 measures → multi_line folded by measure
    if temporals and not nominal_dims and len(measures) >= 2:
        return PickedChart(
            mark="multi_line",
            x_field=temporals[0].name,
            y_field=measures[0].name,
            color_field="__measures__",
        )

    # 2 nominal + 1 measure → grouped_bar or stacked_bar
    if len(nominal_dims) == 2 and len(measures) == 1:
        a, b = nominal_dims
        # Lower-cardinality dim becomes color; higher-cardinality dim goes on x.
        if a.cardinality <= b.cardinality:
            color, x = a, b
        else:
            color, x = b, a
        is_part_of_whole = measures[0].semantic_type in PART_OF_WHOLE_SEMTYPES
        mark = "stacked_bar" if is_part_of_whole else "grouped_bar"
        return PickedChart(
            mark=mark,
            x_field=x.name,
            y_field=measures[0].name,
            color_field=color.name,
        )

    # 1 nominal (≤8 rows) + 1 measure with part-of-whole → pie
    if (
        len(nominal_dims) == 1
        and len(measures) == 1
        and len(rs.rows) <= PIE_MAX_SLICES
        and measures[0].semantic_type in PART_OF_WHOLE_SEMTYPES
    ):
        return PickedChart(
            mark="pie",
            x_field=nominal_dims[0].name,
            y_field=measures[0].name,
        )

    # 1 nominal + 1 measure → bar (default)
    if nominal_dims and len(measures) == 1:
        return PickedChart(
            mark="bar",
            x_field=nominal_dims[0].name,
            y_field=measures[0].name,
        )

    # 1 nominal + ≥2 measures → grouped_bar folded by measure
    if nominal_dims and len(measures) >= 2:
        return PickedChart(
            mark="grouped_bar",
            x_field=nominal_dims[0].name,
            y_field=measures[0].name,
            color_field="__measures__",
        )

    # Ultimate fallback: bar against the first available x candidate.
    x = nominal_dims[0] if nominal_dims else (
        temporals[0] if temporals else rs.columns[0]
    )
    return PickedChart(mark="bar", x_field=x.name, y_field=measures[0].name)
