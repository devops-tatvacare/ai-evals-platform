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


class SpecDataMismatchError(ValueError):
    """A Vega-Lite spec references a field that is not present in the rows.

    Raised by :func:`assert_spec_fields_exist_in_rows`. Distinct from the
    generic ``ValueError`` ``validate_spec`` raises so the chart pipeline can
    log a precise reason and degrade to a table fallback.
    """


_FIELD_ENCODING_KEYS = ("x", "y", "theta", "color", "xOffset")


def _spec_referenced_fields(spec: dict[str, Any]) -> list[str]:
    """Collect every field name a Vega-Lite spec references.

    Covers the encodings emitted today (``x``, ``y``, ``theta``, ``color``,
    ``xOffset``) and the ``fold`` transform's source column list. Synthetic
    fold output names (``measure``/``value`` etc., named in ``transform.as``)
    are excluded because they don't need to exist in input rows.
    """
    referenced: list[str] = []

    encoding = spec.get("encoding") or {}
    if isinstance(encoding, dict):
        for key in _FIELD_ENCODING_KEYS:
            entry = encoding.get(key)
            if isinstance(entry, dict):
                field = entry.get("field")
                if isinstance(field, str) and field:
                    referenced.append(field)

    transforms = spec.get("transform") or []
    if isinstance(transforms, list):
        # Synthetic fields emitted by ``fold`` are listed in ``transform.as``.
        # They're produced from the input rows, so they should *not* be
        # checked against ``rows[0].keys()``. Track them so we can drop any
        # encoding fields that point at them after the fact.
        synthetic: set[str] = set()
        for t in transforms:
            if not isinstance(t, dict):
                continue
            fold = t.get("fold")
            if isinstance(fold, list):
                for f in fold:
                    if isinstance(f, str) and f:
                        referenced.append(f)
            as_field = t.get("as")
            if isinstance(as_field, list):
                synthetic.update(s for s in as_field if isinstance(s, str))
            elif isinstance(as_field, str):
                synthetic.add(as_field)
        if synthetic:
            referenced = [f for f in referenced if f not in synthetic]

    return referenced


def assert_spec_fields_exist_in_rows(
    spec: dict[str, Any],
    rows: list[dict[str, Any]],
) -> None:
    """Regression guard: every spec-referenced field must exist in the rows.

    Called after :func:`emit` constructs a spec/data pair. The current picker
    + emitter produce specs whose fields all come from ``TypedResultSet``
    columns (which are themselves derived from ``rows[0].keys()``), so this
    check passes by construction. Treat it as a tripwire — any future change
    that lets an LLM-declared field reach the spec without going through the
    typer will surface here instead of at the frontend.
    """
    if not rows:
        # Empty rows ride out via the chartability gate's ``empty`` fallback;
        # callers should never pass an empty list to a chart spec, but we'd
        # rather no-op than misreport.
        return
    actual = set(rows[0].keys())
    missing = [f for f in _spec_referenced_fields(spec) if f not in actual]
    if missing:
        raise SpecDataMismatchError(
            f"Vega-Lite spec references field(s) not in data rows: {missing}"
        )


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
