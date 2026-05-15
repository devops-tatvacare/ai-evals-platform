"""Schemas for /api/admin/ai-settings.

Responses NEVER carry the API key — only ``hasApiKey: bool``. Upserts treat
a blank ``apiKey`` as "preserve the stored secret".
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from app.schemas.base import CamelModel


SUPPORTED_PROVIDERS: tuple[str, ...] = (
    "openai",
    "azure_openai",
    "anthropic",
    "gemini",
)


class ProviderConfigResponse(CamelModel):
    provider: str
    is_enabled: bool
    has_api_key: bool
    base_url: Optional[str] = None
    extra_config: dict = Field(default_factory=dict)
    curated_models: list[str] = Field(default_factory=list)
    validation_status: str
    last_validated_at: Optional[datetime] = None


class ProviderConfigUpsert(CamelModel):
    is_enabled: bool
    api_key: str = ""
    base_url: Optional[str] = None
    extra_config: dict = Field(default_factory=dict)
    curated_models: list[str] = Field(default_factory=list)


class ModelSearchRequest(CamelModel):
    search: str = ""


class ModelSearchResponse(CamelModel):
    models: list[str] = Field(default_factory=list)


class ValidateResponse(CamelModel):
    validation_status: str
    detail: Optional[str] = None
