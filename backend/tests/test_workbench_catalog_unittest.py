"""Unit tests for the workbench semantic catalog + drift validator.

Pure-Python tests — no live Postgres. The drift validator runs the
catalog ↔ manifest cross-check against the catalog's own structure and
a synthetic manifest, so failures are easy to bisect.
"""
from __future__ import annotations

import unittest

from app.services.chat_engine.manifest import (
    AppManifest,
    CatalogTable,
    ManifestColumn,
)
from app.services.chat_engine.manifest_validator import (
    WorkbenchCatalogDriftError,
    validate_workbench_against_manifest,
)
from app.services.chat_engine.workbench_catalog import (
    WorkbenchCatalogError,
    _clear_catalog_cache_for_tests,
    load_workbench_catalog_strict,
    parse_workbench_catalog,
    workbench_to_prompt_inputs,
)


def _minimal_manifest() -> AppManifest:
    """A manifest with the physical tables needed to back the test catalog."""
    return AppManifest(
        app_id="inside-sales",
        catalog_tables={
            "agg_evaluation_run": CatalogTable(
                orm="AggEvaluationRun",
                pg_schema="analytics",
                layer="analytics_aggregate",
                columns={
                    "id": ManifestColumn(role="identifier", semantic_type="pk"),
                    "run_id": ManifestColumn(role="identifier", semantic_type="id_hash"),
                    "run_name": ManifestColumn(role="dimension"),
                    "eval_type": ManifestColumn(role="dimension"),
                    "status": ManifestColumn(role="dimension"),
                    "tenant_id": ManifestColumn(role="identifier"),
                    "app_id": ManifestColumn(role="dimension"),
                },
            ),
            "fact_evaluation": CatalogTable(
                orm="FactEvaluation",
                pg_schema="analytics",
                layer="analytics_fact",
                columns={
                    "id": ManifestColumn(role="identifier", semantic_type="pk"),
                    "run_id": ManifestColumn(role="identifier"),
                    "agent": ManifestColumn(role="dimension"),
                    "result_score": ManifestColumn(
                        role="measure",
                        data_type="quantitative",
                        semantic_type="score",
                    ),
                    "result_detail": ManifestColumn(role="dimension"),
                    "item_id": ManifestColumn(role="identifier"),
                    "evaluator_id": ManifestColumn(role="identifier"),
                    "tenant_id": ManifestColumn(role="identifier"),
                    "app_id": ManifestColumn(role="dimension"),
                    "created_at": ManifestColumn(role="temporal"),
                },
            ),
        },
        data_surfaces=[],
    )


def _minimal_catalog_yaml() -> dict:
    return {
        "name": "test_model",
        "tables": {
            "agg_evaluation_run": {
                "table_kind": "aggregate",
                "base_table": {
                    "schema": "analytics",
                    "table": "agg_evaluation_run",
                },
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["run_id"]},
                "dimensions": [
                    {"name": "run_id", "expr": "run_id"},
                    {"name": "run_name", "expr": "run_name"},
                ],
            },
            "fact_evaluation": {
                "table_kind": "fact",
                "base_table": {"schema": "analytics", "table": "fact_evaluation"},
                "physical_primary_key": {"columns": ["id"]},
                "analytical_grain": {"columns": ["run_id", "item_id", "evaluator_id"]},
                "dimensions": [
                    {"name": "run_id", "expr": "run_id"},
                    {"name": "item_id", "expr": "item_id"},
                    {"name": "evaluator_id", "expr": "evaluator_id"},
                    {"name": "agent", "expr": "agent"},
                    {
                        "name": "call_opening_score",
                        "expr": "(result_detail->>'call_opening')::numeric",
                        "data_type": "quantitative",
                        "source_table": "fact_evaluation",
                    },
                ],
                "facts": [{"name": "result_score", "expr": "result_score"}],
            },
        },
        "relationships": [
            {
                "name": "fact_eval_to_agg_run",
                "left_table": "fact_evaluation",
                "right_table": "agg_evaluation_run",
                "relationship_columns": [
                    {"left_column": "run_id", "right_column": "run_id"}
                ],
                "join_type": "inner",
                "relationship_type": "many_to_one",
            },
        ],
        "verified_queries": [
            {"name": "q1", "question": "?", "sql": "SELECT 1"},
            {"name": "q2", "question": "?", "sql": "SELECT 2"},
            {"name": "q3", "question": "?", "sql": "SELECT 3"},
        ],
    }


