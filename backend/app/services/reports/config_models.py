"""Typed report config helpers for generic report composition."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.schemas.app_analytics_config import AnalyticsExportConfig
from app.schemas.base import CamelModel


class PresentationSectionConfig(CamelModel):
    section_id: str
    component_id: str
    title: str | None = None
    description: str | None = None
    variant: str = 'default'
    printable: bool = True


class PresentationConfig(CamelModel):
    renderer_id: str = 'platform-default'
    layout_groups: list[dict[str, Any]] = Field(default_factory=list)
    density: str = 'default'
    design_tokens: dict[str, Any] = Field(default_factory=dict)
    theme_tokens: dict[str, Any] = Field(default_factory=dict)
    sections: list[PresentationSectionConfig] = Field(default_factory=list)


class NarrativeInputSelection(CamelModel):
    section_ids: list[str] = Field(default_factory=list)


class NarrativeAssetKeys(CamelModel):
    prompt_references_key: str | None = None
    system_prompt_key: str | None = None
    glossary_key: str | None = None


class NarrativeConfig(CamelModel):
    enabled: bool = False
    schema_key: str | None = None
    input_selection: NarrativeInputSelection = Field(default_factory=NarrativeInputSelection)
    output_insertion_points: list[str] = Field(default_factory=list)
    asset_keys: NarrativeAssetKeys = Field(default_factory=NarrativeAssetKeys)
    provider_policy: dict[str, Any] = Field(default_factory=dict)


ExportConfig = AnalyticsExportConfig
