"""Phase 1.5 — taxonomy validator flags semantic drift."""
from __future__ import annotations

import pytest

from app.services.chat_engine.manifest import AppManifest, CatalogTable, ManifestColumn
from app.services.chat_engine.manifest_validator import validate_manifest_taxonomy


def _mk(columns: dict[str, ManifestColumn]) -> AppManifest:
    return AppManifest(
        app_id="test",
        catalog_tables={"t": CatalogTable(orm="X", columns=columns)},
        data_surfaces=[],
    )


def test_warns_when_measure_missing_semantic_type() -> None:
    m = _mk({"x": ManifestColumn(role="measure", type="int")})
    warnings = validate_manifest_taxonomy(m)
    assert any("semantic_type" in w for w in warnings)


def test_errors_on_data_type_mismatch_with_measure_role() -> None:
    m = _mk(
        {"x": ManifestColumn(role="measure", data_type="nominal", semantic_type="count")}
    )
    with pytest.raises(ValueError, match="data_type"):
        validate_manifest_taxonomy(m, strict=True)


def test_errors_on_data_type_mismatch_with_temporal_role() -> None:
    m = _mk({"t": ManifestColumn(role="temporal", data_type="nominal")})
    with pytest.raises(ValueError, match="data_type"):
        validate_manifest_taxonomy(m, strict=True)


def test_no_issues_on_clean_manifest() -> None:
    m = _mk(
        {
            "score": ManifestColumn(
                role="measure",
                data_type="quantitative",
                semantic_type="score",
            ),
            "created_at": ManifestColumn(role="temporal", data_type="temporal"),
        }
    )
    assert validate_manifest_taxonomy(m) == []
