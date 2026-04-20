"""Phase 1.2 — ManifestColumn Pydantic model gains taxonomy fields."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.services.chat_engine.manifest import ManifestColumn


def test_manifest_column_accepts_new_fields() -> None:
    col = ManifestColumn(
        role="measure",
        type="float",
        data_type="quantitative",
        semantic_type="percent",
        chartable=True,
    )
    assert col.data_type == "quantitative"
    assert col.semantic_type == "percent"
    assert col.chartable is True


def test_manifest_column_rejects_bad_data_type() -> None:
    with pytest.raises(ValidationError):
        ManifestColumn(role="measure", data_type="not-a-real-type")


def test_manifest_column_rejects_bad_semantic_type() -> None:
    with pytest.raises(ValidationError):
        ManifestColumn(role="dimension", semantic_type="not-real")


def test_manifest_column_identifier_role_valid() -> None:
    col = ManifestColumn(role="identifier", type="uuid")
    assert col.role == "identifier"


def test_manifest_column_defaults() -> None:
    col = ManifestColumn(role="dimension")
    assert col.data_type is None
    assert col.semantic_type is None
    assert col.chartable is None


def test_manifest_column_accepts_ordering_on_dimensions() -> None:
    col = ManifestColumn(role="dimension", ordering=["PASS", "FAIL"])
    assert col.ordering == ["PASS", "FAIL"]
