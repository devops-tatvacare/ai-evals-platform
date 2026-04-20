"""Typed result-set model + the pure function that builds it.

The typer merges three inputs in priority order:
  1. Declared hints from the SQL generator (``output_columns``).
  2. Manifest column definitions (when the output column is a passthrough).
  3. Empirical detection from the rows (fallback only).

This module is pure Python / stdlib. It does no I/O and depends only on
``manifest.py`` types through duck-typing, so it stays cheap to import and
safe to call from request-path code.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from numbers import Real
from typing import Any, Literal, Optional

ColumnRole = Literal[
    "dimension", "measure", "temporal", "ordered_categorical", "key", "identifier"
]
DataType = Literal["quantitative", "temporal", "ordinal", "nominal", "boolean", "geo"]
SemanticType = Literal[
    "pk", "fk", "category", "id_hash", "currency", "percent",
    "lat", "lon", "count", "ratio", "score", "duration", "none",
]


@dataclass(frozen=True)
class TypedColumn:
    name: str
    role: ColumnRole
    data_type: DataType
    semantic_type: Optional[SemanticType]
    cardinality: int
    null_frac: float
    is_constant: bool


@dataclass(frozen=True)
class TypedResultSet:
    columns: list[TypedColumn]
    rows: list[dict[str, Any]]

    def column_by_name(self, name: str) -> TypedColumn:
        for col in self.columns:
            if col.name == name:
                return col
        raise KeyError(name)

    def columns_by_role(self, role: ColumnRole) -> list[TypedColumn]:
        return [c for c in self.columns if c.role == role]


def _empirical_role_and_type(values: list[Any]) -> tuple[ColumnRole, DataType]:
    """Last-resort typing when neither hint nor manifest applies.

    Checks ``bool`` before ``Real`` because ``bool`` is a subclass of ``int``
    in Python and would otherwise be classified as quantitative.
    """
    non_null = [v for v in values if v is not None]
    if not non_null:
        return "dimension", "nominal"
    sample = non_null[0]
    if isinstance(sample, (datetime, date)):
        return "temporal", "temporal"
    if isinstance(sample, bool):
        return "dimension", "boolean"
    if isinstance(sample, Real):
        return "measure", "quantitative"
    return "dimension", "nominal"


def type_result_set(
    rows: list[dict[str, Any]],
    *,
    declared_columns: Optional[list[dict[str, Any]]] = None,
    manifest: Any = None,
) -> TypedResultSet:
    """Build a ``TypedResultSet`` from raw rows + optional hints + optional manifest.

    Priority for each column's ``(role, data_type, semantic_type)`` triple:
      1. ``declared_columns[i]`` hints (``role_hint`` / ``type_hint`` /
         ``semantic_type_hint``) emitted by the SQL generator.
      2. Manifest column definition, resolved via ``source_column`` +
         ``manifest.lookup_column(...)``.
      3. Empirical detection from the row values.

    ``rows`` with no entries yields an empty ``TypedResultSet``; callers must
    handle the empty case via the chartability gate rather than here.
    """
    if not rows:
        return TypedResultSet(columns=[], rows=[])

    column_names = list(rows[0].keys())
    declared_by_alias: dict[str, dict[str, Any]] = {
        d["alias"]: d for d in (declared_columns or []) if d.get("alias")
    }

    typed_columns: list[TypedColumn] = []
    for name in column_names:
        values = [row.get(name) for row in rows]
        non_null = [v for v in values if v is not None]
        cardinality = len({_hash_key(v) for v in non_null})
        null_frac = 1.0 - (len(non_null) / len(values)) if values else 0.0
        is_constant = cardinality <= 1

        hint = declared_by_alias.get(name, {})
        role: Optional[str] = hint.get("role_hint")
        data_type: Optional[str] = hint.get("type_hint")
        semantic_type: Optional[str] = hint.get("semantic_type_hint")

        if (
            (role is None or data_type is None or semantic_type is None)
            and manifest is not None
        ):
            source_col = hint.get("source_column")
            if source_col and hasattr(manifest, "lookup_column"):
                m_col = manifest.lookup_column(source_col)
                if m_col is not None:
                    role = role or getattr(m_col, "role", None)
                    data_type = data_type or getattr(m_col, "data_type", None)
                    semantic_type = semantic_type or getattr(
                        m_col, "semantic_type", None
                    )

        if role is None or data_type is None:
            emp_role, emp_type = _empirical_role_and_type(values)
            role = role or emp_role
            data_type = data_type or emp_type

        typed_columns.append(
            TypedColumn(
                name=name,
                role=role,  # type: ignore[arg-type]
                data_type=data_type,  # type: ignore[arg-type]
                semantic_type=semantic_type,  # type: ignore[arg-type]
                cardinality=cardinality,
                null_frac=null_frac,
                is_constant=is_constant,
            )
        )

    return TypedResultSet(columns=typed_columns, rows=rows)


def _hash_key(v: Any) -> Any:
    """Make unhashable values (dict/list) counted by their str form for cardinality."""
    try:
        hash(v)
        return v
    except TypeError:
        return repr(v)
