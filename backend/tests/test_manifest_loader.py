# backend/tests/test_manifest_loader.py
import pytest
from pathlib import Path
from pydantic import ValidationError
from app.services.chat_engine.manifest import load_manifest_from_path, AppManifest, ManifestValidationError


def test_load_valid_manifest(tmp_path: Path):
    path = tmp_path / "test-app.yaml"
    path.write_text(
        """
app_id: test-app
catalog_tables:
  analytics_run_facts:
    orm: AnalyticsRunFact
    columns:
      pass_rate:
        role: measure
        measure_kind: percent
      created_at:
        role: temporal
data_surfaces:
  - key: runs
    backed_by: analytics_run_facts
""".lstrip()
    )
    manifest = load_manifest_from_path(path)
    assert isinstance(manifest, AppManifest)
    assert manifest.app_id == "test-app"
    assert "analytics_run_facts" in manifest.catalog_tables
    assert manifest.catalog_tables["analytics_run_facts"].columns["pass_rate"].role == "measure"
    assert manifest.data_surfaces[0].key == "runs"


def test_reject_unknown_role(tmp_path: Path):
    path = tmp_path / "bad-app.yaml"
    path.write_text(
        """
app_id: bad-app
catalog_tables:
  t:
    orm: Foo
    columns:
      c:
        role: not-a-role
data_surfaces: []
""".lstrip()
    )
    with pytest.raises(ManifestValidationError):
        load_manifest_from_path(path)


def test_surface_backed_by_must_reference_catalog_table(tmp_path: Path):
    path = tmp_path / "orphan-surface.yaml"
    path.write_text(
        """
app_id: orphan-surface
catalog_tables: {}
data_surfaces:
  - key: runs
    backed_by: some_missing_table
""".lstrip()
    )
    with pytest.raises(ManifestValidationError, match="orphan-surface.*some_missing_table"):
        load_manifest_from_path(path)


def test_reject_measure_kind_on_non_measure_column(tmp_path: Path):
    # From Task 1.1 code-review feedback: measure_kind only valid when role='measure'.
    path = tmp_path / "bad-measure-kind.yaml"
    path.write_text(
        """
app_id: bad-mk
catalog_tables:
  t:
    orm: Foo
    columns:
      c:
        role: dimension
        measure_kind: count
data_surfaces: []
""".lstrip()
    )
    with pytest.raises(ManifestValidationError, match="measure_kind.*role.*measure"):
        load_manifest_from_path(path)


def test_reject_invalid_app_id_pattern(tmp_path: Path):
    path = tmp_path / "bad-id.yaml"
    path.write_text(
        """
app_id: "BadAppID"
catalog_tables: {}
data_surfaces: []
""".lstrip()
    )
    with pytest.raises(ManifestValidationError):
        load_manifest_from_path(path)


def test_manifest_is_frozen(tmp_path: Path):
    """Verify that manifest models are frozen and reject mutations."""
    path = tmp_path / "test-app.yaml"
    path.write_text(
        """
app_id: test-app
catalog_tables:
  t:
    orm: Foo
    columns:
      c:
        role: dimension
data_surfaces: []
""".lstrip()
    )
    manifest = load_manifest_from_path(path)

    # Attempt to mutate a top-level field should raise ValidationError or TypeError
    with pytest.raises((ValidationError, TypeError)):
        manifest.app_id = "other"
