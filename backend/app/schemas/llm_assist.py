"""Schemas for /api/llm/assist/* — server-side prompt/schema generation +
structured extraction.

Every request carries an explicit ``provider`` + ``model``. BYOK: no defaults.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from app.schemas.base import CamelModel


PromptType = Literal["transcription", "evaluation", "extraction"]


class GeneratePromptRequest(CamelModel):
    provider: str
    model: str
    prompt_type: PromptType
    user_idea: str


class GeneratePromptResponse(CamelModel):
    prompt: str


class GenerateSchemaRequest(CamelModel):
    provider: str
    model: str
    prompt_type: PromptType
    user_idea: str


class GenerateSchemaResponse(CamelModel):
    # Plan-literal field name (`schema`). Pydantic v2's `BaseModel.schema()`
    # is deprecated; CamelModel sets `protected_namespaces=()` so the field
    # name is accepted. Pyright still warns on the legacy method override.
    schema: dict = Field(default_factory=dict)  # pyright: ignore[reportIncompatibleMethodOverride]


class ExtractStructuredRequest(CamelModel):
    provider: str
    model: str
    prompt: str
    prompt_type: Literal["freeform", "schema"]
    input_source: Literal["transcript", "audio", "both"]
    transcript: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime_type: Optional[str] = None


class ExtractStructuredResponse(CamelModel):
    result: dict = Field(default_factory=dict)
    status: Literal["completed", "failed"]
    error: Optional[str] = None
