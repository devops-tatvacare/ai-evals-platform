"""Reporting persistence contract tests for phases 2-3."""

from app.models.analytics_chart import AnalyticsChart
from app.models.analytics_dashboard import AnalyticsDashboard
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.eval_run import EvaluationRun
from app.models.mixins.shareable import Visibility
from app.models.report_artifact import ReportArtifact
from app.models.report_config import ReportConfig
from app.models.report_run import ReportRun
from app.services.seed_defaults import _build_default_report_config_seeds


def test_report_config_and_run_models_expose_phase_two_columns():
    report_config_columns = ReportConfig.__table__.columns.keys()
    report_run_columns = ReportRun.__table__.columns.keys()

    assert "source_session_id" in report_config_columns
    assert "visibility" in report_config_columns
    assert "shared_by" in report_config_columns
    assert "shared_at" in report_config_columns
    assert "default_report_run_visibility" in report_config_columns
    assert "presentation_config" in report_config_columns
    assert "narrative_config" in report_config_columns
    assert "export_config" in report_config_columns

    assert "visibility" in report_run_columns
    assert "shared_by" in report_run_columns
    assert "shared_at" in report_run_columns
    assert "job_id" in report_run_columns
    assert "llm_provider" in report_run_columns
    assert "llm_model" in report_run_columns
    assert "report_config_version" in report_run_columns
    assert "prompt_asset_version" in report_run_columns
    assert "schema_asset_version" in report_run_columns


def test_report_artifact_inherits_visibility_from_report_run():
    report_artifact_columns = ReportArtifact.__table__.columns.keys()

    assert "report_run_id" in report_artifact_columns
    assert "artifact_data" in report_artifact_columns
    assert "visibility" not in report_artifact_columns


def test_analytics_library_models_expose_source_session_lineage():
    chart_columns = AnalyticsChart.__table__.columns.keys()
    dashboard_columns = AnalyticsDashboard.__table__.columns.keys()

    assert "source_session_id" in chart_columns
    assert "source_session_id" in dashboard_columns


def test_eval_run_model_exposes_normalized_visibility_columns():
    eval_run_columns = EvaluationRun.__table__.columns.keys()

    assert "visibility" in eval_run_columns
    assert "shared_by" in eval_run_columns
    assert "shared_at" in eval_run_columns


def test_default_report_config_seeds_are_system_owned_and_generic():
    seeds = _build_default_report_config_seeds()

    assert len(seeds) == 6
    assert {(seed["app_id"], seed["scope"]) for seed in seeds} == {
        ("voice-rx", "single_run"),
        ("voice-rx", "cross_run"),
        ("kaira-bot", "single_run"),
        ("kaira-bot", "cross_run"),
        ("inside-sales", "single_run"),
        ("inside-sales", "cross_run"),
    }
    assert all(seed["tenant_id"] == SYSTEM_TENANT_ID for seed in seeds)
    assert all(seed["user_id"] == SYSTEM_USER_ID for seed in seeds)
    assert all(seed["visibility"] == Visibility.SHARED for seed in seeds)
    assert all(seed["is_default"] is True for seed in seeds)
    assert all(seed["default_report_run_visibility"] == Visibility.PRIVATE for seed in seeds)
    assert all("presentation_config" in seed for seed in seeds)
    assert all("narrative_config" in seed for seed in seeds)
    assert all("export_config" in seed for seed in seeds)
