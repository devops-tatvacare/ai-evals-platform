"""Kaira reporting analytics profile."""

from __future__ import annotations

from app.schemas.app_analytics_config import AppAnalyticsConfig
from app.services.reports.analytics_profiles.base import AnalyticsProfile, CrossRunAdapter
from app.services.reports.canonical_adapters import adapt_kaira_cross_run_from_runs
from app.services.reports.contracts.cross_run_report import PlatformCrossRunPayload
from app.services.reports.contracts.run_report import PlatformRunReportPayload
from app.services.reports.cross_run_aggregator import CrossRunAISummary
from app.services.reports.cross_run_narrator import CrossRunNarrator
from app.services.reports.report_service import ReportService


class KairaCrossRunAdapter(CrossRunAdapter):
    analytics_model = PlatformCrossRunPayload

    def aggregate(
        self,
        runs_data: list[tuple[dict, dict]],
        all_runs_count: int,
        analytics_config: AppAnalyticsConfig | None = None,
        app_id: str | None = None,
    ) -> PlatformCrossRunPayload:
        if analytics_config is None or app_id is None:
            raise ValueError('analytics_config and app_id are required for canonical aggregation')
        return adapt_kaira_cross_run_from_runs(
            runs_data,
            analytics_config,
            app_id=app_id,
            total_runs_available=all_runs_count,
        )


KAIRA_ANALYTICS_PROFILE = AnalyticsProfile(
    key="kaira_v1",
    report_service_cls=ReportService,
    report_payload_model=PlatformRunReportPayload,
    cross_run_adapter=KairaCrossRunAdapter(),
    cross_run_summary_narrator_cls=CrossRunNarrator,
    cross_run_summary_model=CrossRunAISummary,
)
