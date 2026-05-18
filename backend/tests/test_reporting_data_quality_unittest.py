"""Unit tests for the Phase 2 data_quality finalizer + contract round-trip."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from app.services.reports.contracts.data_quality import DataQualityReport
from app.services.reports.contracts.run_report import PlatformRunReportPayload
from app.services.reports.data_quality_finalizer import finalize_data_quality


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "reports"


class FinalizerTests(unittest.TestCase):
    def test_all_inputs_present_yields_complete(self):
        result = finalize_data_quality(
            missing_inputs=[],
            configured_section_ids=["a", "b"],
            produced_section_payload_ids={"a", "b"},
            composed_section_ids={"a", "b"},
            exported_section_ids={"a"},
        )
        self.assertEqual(result.overall, "complete")
        self.assertEqual(result.missing_inputs, [])
        self.assertEqual(result.section_status, {})

    def test_missing_input_only_yields_partial(self):
        result = finalize_data_quality(
            missing_inputs=["summary.avg_intent_accuracy"],
            configured_section_ids=["a"],
            produced_section_payload_ids={"a"},
            composed_section_ids={"a"},
            exported_section_ids={"a"},
        )
        self.assertEqual(result.overall, "partial")
        self.assertEqual(result.missing_inputs, ["summary.avg_intent_accuracy"])
        self.assertEqual(result.section_status, {})

    def test_configured_but_not_composed_yields_empty_section(self):
        result = finalize_data_quality(
            missing_inputs=[],
            configured_section_ids=["a", "b"],
            produced_section_payload_ids={"a"},  # producer didn't emit b
            composed_section_ids={"a"},
            exported_section_ids=set(),
        )
        self.assertEqual(result.overall, "partial")
        self.assertEqual(result.section_status, {"b": "empty"})

    def test_exported_but_not_composed_yields_dropped(self):
        result = finalize_data_quality(
            missing_inputs=[],
            configured_section_ids=["a"],
            produced_section_payload_ids={"a"},
            composed_section_ids={"a"},
            exported_section_ids=["a", "ghost-export"],
        )
        self.assertEqual(result.overall, "partial")
        self.assertEqual(result.section_status, {"ghost-export": "dropped_from_export"})

    def test_dropped_from_export_overrides_empty_marker(self):
        """A section that is both configured-but-uncomposed AND exported should
        be marked with the more specific 'dropped_from_export' signal."""
        result = finalize_data_quality(
            missing_inputs=[],
            configured_section_ids=["b"],
            produced_section_payload_ids=set(),
            composed_section_ids=set(),
            exported_section_ids=["b"],
        )
        self.assertEqual(result.section_status, {"b": "dropped_from_export"})

    def test_missing_inputs_and_empty_sections_yields_degraded(self):
        result = finalize_data_quality(
            missing_inputs=["evaluator_id"],
            configured_section_ids=["a", "b"],
            produced_section_payload_ids={"a"},
            composed_section_ids={"a"},
            exported_section_ids=set(),
        )
        self.assertEqual(result.overall, "degraded")


class ContractBackwardsCompatTests(unittest.TestCase):
    """Reading older cached artifacts (no data_quality / narrative_status keys)
    must continue to round-trip cleanly — cache_validation.py:16 raises 409 on
    any model_validate failure, so a missing default would invalidate every
    cached report on deploy."""

    def test_kaira_standard_run_fixture_round_trips_through_v1_contract(self):
        # The existing fixture is the legacy ReportPayload shape, not the
        # PlatformRunReportPayload shape — so we synthesize a v1 payload from
        # scratch with no data_quality and no narrative_status fields, mirroring
        # what an older cached artifact looks like on disk.
        legacy_v1 = {
            "schemaVersion": "v1",
            "metadata": {
                "appId": "kaira-bot",
                "reportKind": "single_run",
                "runId": "run-1",
                "runName": "smoke",
                "evalType": "batch",
                "createdAt": "2026-05-01T00:00:00Z",
                "computedAt": "2026-05-01T00:00:00Z",
                "llmProvider": None,
                "llmModel": None,
                "narrativeModel": None,
                "cacheKey": None,
            },
            "sections": [],
            "exportDocument": {
                "schemaVersion": "v1",
                "title": "Empty",
                "theme": {
                    "accent": "#000",
                    "accentMuted": "#fff",
                    "border": "#ccc",
                    "textPrimary": "#000",
                    "textSecondary": "#444",
                    "background": "#fff",
                },
                "metadata": {
                    "appId": "kaira-bot",
                    "reportKind": "single_run",
                    "runId": "run-1",
                    "runName": "smoke",
                    "evalType": "batch",
                    "createdAt": "2026-05-01T00:00:00Z",
                    "computedAt": "2026-05-01T00:00:00Z",
                    "llmProvider": None,
                    "llmModel": None,
                    "narrativeModel": None,
                    "cacheKey": None,
                },
                "blocks": [],
            },
        }
        payload = PlatformRunReportPayload.model_validate(legacy_v1)
        # New defaulted fields appear on output without breaking input.
        self.assertEqual(payload.data_quality.overall, "complete")
        self.assertEqual(payload.data_quality.missing_inputs, [])
        self.assertEqual(payload.data_quality.section_status, {})
        self.assertIsNone(payload.metadata.narrative_status)
        self.assertIsNone(payload.metadata.narrative_error)

    def test_payload_with_explicit_data_quality_round_trips(self):
        v1_with_dq = {
            "schemaVersion": "v1",
            "metadata": {
                "appId": "inside-sales",
                "reportKind": "single_run",
                "runId": "run-1",
                "evalType": "batch",
                "createdAt": "2026-05-01T00:00:00Z",
                "computedAt": "2026-05-01T00:00:00Z",
                "narrativeStatus": "skipped_no_model",
            },
            "sections": [],
            "exportDocument": {
                "schemaVersion": "v1",
                "title": "x",
                "theme": {
                    "accent": "#000", "accentMuted": "#fff", "border": "#ccc",
                    "textPrimary": "#000", "textSecondary": "#444", "background": "#fff",
                },
                "metadata": {
                    "appId": "inside-sales", "reportKind": "single_run", "runId": "run-1",
                    "evalType": "batch", "createdAt": "2026-05-01T00:00:00Z",
                    "computedAt": "2026-05-01T00:00:00Z",
                },
                "blocks": [],
            },
            "dataQuality": {
                "overall": "degraded",
                "missingInputs": ["evaluator_id"],
                "sectionStatus": {"compliance-matrix": "empty"},
            },
        }
        payload = PlatformRunReportPayload.model_validate(v1_with_dq)
        self.assertEqual(payload.metadata.narrative_status, "skipped_no_model")
        self.assertEqual(payload.data_quality.overall, "degraded")
        self.assertEqual(payload.data_quality.missing_inputs, ["evaluator_id"])
        self.assertEqual(payload.data_quality.section_status, {"compliance-matrix": "empty"})

        # Output uses camelCase
        dumped = payload.model_dump(by_alias=True)
        self.assertIn("dataQuality", dumped)
        self.assertEqual(dumped["dataQuality"]["overall"], "degraded")
        self.assertEqual(dumped["metadata"]["narrativeStatus"], "skipped_no_model")


class FixtureSnapshotTests(unittest.TestCase):
    """Ensure existing fixture JSON files (legacy shape) still parse against
    their *current* contract — this is the regression gate for any contract
    change. The contracts these fixtures target are legacy ReportPayload /
    InsideSalesReportPayload, not the v1 PlatformRunReportPayload, so this
    test simply re-runs the existing assertions to confirm nothing broke."""

    def test_legacy_fixtures_load(self):
        from app.services.reports.inside_sales_schemas import InsideSalesReportPayload
        from app.services.reports.schemas import ReportPayload

        ReportPayload.model_validate(
            json.loads((FIXTURES_DIR / "kaira-standard-run.json").read_text())
        )
        ReportPayload.model_validate(
            json.loads((FIXTURES_DIR / "kaira-adversarial-run.json").read_text())
        )
        InsideSalesReportPayload.model_validate(
            json.loads((FIXTURES_DIR / "inside-sales-run.json").read_text())
        )


class DataQualityReportShapeTests(unittest.TestCase):
    def test_default_factory_yields_complete_no_inputs_no_sections(self):
        dq = DataQualityReport()
        self.assertEqual(dq.overall, "complete")
        self.assertEqual(dq.missing_inputs, [])
        self.assertEqual(dq.section_status, {})


if __name__ == "__main__":
    unittest.main()