class CatalogParseTests(unittest.TestCase):
    def test_minimal_catalog_loads(self) -> None:
        c = parse_workbench_catalog(_minimal_catalog_yaml())
        self.assertEqual(c.name, "test_model")
        self.assertEqual(
            sorted(c.tables.keys()),
            ["agg_evaluation_run", "fact_evaluation"],
        )
        self.assertEqual(len(c.relationships), 1)
        self.assertEqual(len(c.verified_queries), 3)

    def test_missing_physical_primary_key_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        del raw["tables"]["fact_evaluation"]["physical_primary_key"]
        with self.assertRaises(WorkbenchCatalogError) as cm:
            parse_workbench_catalog(raw)
        self.assertIn("physical_primary_key", str(cm.exception))

    def test_missing_analytical_grain_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        del raw["tables"]["agg_evaluation_run"]["analytical_grain"]
        with self.assertRaises(WorkbenchCatalogError) as cm:
            parse_workbench_catalog(raw)
        self.assertIn("analytical_grain", str(cm.exception))

    def test_relationship_referencing_unknown_table_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["relationships"][0]["right_table"] = "ghost_table"
        with self.assertRaises(WorkbenchCatalogError) as cm:
            parse_workbench_catalog(raw)
        self.assertIn("ghost_table", str(cm.exception))

    def test_relationship_referencing_unknown_column_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["relationships"][0]["relationship_columns"][0]["right_column"] = "nope"
        with self.assertRaises(WorkbenchCatalogError) as cm:
            parse_workbench_catalog(raw)
        self.assertIn("nope", str(cm.exception))

    def test_enum_without_sample_values_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["tables"]["fact_evaluation"]["dimensions"].append(
            {"name": "direction", "expr": "direction", "is_enum": True}
        )
        with self.assertRaises(WorkbenchCatalogError) as cm:
            parse_workbench_catalog(raw)
        self.assertIn("sample_values", str(cm.exception))

    def test_fewer_than_three_verified_queries_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["verified_queries"] = raw["verified_queries"][:2]
        with self.assertRaises(WorkbenchCatalogError) as cm:
            parse_workbench_catalog(raw)
        self.assertIn("verified_queries", str(cm.exception))

    def test_many_to_many_relationship_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["relationships"][0]["relationship_type"] = "many_to_many"
        with self.assertRaises(WorkbenchCatalogError) as cm:
            parse_workbench_catalog(raw)
        self.assertIn("many_to_many", str(cm.exception))

    def test_analytical_grain_column_must_resolve(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["tables"]["agg_evaluation_run"]["analytical_grain"] = {
            "columns": ["ghost_col"]
        }
        with self.assertRaises(WorkbenchCatalogError) as cm:
            parse_workbench_catalog(raw)
        self.assertIn("ghost_col", str(cm.exception))

    def test_raw_jsonb_logical_columns_are_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["tables"]["fact_evaluation"]["dimensions"].append(
            {"name": "result_detail", "expr": "result_detail", "physical_type": "jsonb"}
        )
        with self.assertRaises(WorkbenchCatalogError) as cm:
            parse_workbench_catalog(raw)
        self.assertIn("raw JSONB column", str(cm.exception))

    def test_prompt_inputs_do_not_expose_jsonb_expressions(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["verified_queries"].append(
            {
                "name": "jsonb_query",
                "question": "?",
                "sql": "SELECT result_detail->>'call_opening' FROM analytics.fact_evaluation",
            }
        )
        catalog = parse_workbench_catalog(raw)
        schema_context, _, _, exemplars = workbench_to_prompt_inputs(catalog)

        prompt_text = repr({"schema": schema_context, "exemplars": exemplars})
        self.assertNotIn("physical_expr", prompt_text)
        self.assertNotIn("->>", prompt_text)
        self.assertNotIn("result_detail", prompt_text)


class StrictFallbackTests(unittest.TestCase):
    """Plan invariant: a broken catalog YAML must raise, not silently fall
    through to the legacy path. ``None`` is reserved for ``file does not
    exist`` (the genuine "app not migrated yet" case).
    """

    def test_broken_workbench_yaml_raises_not_returns_none(self) -> None:
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        from app.services.chat_engine import workbench_catalog as wc

        with tempfile.TemporaryDirectory() as tmp:
            # workbench-shape (has `name:`) but missing required `tables:` —
            # this is a *broken* workbench catalog, not a legacy file.
            broken = Path(tmp) / "ghost-app.yaml"
            broken.write_text("name: ghost\n")
            with patch.object(wc, "SEMANTIC_MODELS_DIR", Path(tmp)):
                wc._clear_catalog_cache_for_tests()
                with self.assertRaises(WorkbenchCatalogError):
                    wc.load_workbench_catalog("ghost-app")

    def test_legacy_yaml_returns_none(self) -> None:
        """Legacy files (version: key, no name: key) are pre-Phase-1 and
        return None — the staged rollout treats them as "not migrated yet"."""
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        from app.services.chat_engine import workbench_catalog as wc

        with tempfile.TemporaryDirectory() as tmp:
            legacy = Path(tmp) / "legacy-app.yaml"
            legacy.write_text("version: \"3.0\"\ntables:\n  fact_evaluation: {}\n")
            with patch.object(wc, "SEMANTIC_MODELS_DIR", Path(tmp)):
                wc._clear_catalog_cache_for_tests()
                self.assertIsNone(wc.load_workbench_catalog("legacy-app"))

    def test_missing_file_returns_none(self) -> None:
        from app.services.chat_engine.workbench_catalog import load_workbench_catalog
        self.assertIsNone(load_workbench_catalog("no-such-app"))


class InsideSalesYAMLTests(unittest.TestCase):
    def test_authored_inside_sales_loads_clean(self) -> None:
        _clear_catalog_cache_for_tests()
        c = load_workbench_catalog_strict("inside-sales")
        self.assertEqual(c.name, "inside_sales_model")
        self.assertIn("fact_evaluation", c.tables)
        # ~30 derived columns from result_detail + ~6 from attributes.
        self.assertGreater(
            len(c.tables["fact_evaluation"].all_logical_columns()), 25
        )
        self.assertGreaterEqual(len(c.verified_queries), 3)

    def test_inside_sales_tenant_scoped_unique_key_on_lead_activity(self) -> None:
        _clear_catalog_cache_for_tests()
        c = load_workbench_catalog_strict("inside-sales")
        tsu = c.tables["fact_lead_activity"].tenant_scoped_unique_key
        self.assertIsNotNone(tsu)
        assert tsu is not None
        self.assertEqual(
            tsu.columns,
            ["tenant_id", "app_id", "source_activity_id"],
        )


class WorkbenchManifestDriftTests(unittest.TestCase):
    def test_manifest_lookup_respects_table_column_and_schema(self) -> None:
        manifest = _minimal_manifest()

        self.assertIsNotNone(
            manifest.lookup_column("fact_evaluation.result_score")
        )
        self.assertIsNotNone(
            manifest.lookup_column("analytics.fact_evaluation.result_score")
        )
        self.assertIsNone(
            manifest.lookup_column("platform.fact_evaluation.result_score")
        )
        self.assertIsNone(
            manifest.lookup_column("analytics.fact_evaluation.resultScore")
        )
        self.assertIsNone(manifest.lookup_column("result_score"))

    def test_clean_pair_passes(self) -> None:
        catalog = parse_workbench_catalog(_minimal_catalog_yaml())
        manifest = _minimal_manifest()
        # Should not raise.
        validate_workbench_against_manifest(catalog, manifest)

    def test_manifest_cross_check_ignores_json_keys_and_sql_functions(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["tables"]["fact_evaluation"]["dimensions"].append(
            {
                "name": "rounded_opening",
                "expr": "ROUND((result_detail->>'not_a_physical_column')::numeric, 2)",
                "data_type": "quantitative",
                "source_table": "fact_evaluation",
            }
        )
        catalog = parse_workbench_catalog(raw)

        validate_workbench_against_manifest(catalog, _minimal_manifest())

    def test_source_table_drives_physical_column_lookup(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["tables"]["dim_lead"] = {
            "table_kind": "dimension",
            "base_table": {"schema": "analytics", "table": "dim_lead"},
            "physical_primary_key": {"columns": ["id"]},
            "analytical_grain": {"columns": ["lead_from_eval"]},
            "dimensions": [
                {
                    "name": "lead_from_eval",
                    "expr": "result_detail->>'lead_id'",
                    "source_table": "fact_evaluation",
                }
            ],
        }
        manifest = _minimal_manifest().model_copy(update={
            "catalog_tables": {
                **_minimal_manifest().catalog_tables,
                "dim_lead": CatalogTable(
                    orm="DimLead",
                    pg_schema="analytics",
                    layer="analytics_fact",
                    columns={
                        "id": ManifestColumn(role="identifier", semantic_type="pk"),
                        "lead_id": ManifestColumn(role="identifier"),
                        "tenant_id": ManifestColumn(role="identifier"),
                        "app_id": ManifestColumn(role="dimension"),
                    },
                ),
            }
        })
        catalog = parse_workbench_catalog(raw)

        validate_workbench_against_manifest(catalog, manifest)

    def test_catalog_base_table_missing_from_manifest_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["tables"]["fact_evaluation"]["base_table"]["table"] = "ghost"
        catalog = parse_workbench_catalog(raw)
        manifest = _minimal_manifest()
        with self.assertRaises(WorkbenchCatalogDriftError) as cm:
            validate_workbench_against_manifest(catalog, manifest)
        self.assertIn("ghost", str(cm.exception))

    def test_logical_column_referencing_unknown_physical_rejected(self) -> None:
        raw = _minimal_catalog_yaml()
        raw["tables"]["fact_evaluation"]["dimensions"].append(
            {"name": "fake_dim", "expr": "ghost_col"}
        )
        catalog = parse_workbench_catalog(raw)
        manifest = _minimal_manifest()
        with self.assertRaises(WorkbenchCatalogDriftError) as cm:
            validate_workbench_against_manifest(catalog, manifest)
        self.assertIn("ghost_col", str(cm.exception))

    def test_derived_column_must_declare_source_table(self) -> None:
        raw = _minimal_catalog_yaml()
        # JSONB-extract expression without source_table.
        raw["tables"]["fact_evaluation"]["dimensions"].append(
            {
                "name": "no_source",
                "expr": "(result_detail->>'foo')::numeric",
            }
        )
        catalog = parse_workbench_catalog(raw)
        manifest = _minimal_manifest()
        with self.assertRaises(WorkbenchCatalogDriftError) as cm:
            validate_workbench_against_manifest(catalog, manifest)
        self.assertIn("source_table", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
