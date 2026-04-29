"""Phase 2.1/2.2 — TypedResultSet dataclass + type_result_set() priority merge."""
from __future__ import annotations

import pytest

from app.services.chat_engine.result_set_typer import (
    TypedColumn,
    TypedResultSet,
    type_result_set,
)


# ── 2.1 TypedColumn / TypedResultSet shape ───────────────────────────


def test_typed_column_fields() -> None:
    col = TypedColumn(
        name="pass_rate",
        role="measure",
        data_type="quantitative",
        semantic_type="percent",
        cardinality=5,
        null_frac=0.0,
        is_constant=False,
    )
    assert col.name == "pass_rate"
    assert col.role == "measure"


def test_typed_result_set_holds_columns_and_rows() -> None:
    cols = [
        TypedColumn(
            name="x",
            role="dimension",
            data_type="nominal",
            semantic_type="category",
            cardinality=3,
            null_frac=0,
            is_constant=False,
        )
    ]
    rows = [{"x": "a"}, {"x": "b"}, {"x": "c"}]
    rs = TypedResultSet(columns=cols, rows=rows)
    assert len(rs.rows) == 3
    assert rs.column_by_name("x").cardinality == 3


def test_column_by_name_missing_raises() -> None:
    rs = TypedResultSet(columns=[], rows=[])
    with pytest.raises(KeyError):
        rs.column_by_name("nope")


def test_columns_by_role_filters() -> None:
    cols = [
        TypedColumn(
            name="x", role="dimension", data_type="nominal",
            semantic_type=None, cardinality=2, null_frac=0, is_constant=False,
        ),
        TypedColumn(
            name="y", role="measure", data_type="quantitative",
            semantic_type="count", cardinality=5, null_frac=0, is_constant=False,
        ),
    ]
    rs = TypedResultSet(columns=cols, rows=[])
    assert [c.name for c in rs.columns_by_role("measure")] == ["y"]


# ── 2.2 type_result_set() priority merge ─────────────────────────────


def test_declared_hints_win_over_manifest() -> None:
    declared = [
        {"alias": "c", "role_hint": "measure", "type_hint": "quantitative"},
    ]
    rows = [{"c": 1}, {"c": 2}]
    rs = type_result_set(rows, declared_columns=declared, manifest=None)
    col = rs.column_by_name("c")
    assert col.role == "measure"
    assert col.data_type == "quantitative"


def test_manifest_fills_when_hint_absent() -> None:
    class _Col:
        role = "identifier"
        data_type = "nominal"
        semantic_type = "id_hash"

    class _Manifest:
        @staticmethod
        def lookup_column(name: str):
            return _Col() if name == "evaluation_run_thread_results.thread_id" else None

    rows = [{"thread_id": "a"}, {"thread_id": "b"}]
    declared = [
        {"alias": "thread_id", "source_column": "evaluation_run_thread_results.thread_id"}
    ]
    rs = type_result_set(rows, declared_columns=declared, manifest=_Manifest())
    col = rs.column_by_name("thread_id")
    assert col.role == "identifier"
    assert col.semantic_type == "id_hash"


def test_empirical_fallback_when_no_hints() -> None:
    rows = [{"x": "a"}, {"x": "b"}, {"x": "c"}]
    rs = type_result_set(rows, declared_columns=None, manifest=None)
    col = rs.column_by_name("x")
    assert col.role == "dimension"
    assert col.data_type == "nominal"


def test_empirical_numeric_becomes_measure() -> None:
    rows = [{"n": 1.5}, {"n": 2.0}, {"n": 3.0}]
    rs = type_result_set(rows, declared_columns=None, manifest=None)
    col = rs.column_by_name("n")
    assert col.role == "measure"
    assert col.data_type == "quantitative"


def test_empirical_datetime_becomes_temporal() -> None:
    from datetime import datetime
    rows = [{"t": datetime(2026, 1, 1)}, {"t": datetime(2026, 1, 2)}]
    rs = type_result_set(rows, declared_columns=None, manifest=None)
    col = rs.column_by_name("t")
    assert col.role == "temporal"
    assert col.data_type == "temporal"


def test_cardinality_and_constancy() -> None:
    rows = [{"m": 5}, {"m": 5}, {"m": 5}]
    declared = [{"alias": "m", "role_hint": "measure", "type_hint": "quantitative"}]
    rs = type_result_set(rows, declared_columns=declared, manifest=None)
    col = rs.column_by_name("m")
    assert col.cardinality == 1
    assert col.is_constant is True
    assert col.null_frac == 0.0


def test_null_fraction() -> None:
    rows = [{"m": 1}, {"m": None}, {"m": None}, {"m": None}]
    declared = [{"alias": "m", "role_hint": "measure", "type_hint": "quantitative"}]
    rs = type_result_set(rows, declared_columns=declared, manifest=None)
    col = rs.column_by_name("m")
    assert col.null_frac == 0.75


def test_empty_rows_returns_empty_typed_set() -> None:
    rs = type_result_set([], declared_columns=None, manifest=None)
    assert rs.rows == []
    assert rs.columns == []
