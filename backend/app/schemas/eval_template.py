"""EvaluationTemplate request/response schemas."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import field_validator

from app.models.mixins.shareable import Visibility
from app.schemas.base import CamelModel, CamelORMModel
from app.schemas.visibility import VisibilityInputMixin, VisibilityOutputMixin


class EvalTemplateCreate(VisibilityInputMixin, CamelModel):
    app_id: str
    template_type: str
    source_type: Optional[str] = None
    name: str
    prompt: str
    schema_data: dict | list = {}
    schema_format: str = "output_fields"
    description: Optional[str] = None
    is_default: bool = False
    visibility: Visibility = Visibility.PRIVATE
    forked_from: Optional[str] = None


class EvalTemplateNewVersion(CamelModel):
    """Create a new version of an existing branch."""
    prompt: str
    schema_data: dict | list
    schema_format: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None


class EvalTemplateUpdate(CamelModel):
    """Metadata-only update (no new version)."""
    name: Optional[str] = None
    description: Optional[str] = None


class EvalTemplateResponse(VisibilityOutputMixin, CamelORMModel):
    id: uuid.UUID
    app_id: str
    template_type: str
    source_type: Optional[str] = None
    branch_key: str
    version: int
    name: str
    description: Optional[str] = None
    prompt: str
    schema_data: dict | list
    schema_format: str
    variables_used: list
    change_summary: Optional[str] = None
    is_default: bool
    forked_from: Optional[str] = None
    visibility: Visibility
    shared_by: Optional[uuid.UUID] = None
    shared_at: Optional[datetime] = None
    owner_name: Optional[str] = None
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    @field_validator('forked_from', mode='before')
    @classmethod
    def uuid_to_str(cls, v):
        return str(v) if v is not None else None
