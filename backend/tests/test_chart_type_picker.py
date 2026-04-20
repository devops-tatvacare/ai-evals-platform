"""Phase 3.2 — deterministic chart-type picker coverage."""
from __future__ import annotations

from app.services.chat_engine.chart_type_picker import pick
from app.services.chat_engine.result_set_typer import TypedColumn, TypedResultSet


def _col(
    name: str,
    *,
    role: str = "dimension",
    data_type: str = "nominal",
    semantic_type: str | None = None,
    cardinality: int = 5,
    null_frac: float = 0.0,
    is_constant: bool = False,
) -> TypedColumn:
    return TypedColumn(
        name=name,
        role=role,  # type: ignore[arg-type]
        data_type=data_type,  # type: ignore[arg-type]
        semantic_type=semantic_type,  # type: ignore[arg-type]
        cardinality=cardinality,
        null_frac=null_frac,
        is_constant=is_constant,
    )


def _rs(cols, rows):
    return TypedResultSet(columns=cols, rows=rows)


def test_bar_one_nominal_one_measure() -> None:
    rs = _rs(
        [
            _col("evaluator_name"),
            _col("pass_rate", role="measure", data_type="quantitative"),
        ],
        [{"evaluator_name": f"E{i}", "pass_rate": 80} for i in range(5)],
    )
    p = pick(rs)
    assert p.mark == "bar"
    assert p.x_field == "evaluator_name"
    assert p.y_field == "pass_rate"


def test_line_one_temporal_one_measure() -> None:
    rs = _rs(
        [
            _col("created_at", role="temporal", data_type="temporal"),
            _col("count", role="measure", data_type="quantitative",
                 semantic_type="count"),
        ],
        [{"created_at": f"2025-01-0{i}", "count": i} for i in range(1, 6)],
    )
    p = pick(rs)
    assert p.mark == "line"
    assert p.x_field == "created_at"


def test_multi_line_temporal_plus_dim_plus_measure() -> None:
    rs = _rs(
        [
            _col("created_at", role="temporal", data_type="temporal"),
            _col("evaluator", role="dimension", cardinality=3),
            _col("score", role="measure", data_type="quantitative",
                 semantic_type="score"),
        ],
        [
            {"created_at": f"2025-01-0{i}", "evaluator": e, "score": i}
            for i in range(1, 4)
            for e in ("A", "B", "C")
        ],
    )
    p = pick(rs)
    assert p.mark == "multi_line"
    assert p.color_field == "evaluator"


def test_multi_line_temporal_plus_multiple_measures() -> None:
    rs = _rs(
        [
            _col("day", role="temporal", data_type="temporal"),
            _col("pass_count", role="measure", data_type="quantitative",
                 semantic_type="count"),
            _col("fail_count", role="measure", data_type="quantitative",
                 semantic_type="count"),
        ],
        [{"day": f"2025-01-0{i}", "pass_count": i, "fail_count": i} for i in range(1, 4)],
    )
    p = pick(rs)
    assert p.mark == "multi_line"
    assert p.color_field == "__measures__"


def test_grouped_bar_two_nominal_one_measure_places_lower_card_as_color() -> None:
    rs = _rs(
        [
            _col("result_status", cardinality=3),
            _col("rule_name", cardinality=2),
            _col("violated_count", role="measure", data_type="quantitative",
                 semantic_type="count"),
        ],
        [
            {"result_status": s, "rule_name": r, "violated_count": 5}
            for s in ("PASS", "FAIL", "CRITICAL")
            for r in ("a", "b")
        ],
    )
    p = pick(rs)
    assert p.mark == "grouped_bar"
    assert p.x_field == "result_status"
    assert p.color_field == "rule_name"


def test_stacked_bar_when_measure_is_percent() -> None:
    rs = _rs(
        [
            _col("day", cardinality=7),
            _col("status", cardinality=3),
            _col("pct", role="measure", data_type="quantitative",
                 semantic_type="percent"),
        ],
        [
            {"day": f"d{i}", "status": s, "pct": 33.3}
            for i in range(7)
            for s in ("pass", "fail", "error")
        ],
    )
    p = pick(rs)
    assert p.mark == "stacked_bar"


def test_area_when_measure_marked_cumulative() -> None:
    rs = _rs(
        [
            _col("created_at", role="temporal", data_type="temporal"),
            _col("cumulative_count", role="measure", data_type="quantitative",
                 semantic_type="count"),
        ],
        [
            {"created_at": f"2025-01-0{i}", "cumulative_count": i * 10}
            for i in range(1, 6)
        ],
    )
    p = pick(rs, cumulative_measures={"cumulative_count"})
    assert p.mark == "area"


def test_pie_low_card_nominal_with_percent_measure() -> None:
    rs = _rs(
        [
            _col("status", cardinality=3),
            _col("pct", role="measure", data_type="quantitative",
                 semantic_type="percent"),
        ],
        [
            {"status": "pass", "pct": 70},
            {"status": "fail", "pct": 20},
            {"status": "error", "pct": 10},
        ],
    )
    p = pick(rs)
    assert p.mark == "pie"


def test_fallback_to_bar_when_no_semantic_hint() -> None:
    rs = _rs(
        [_col("x"), _col("m", role="measure", data_type="quantitative")],
        [{"x": "a", "m": 1}, {"x": "b", "m": 2}],
    )
    p = pick(rs)
    assert p.mark == "bar"


def test_raises_when_called_without_measure() -> None:
    import pytest

    rs = _rs([_col("x"), _col("y")], [{"x": "a", "y": "b"}])
    with pytest.raises(ValueError, match="gate"):
        pick(rs)
