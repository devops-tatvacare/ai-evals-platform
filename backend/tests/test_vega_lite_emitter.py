"""Phase 3.3 — Vega-Lite emitter coverage + schema validation."""
from __future__ import annotations

import pytest

from app.services.chat_engine.chart_type_picker import PickedChart
from app.services.chat_engine.result_set_typer import TypedColumn, TypedResultSet
from app.services.chat_engine.vega_lite_emitter import emit, validate_spec


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


def test_bar_emits_valid_spec() -> None:
    rs = TypedResultSet(
        columns=[
            _col("evaluator", data_type="nominal"),
            _col("pass_rate", role="measure", data_type="quantitative",
                 semantic_type="percent"),
        ],
        rows=[
            {"evaluator": "E1", "pass_rate": 80},
            {"evaluator": "E2", "pass_rate": 60},
        ],
    )
    picked = PickedChart(mark="bar", x_field="evaluator", y_field="pass_rate")
    out = emit(rs, picked)
    assert out["spec"]["mark"] == "bar"
    assert out["spec"]["encoding"]["x"]["field"] == "evaluator"
    assert out["spec"]["encoding"]["x"]["type"] == "nominal"
    assert out["spec"]["encoding"]["y"]["field"] == "pass_rate"
    assert out["spec"]["encoding"]["y"]["type"] == "quantitative"
    assert out["spec"]["encoding"]["y"]["axis"]["format"] == ".1f"
    assert out["data"] == rs.rows
    validate_spec(out["spec"])


def test_line_emits_temporal_type() -> None:
    rs = TypedResultSet(
        columns=[
            _col("day", role="temporal", data_type="temporal"),
            _col("count", role="measure", data_type="quantitative",
                 semantic_type="count"),
        ],
        rows=[{"day": "2025-01-01", "count": 1}, {"day": "2025-01-02", "count": 2}],
    )
    picked = PickedChart(mark="line", x_field="day", y_field="count")
    out = emit(rs, picked)
    assert out["spec"]["mark"] == "line"
    assert out["spec"]["encoding"]["x"]["type"] == "temporal"


def test_area_uses_area_mark() -> None:
    rs = TypedResultSet(
        columns=[
            _col("day", role="temporal", data_type="temporal"),
            _col("cumulative", role="measure", data_type="quantitative",
                 semantic_type="count"),
        ],
        rows=[{"day": "2025-01-01", "cumulative": 10}],
    )
    picked = PickedChart(mark="area", x_field="day", y_field="cumulative")
    out = emit(rs, picked)
    assert out["spec"]["mark"] == "area"


def test_grouped_bar_emits_xoffset_and_color() -> None:
    rs = TypedResultSet(
        columns=[
            _col("result_status", cardinality=3),
            _col("rule_name", cardinality=2),
            _col("count", role="measure", data_type="quantitative",
                 semantic_type="count"),
        ],
        rows=[{"result_status": "PASS", "rule_name": "a", "count": 5}],
    )
    picked = PickedChart(
        mark="grouped_bar",
        x_field="result_status",
        y_field="count",
        color_field="rule_name",
    )
    out = emit(rs, picked)
    assert out["spec"]["mark"] == "bar"
    assert out["spec"]["encoding"]["xOffset"]["field"] == "rule_name"
    assert out["spec"]["encoding"]["color"]["field"] == "rule_name"


def test_stacked_bar_emits_stack_zero() -> None:
    rs = TypedResultSet(
        columns=[
            _col("day", cardinality=7),
            _col("status", cardinality=3),
            _col("pct", role="measure", data_type="quantitative",
                 semantic_type="percent"),
        ],
        rows=[{"day": "d1", "status": "pass", "pct": 70}],
    )
    picked = PickedChart(
        mark="stacked_bar",
        x_field="day",
        y_field="pct",
        color_field="status",
    )
    out = emit(rs, picked)
    assert out["spec"]["encoding"]["y"]["stack"] == "zero"
    assert out["spec"]["encoding"]["color"]["field"] == "status"


def test_multi_line_with_color_field_emits_line_with_color() -> None:
    rs = TypedResultSet(
        columns=[
            _col("day", role="temporal", data_type="temporal"),
            _col("evaluator", cardinality=3),
            _col("score", role="measure", data_type="quantitative",
                 semantic_type="score"),
        ],
        rows=[{"day": "2025-01-01", "evaluator": "A", "score": 0.8}],
    )
    picked = PickedChart(
        mark="multi_line",
        x_field="day",
        y_field="score",
        color_field="evaluator",
    )
    out = emit(rs, picked)
    assert out["spec"]["mark"] == "line"
    assert out["spec"]["encoding"]["color"]["field"] == "evaluator"


def test_multi_line_measures_fold_emits_transform() -> None:
    rs = TypedResultSet(
        columns=[
            _col("day", role="temporal", data_type="temporal"),
            _col("pass_count", role="measure", data_type="quantitative",
                 semantic_type="count"),
            _col("fail_count", role="measure", data_type="quantitative",
                 semantic_type="count"),
        ],
        rows=[{"day": "2025-01-01", "pass_count": 5, "fail_count": 2}],
    )
    picked = PickedChart(
        mark="multi_line",
        x_field="day",
        y_field="pass_count",
        color_field="__measures__",
    )
    out = emit(rs, picked)
    assert out["spec"]["mark"] == "line"
    assert out["spec"]["transform"] == [
        {"fold": ["pass_count", "fail_count"], "as": ["measure", "value"]},
    ]
    assert out["spec"]["encoding"]["color"]["field"] == "measure"


def test_pie_emits_arc_with_theta() -> None:
    rs = TypedResultSet(
        columns=[
            _col("status", cardinality=3),
            _col("pct", role="measure", data_type="quantitative",
                 semantic_type="percent"),
        ],
        rows=[{"status": "pass", "pct": 70}],
    )
    picked = PickedChart(mark="pie", x_field="status", y_field="pct")
    out = emit(rs, picked)
    assert out["spec"]["mark"] == "arc"
    assert out["spec"]["encoding"]["theta"]["field"] == "pct"
    assert out["spec"]["encoding"]["color"]["field"] == "status"


def test_invalid_spec_raises() -> None:
    with pytest.raises(ValueError, match="Invalid Vega-Lite"):
        validate_spec({"mark": "not-a-real-mark", "encoding": {}})


def test_unsupported_mark_raises() -> None:
    rs = TypedResultSet(
        columns=[
            _col("x"),
            _col("y", role="measure", data_type="quantitative"),
        ],
        rows=[{"x": "a", "y": 1}],
    )
    picked = PickedChart(mark="horizontal_bar", x_field="x", y_field="y")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="Unsupported mark"):
        emit(rs, picked)
