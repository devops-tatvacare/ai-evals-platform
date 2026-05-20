"""Canonical single-run report contract."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.schemas.base import CamelModel
from app.services.reports.config_models import PresentationSectionConfig
from app.services.reports.contracts.data_quality import DataQualityReport
from app.services.reports.contracts.print_document import PlatformReportDocument
from app.services.reports.contracts.report_sections import PlatformReportSection


# Phase 2 — narrative_status taxonomy. ``failed`` is reserved: the generic
# execute_narrative_generation raises on failure today and that surfaces as a
# job failure, not a completed-with-failed-narrative artifact. The literal
# exists so a future change can persist a partial artifact without revising
# the contract.
NarrativeStatus = Literal["disabled", "skipped_no_model", "completed", "failed"]


class PlatformReportMetadata(CamelModel):
    app_id: str
    report_kind: Literal["single_run"] = "single_run"
    report_id: str | None = None
    report_name: str | None = None
    report_run_id: str | None = None
    run_id: str
    run_name: str | None = None
    eval_type: str
    created_at: str
    computed_at: str
    source_run_count: int = 1
    llm_provider: str | None = None
    llm_model: str | None = None
    narrative_model: str | None = None
    narrative_status: NarrativeStatus | None = None
    narrative_error: str | None = None  # populated only when narrative_status='failed'
    cache_key: str | None = None


class PlatformReportPresentation(CamelModel):
    renderer_id: str = 'platform-default'
    layout_groups: list[dict[str, Any]] = Field(default_factory=list)
    density: str = "default"
    design_tokens: dict[str, Any] = Field(default_factory=dict)
    theme_tokens: dict[str, Any] = Field(default_factory=dict)
    sections: list[PresentationSectionConfig] = Field(default_factory=list)


class PlatformRunReportPayload(CamelModel):
    schema_version: Literal["v1"] = "v1"
    metadata: PlatformReportMetadata
    presentation: PlatformReportPresentation = Field(default_factory=PlatformReportPresentation)
    sections: list[PlatformReportSection]
    export_document: PlatformReportDocument
    # Defaulted so cache_validation.py:16 round-trips existing cached artifacts
    # without 409ing on deploy. Services populate ``missing_inputs``; the
    # finalizer in data_quality_finalizer.py owns ``section_status`` + ``overall``.
    data_quality: DataQualityReport = Field(default_factory=DataQualityReport)
