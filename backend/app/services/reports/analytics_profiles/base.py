"""Internal analytics profile definitions.

Profiles are backend-only. App config exposes only the profile key.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.app_analytics_config import AppAnalyticsConfig
from app.schemas.base import CamelModel


class CrossRunAdapter:
    analytics_model: type[CamelModel]

    def aggregate(
        self,
        runs_data: list[tuple[dict, dict]],
        all_runs_count: int,
        analytics_config: AppAnalyticsConfig | None = None,
        app_id: str | None = None,
    ) -> CamelModel:
        raise NotImplementedError

    def load_cached(self, payload: dict) -> CamelModel:
        return self.analytics_model.model_validate(payload)


@dataclass(frozen=True)
class AnalyticsProfile:
    key: str
    report_service_cls: type | None = None
    report_payload_model: type[CamelModel] | None = None
    cross_run_adapter: CrossRunAdapter | None = None
    cross_run_summary_narrator_cls: type | None = None
    cross_run_summary_model: type[CamelModel] | None = None
