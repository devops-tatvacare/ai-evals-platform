"""Vega-Lite v5 spec emitter + schema validator.

Turns a ``(TypedResultSet, PickedChart)`` pair into a validated Vega-Lite v5
spec plus the data rows. Covers the 7-mark enum produced by
``chart_type_picker``:

    bar | grouped_bar | stacked_bar | line | multi_line | area | pie

Every returned spec is validated against the official Vega-Lite v5 JSON
schema at the backend boundary. Invalid specs raise ``ValueError`` — the
orchestrator catches and degrades to a table fallback rather than letting a
malformed spec leak to the frontend.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator

from app.services.chat_engine.chart_type_picker import PickedChart
from app.services.chat_engine.result_set_typer import TypedColumn, TypedResultSet

_SCHEMA_PATH = Path(__file__).parent / "vega-lite-schema-v5.json"
_validator_cache: Draft7Validator | None = None


def _validator() -> Draft7Validator:
    """Validator keyed at the official ``TopLevelUnitSpec``.

    The full top-level schema requires ``data`` and allows ``$schema``.
    We call it with a synthetic ``data`` placeholder (see
    :func:`validate_spec`) because our emitted spec carries ``data`` as a
    sibling (to keep the frontend translator ergonomic) — validation still
    exercises mark/encoding/transform against the real v5 grammar.
    """
    global _validator_cache
    if _validator_cache is None:
        full = json.loads(_SCHEMA_PATH.read_text())
        unit = full["definitions"]["TopLevelUnitSpec"]
        schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "definitions": full["definitions"],
            **unit,
        }
        _validator_cache = Draft7Validator(schema)
    return _validator_cache


_PLACEHOLDER_DATA = {"values": [{}]}


def validate_spec(spec: dict[str, Any]) -> None:
    """Raise ``ValueError`` when the spec is invalid against Vega-Lite v5.

    The real spec carries ``data`` as a sibling for the frontend
    translator; for validation we inject a stub so ``TopLevelUnitSpec``
    (which requires ``data``) accepts it.
    """
    candidate = {"data": _PLACEHOLDER_DATA, **spec}
    errors = sorted(_validator().iter_errors(candidate), key=lambda e: list(e.path))
    if errors:
        first = errors[0]
        path = list(first.path)
        raise ValueError(
            f"Invalid Vega-Lite spec at {path}: {first.message}"
        )


def _col(rs: TypedResultSet, name: str) -> TypedColumn:
    return rs.column_by_name(name)


def _axis_title(col: TypedColumn) -> str:
    return col.name.replace("_", " ").title()


_SEMANTIC_FORMAT: dict[str, str] = {
    "percent": ".1f",
    "currency": "$,.2f",
    "ratio": ".2f",
    "score": ".2f",
    "count": ",d",
    "duration": ",d",
}


def _format_for_semantic_type(st: str | None) -> str | None:
    return _SEMANTIC_FORMAT.get(st or "")


def _x_encoding(col: TypedColumn, field: str) -> dict[str, Any]:
    return {
        "field": field,
        "type": col.data_type,
        "axis": {"title": _axis_title(col)},
    }


def _y_encoding(col: TypedColumn, field: str) -> dict[str, Any]:
    enc: dict[str, Any] = {
        "field": field,
        "type": col.data_type,
        "axis": {"title": _axis_title(col)},
    }
    fmt = _format_for_semantic_type(col.semantic_type)
    if fmt:
        enc["axis"]["format"] = fmt
    return enc


def emit(rs: TypedResultSet, picked: PickedChart) -> dict[str, Any]:
    """Build and validate a Vega-Lite v5 spec for ``picked``.

    Returns ``{"spec": <jsonschema-valid spec>, "data": rs.rows}``. Callers
    should catch ``ValueError`` and degrade to a table fallback.
    """
    x_col = _col(rs, picked.x_field)
    y_col = _col(rs, picked.y_field)

    if picked.mark == "multi_line":
        if picked.color_field == "__measures__":
            measure_names = [c.name for c in rs.columns if c.role == "measure"]
            return _emit_with_fold(rs, picked, measure_names, mark="line")
        color_col = _col(rs, picked.color_field or "")
        spec: dict[str, Any] = {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "mark": "line",
            "encoding": {
                "x": _x_encoding(x_col, picked.x_field),
                "y": _y_encoding(y_col, picked.y_field),
                "color": {
                    "field": picked.color_field,
                    "type": "nominal",
                    "legend": {"title": _axis_title(color_col)},
                },
            },
        }
        validate_spec(spec)
        return {"spec": spec, "data": rs.rows}

    if picked.mark == "grouped_bar":
        if picked.color_field == "__measures__":
            measure_names = [c.name for c in rs.columns if c.role == "measure"]
            return _emit_with_fold(
                rs, picked, measure_names, mark="bar", grouped=True
            )
        color_col = _col(rs, picked.color_field or "")
        spec = {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "mark": "bar",
            "encoding": {
                "x": _x_encoding(x_col, picked.x_field),
                "y": _y_encoding(y_col, picked.y_field),
                "xOffset": {"field": picked.color_field},
                "color": {
                    "field": picked.color_field,
                    "type": "nominal",
                    "legend": {"title": _axis_title(color_col)},
                },
            },
        }
        validate_spec(spec)
        return {"spec": spec, "data": rs.rows}

    if picked.mark == "stacked_bar":
        color_col = _col(rs, picked.color_field or "")
        y_enc = _y_encoding(y_col, picked.y_field)
        y_enc["stack"] = "zero"
        spec = {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "mark": "bar",
            "encoding": {
                "x": _x_encoding(x_col, picked.x_field),
                "y": y_enc,
                "color": {
                    "field": picked.color_field,
                    "type": "nominal",
                    "legend": {"title": _axis_title(color_col)},
                },
            },
        }
        validate_spec(spec)
        return {"spec": spec, "data": rs.rows}

    if picked.mark == "pie":
        spec = {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "mark": "arc",
            "encoding": {
                "theta": {"field": picked.y_field, "type": "quantitative"},
                "color": {
                    "field": picked.x_field,
                    "type": "nominal",
                    "legend": {"title": _axis_title(x_col)},
                },
            },
        }
        validate_spec(spec)
        return {"spec": spec, "data": rs.rows}

    if picked.mark in ("bar", "line", "area"):
        spec = {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "mark": picked.mark,
            "encoding": {
                "x": _x_encoding(x_col, picked.x_field),
                "y": _y_encoding(y_col, picked.y_field),
            },
        }
        validate_spec(spec)
        return {"spec": spec, "data": rs.rows}

    raise ValueError(f"Unsupported mark: {picked.mark!r}")


def _emit_with_fold(
    rs: TypedResultSet,
    picked: PickedChart,
    measure_names: list[str],
    *,
    mark: str = "line",
    grouped: bool = False,
) -> dict[str, Any]:
    """Vega-Lite ``fold`` transform for multi-measure charts.

    Turns multiple measure columns (``pass_count``, ``fail_count``, …) into
    key/value rows so a single color encoding can distinguish them.
    """
    x_col = _col(rs, picked.x_field)
    encoding: dict[str, Any] = {
        "x": _x_encoding(x_col, picked.x_field),
        "y": {"field": "value", "type": "quantitative"},
        "color": {"field": "measure", "type": "nominal"},
    }
    if grouped:
        encoding["xOffset"] = {"field": "measure"}
    spec: dict[str, Any] = {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "transform": [
            {"fold": measure_names, "as": ["measure", "value"]},
        ],
        "mark": mark,
        "encoding": encoding,
    }
    validate_spec(spec)
    return {"spec": spec, "data": rs.rows}
