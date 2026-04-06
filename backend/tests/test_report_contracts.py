"""Canonical reporting contract coverage and phase-1 fixtures."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.models.evaluation_analytics import EvaluationAnalytics
from app.services.reports.contracts.cross_run_report import PlatformCrossRunPayload
from app.services.reports.contracts.print_document import PlatformReportDocument
from app.services.reports.contracts.run_report import PlatformRunReportPayload
from app.services.reports.inside_sales_schemas import InsideSalesReportPayload
from app.services.reports.schemas import ReportPayload


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "reports"


def _load_json(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text())


def test_phase_one_legacy_run_fixtures_are_checked_in():
    assert (FIXTURES_DIR / "kaira-standard-run.json").exists()
    assert (FIXTURES_DIR / "kaira-adversarial-run.json").exists()
    assert (FIXTURES_DIR / "inside-sales-run.json").exists()
    assert (FIXTURES_DIR / "kaira-cross-run.json").exists()
    assert (FIXTURES_DIR / "inside-sales-cross-run.json").exists()


def test_phase_one_legacy_payload_fixtures_match_current_run_contracts():
    ReportPayload.model_validate(_load_json("kaira-standard-run.json"))
    ReportPayload.model_validate(_load_json("kaira-adversarial-run.json"))
    InsideSalesReportPayload.model_validate(_load_json("inside-sales-run.json"))


def test_run_report_contract_supports_discriminated_sections_and_print_document():
    payload = PlatformRunReportPayload.model_validate({
        "schemaVersion": "v1",
        "metadata": {
            "appId": "kaira-bot",
            "reportId": "default-single-run",
            "reportName": "Default Single Run",
            "reportRunId": "report-run-123",
            "runId": "run-123",
            "runName": "Nightly Kaira Batch",
            "evalType": "batch_thread",
            "createdAt": "2026-04-01T10:00:00+00:00",
            "computedAt": "2026-04-01T10:05:00+00:00",
            "cacheKey": "single_run:kaira-bot:run-123:v1",
        },
        "presentation": {
            "density": "default",
            "designTokens": {"contentMaxWidth": 980},
            "themeTokens": {"accent": "#0f766e"},
        },
        "sections": [
            {
                "id": "summary",
                "type": "summary_cards",
                "title": "Summary",
                "variant": "overview",
                "data": [{"key": "health", "label": "Health", "value": "82", "tone": "positive"}],
            },
            {
                "id": "narrative",
                "type": "narrative",
                "title": "Narrative",
                "variant": "executive_summary",
                "data": {
                    "schemaVersion": "v1",
                    "schemaKey": "platform_run_narrative_v1",
                    "schemaOwner": "backend",
                    "executiveSummary": "Quality is stable with a few recurring compliance issues.",
                    "issues": [{"title": "Intent slips", "area": "Intent", "severity": "high", "summary": "Intent routing degraded on pricing questions."}],
                    "recommendations": [{"priority": "P1", "area": "Intent", "action": "Tighten routing examples", "rationale": "Reduce wrong-intent fallback."}],
                    "exemplars": [{"itemId": "thread-1", "label": "Example", "analysis": "Good recovery after clarification."}],
                    "promptGaps": [{"gapType": "UNDERSPEC", "promptSection": "Escalation", "evaluationRule": "rule-1", "suggestedFix": "Add escalation thresholds."}],
                },
            },
        ],
        "exportDocument": {
            "schemaVersion": "v1",
            "title": "Nightly Kaira Batch",
            "subtitle": "Single-run report",
            "theme": {
                "accent": "#0f766e",
                "accentMuted": "#99f6e4",
                "border": "#d1d5db",
                "textPrimary": "#0f172a",
                "textSecondary": "#475569",
                "background": "#ffffff",
            },
            "blocks": [
                {"id": "cover", "type": "cover", "title": "Nightly Kaira Batch", "subtitle": "Single-run report", "metadata": {"App": "Kaira Bot"}},
                {"id": "summary-grid", "type": "stat_grid", "title": "Summary", "items": [{"label": "Health", "value": "82", "tone": "positive"}]},
            ],
        },
    })

    assert payload.schema_version == "v1"
    assert payload.metadata.report_run_id == "report-run-123"
    assert payload.presentation.theme_tokens["accent"] == "#0f766e"
    assert payload.sections[0].type == "summary_cards"
    assert payload.export_document.blocks[0].type == "cover"


def test_cross_run_contract_supports_heatmaps_and_optional_export_document():
    payload = PlatformCrossRunPayload.model_validate({
        "schemaVersion": "v1",
        "metadata": {
            "appId": "inside-sales",
            "computedAt": "2026-04-01T12:00:00+00:00",
            "sourceRunCount": 3,
            "totalRunsAvailable": 5,
            "cacheKey": "cross_run:inside-sales:v1",
        },
        "sections": [
            {
                "id": "cross-summary",
                "type": "summary_cards",
                "title": "Cross-run summary",
                "variant": "overview",
                "data": [{"key": "runs", "label": "Runs analyzed", "value": "3", "tone": "neutral"}],
            },
            {
                "id": "cross-heatmap",
                "type": "heatmap",
                "title": "Compliance Heatmap",
                "variant": "compliance",
                "data": {
                    "columns": ["Run 1", "Run 2"],
                    "rows": [{"key": "disclosure", "label": "Disclosure", "cells": [{"label": "Run 1", "value": 0.9, "tone": "positive"}]}],
                },
            },
        ],
    })

    assert payload.schema_version == "v1"
    assert payload.sections[1].type == "heatmap"
    assert payload.export_document is None


def test_print_document_contract_accepts_supported_block_types():
    document = PlatformReportDocument.model_validate({
        "schemaVersion": "v1",
        "title": "Report",
        "theme": {
            "accent": "#1d4ed8",
            "accentMuted": "#dbeafe",
            "border": "#cbd5e1",
            "textPrimary": "#0f172a",
            "textSecondary": "#475569",
            "background": "#ffffff",
        },
        "blocks": [
            {"id": "cover", "type": "cover", "title": "Report", "subtitle": "PDF", "metadata": {}},
            {"id": "prose", "type": "prose", "title": "Summary", "body": "Narrative body"},
            {"id": "break", "type": "page_break", "title": "Page Break"},
        ],
    })

    assert [block.type for block in document.blocks] == ["cover", "prose", "page_break"]


def test_evaluation_analytics_exposes_phase_three_cache_constants():
    assert EvaluationAnalytics.CACHE_SCHEMA_VERSION == "v1"
    assert EvaluationAnalytics.CACHE_KIND_RUN_REPORT == "single_run"
    assert EvaluationAnalytics.CACHE_KIND_CROSS_RUN == "cross_run"
