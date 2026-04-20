"""Phase 3.1 — chartability gate reason-code coverage."""
from __future__ import annotations

from app.services.chat_engine.chartability_gate import evaluate
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


def test_empty_rows_returns_cg_empty() -> None:
    r = evaluate(_rs([_col("a")], []))
    assert r.reason_code == "CG_EMPTY"
    assert r.fallback == "empty"
    assert r.chartable is False


def test_single_value_returns_cg_single_value() -> None:
    rs = _rs(
        [_col("count", role="measure", data_type="quantitative",
              semantic_type="count", cardinality=1, is_constant=True)],
        [{"count": 47}],
    )
    r = evaluate(rs)
    assert r.reason_code == "CG_SINGLE_VALUE"
    assert r.fallback == "kpi"


def test_field_card_single_row_multi_col() -> None:
    rs = _rs(
        [
            _col("run_id", role="identifier", semantic_type="id_hash"),
            _col("created_at", role="temporal", data_type="temporal"),
            _col("total", role="measure", data_type="quantitative",
                 semantic_type="count"),
        ],
        [{"run_id": "r1", "created_at": "2025-01-01", "total": 10}],
    )
    r = evaluate(rs)
    assert r.reason_code == "CG_FIELD_CARD"
    assert r.fallback == "summary"


def test_no_measure_returns_cg_no_measure() -> None:
    rs = _rs(
        [_col("status"), _col("evaluator_name")],
        [
            {"status": "pass", "evaluator_name": "E1"},
            {"status": "fail", "evaluator_name": "E2"},
        ],
    )
    r = evaluate(rs)
    assert r.reason_code == "CG_NO_MEASURE"
    assert r.fallback == "table"


def test_all_ids_returns_cg_all_ids() -> None:
    rs = _rs(
        [
            _col("thread_id", role="identifier", semantic_type="id_hash"),
            _col("session_id", role="identifier", semantic_type="id_hash"),
            _col("count", role="measure", data_type="quantitative",
                 semantic_type="count", cardinality=5),
        ],
        [
            {"thread_id": f"t{i}", "session_id": f"s{i}", "count": i}
            for i in range(5)
        ],
    )
    r = evaluate(rs)
    assert r.reason_code == "CG_ALL_IDS"
    assert r.fallback == "table"


def test_degenerate_measure_constant() -> None:
    rs = _rs(
        [
            _col("thread_id", role="identifier", semantic_type="id_hash",
                 cardinality=19),
            _col("is_failed", role="measure", data_type="quantitative",
                 semantic_type="count", cardinality=1, is_constant=True),
        ],
        [{"thread_id": f"t{i}", "is_failed": 1} for i in range(19)],
    )
    r = evaluate(rs)
    assert r.reason_code == "CG_DEGENERATE_MEASURE"
    assert r.fallback == "table"
    assert r.warning is not None
    assert "same" in r.warning.lower()


def test_degenerate_measure_mostly_null() -> None:
    rs = _rs(
        [
            _col("dim", cardinality=20),
            _col("m", role="measure", data_type="quantitative",
                 semantic_type="count", cardinality=1, null_frac=0.98),
        ],
        [{"dim": f"d{i}", "m": None} for i in range(20)],
    )
    r = evaluate(rs)
    assert r.reason_code == "CG_DEGENERATE_MEASURE"
    assert r.warning is not None
    assert "null" in r.warning.lower()


def test_high_cardinality_triggers_topn_warning() -> None:
    cols = [
        _col("evaluator_name", role="dimension", data_type="nominal",
             cardinality=120),
        _col("count", role="measure", data_type="quantitative",
             semantic_type="count", cardinality=120),
    ]
    rows = [{"evaluator_name": f"E{i}", "count": i} for i in range(120)]
    r = evaluate(_rs(cols, rows))
    assert r.reason_code == "CG_HIGH_CARD"
    assert r.fallback == "chart_with_warning"
    assert r.top_n == 25
    assert r.chartable is True


def test_happy_path_is_chartable() -> None:
    rs = _rs(
        [
            _col("evaluator_name", cardinality=5),
            _col("pass_rate", role="measure", data_type="quantitative",
                 semantic_type="percent", cardinality=5),
        ],
        [{"evaluator_name": f"E{i}", "pass_rate": 80 + i} for i in range(5)],
    )
    r = evaluate(rs)
    assert r.chartable is True
    assert r.reason_code is None
    assert r.fallback == "chart"
