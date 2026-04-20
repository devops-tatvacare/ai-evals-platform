"""Phase 4.6A — saved chart config round-trips the canonical chart contract.

The ChartConfigIn schema accepts optional ``kind`` + ``spec`` fields alongside
the legacy translator-derived fields. When present, replay surfaces route
rendering through ``vegaLiteToRecharts`` so saved charts render with the same
data-shape semantics as the live-chat chart that was saved.
"""
from __future__ import annotations

from app.routes.analytics_library import ChartConfigIn, _normalize_chart_config


def test_chart_config_accepts_canonical_kind_and_spec() -> None:
    cfg = ChartConfigIn(
        renderer={
            "type": "bar",
            "xKey": "evaluator",
            "yKey": "pass_rate",
        },
        canonical={
            "kind": "chart",
            "spec": {
                "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
                "mark": "bar",
                "encoding": {
                    "x": {"field": "evaluator", "type": "nominal"},
                    "y": {"field": "pass_rate", "type": "quantitative"},
                },
            },
        },
    )
    dumped = cfg.model_dump(by_alias=True)
    assert dumped["canonical"]["kind"] == "chart"
    assert dumped["canonical"]["spec"]["mark"] == "bar"
    assert dumped["canonical"]["spec"]["encoding"]["x"]["field"] == "evaluator"


def test_chart_config_omits_kind_and_spec_when_absent() -> None:
    """Older clients that don't send canonical config still save successfully."""
    cfg = ChartConfigIn(renderer={"type": "bar", "xKey": "x", "yKey": "y"})
    dumped = cfg.model_dump(by_alias=True)
    assert dumped.get("canonical") is None


def test_normalize_chart_config_preserves_canonical_fields() -> None:
    """Stored JSONB with canonical fields survives normalization for replay."""
    stored = {
        "renderer": {
            "type": "bar",
            "xKey": "evaluator",
            "yKey": "pass_rate",
        },
        "canonical": {
            "kind": "chart",
            "spec": {
                "mark": "bar",
                "encoding": {
                    "x": {"field": "evaluator", "type": "nominal"},
                    "y": {"field": "pass_rate", "type": "quantitative"},
                },
            },
        },
    }
    normalized = _normalize_chart_config(stored)
    assert normalized["canonical"]["kind"] == "chart"
    assert normalized["canonical"]["spec"]["mark"] == "bar"


def test_normalize_chart_config_tolerates_snake_case_input() -> None:
    """Legacy snake_case keys for core fields still normalize to camelCase,
    and canonical fields (which are already camelCase on the wire) pass through."""
    stored = {
        "type": "line",
        "x_key": "day",
        "y_key": "count",
        "kind": "chart",
        "spec": {"mark": "line", "encoding": {"x": {"field": "day"}}},
    }
    normalized = _normalize_chart_config(stored)
    assert normalized["renderer"]["xKey"] == "day"
    assert normalized["renderer"]["yKey"] == "count"
    assert normalized["canonical"]["kind"] == "chart"
    assert normalized["canonical"]["spec"]["mark"] == "line"


def test_normalize_chart_config_handles_missing_spec_for_legacy_charts() -> None:
    """Charts saved before Phase 4.6A lack kind/spec — normalization must
    still succeed and return the legacy fields untouched."""
    legacy = {
        "type": "bar",
        "xKey": "x",
        "yKey": "y",
        "seriesKeys": ["y"],
        "xLabel": "X",
        "yLabel": "Y",
    }
    normalized = _normalize_chart_config(legacy)
    assert normalized["renderer"]["type"] == "bar"
    assert normalized["renderer"]["xKey"] == "x"
    assert normalized.get("canonical") is None
