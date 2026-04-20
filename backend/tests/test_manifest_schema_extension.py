"""Phase 1.1 — manifest JSONSchema gains the chart-contract taxonomy fields."""
from __future__ import annotations

from pathlib import Path

import yaml

SCHEMA_PATH = (
    Path(__file__).resolve().parents[1]
    / "app/services/chat_engine/manifests/_schema.yaml"
)


def _column_schema() -> dict:
    schema = yaml.safe_load(SCHEMA_PATH.read_text())
    return schema["properties"]["catalog_tables"]["additionalProperties"][
        "properties"
    ]["columns"]["additionalProperties"]


def test_role_enum_includes_identifier() -> None:
    col = _column_schema()
    assert "identifier" in col["properties"]["role"]["enum"]


def test_data_type_enum_present() -> None:
    col = _column_schema()
    assert "data_type" in col["properties"]
    assert set(col["properties"]["data_type"]["enum"]) == {
        "quantitative",
        "temporal",
        "ordinal",
        "nominal",
        "boolean",
        "geo",
    }


def test_semantic_type_enum_present() -> None:
    col = _column_schema()
    assert "semantic_type" in col["properties"]
    assert set(col["properties"]["semantic_type"]["enum"]) == {
        "pk",
        "fk",
        "category",
        "id_hash",
        "currency",
        "percent",
        "lat",
        "lon",
        "count",
        "ratio",
        "score",
        "duration",
        "none",
    }


def test_chartable_flag_optional() -> None:
    col = _column_schema()
    assert col["properties"]["chartable"]["type"] == "boolean"
    assert "chartable" not in col.get("required", [])
