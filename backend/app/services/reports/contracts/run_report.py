"""Canonical single-run report contract."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.schemas.base import CamelModel
from app.services.reports.contracts.print_document import PlatformReportDocument
from app.services.reports.contracts.report_sections import PlatformReportSection


class PlatformReportMetadata(CamelModel):
    app_id: str
    report_kind: Literal["single_run"] = "single_run"
    report_id: str | None = None
    report_name: str | None = None
    report_run_id: str | None = None
    report_visibility: Literal["private", "shared"] | None = None
    run_id: str
    run_name: str | None = None
    eval_type: str
    created_at: str
    computed_at: str
    source_run_count: int = 1
    llm_provider: str | None = None
    llm_model: str | None = None
    narrative_model: str | None = None
    cache_key: str | None = None


class PlatformReportPresentation(CamelModel):
    renderer_id: str = 'platform-default'
    layout_groups: list[dict[str, Any]] = Field(default_factory=list)
    density: str = "default"
    design_tokens: dict[str, Any] = Field(default_factory=dict)
    theme_tokens: dict[str, Any] = Field(default_factory=dict)


class PlatformRunReportPayload(CamelModel):
    schema_version: Literal["v1"] = "v1"
    metadata: PlatformReportMetadata
    presentation: PlatformReportPresentation = Field(default_factory=PlatformReportPresentation)
    sections: list[PlatformReportSection]
    export_document: PlatformReportDocument
