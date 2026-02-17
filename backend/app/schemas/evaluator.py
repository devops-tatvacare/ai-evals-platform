"""Evaluator request/response schemas."""
import uuid
from typing import Optional
from datetime import datetime
from pydantic import field_validator
from app.schemas.base import CamelModel, CamelORMModel


class EvaluatorCreate(CamelModel):
    app_id: str
    listing_id: Optional[str] = None
    name: str
    prompt: str
    model_id: Optional[str] = None
    output_schema: list = []
    is_global: bool = False
    show_in_header: bool = False
    forked_from: Optional[str] = None


class EvaluatorUpdate(CamelModel):
    listing_id: Optional[str] = None
    name: Optional[str] = None
    prompt: Optional[str] = None
    model_id: Optional[str] = None
    output_schema: Optional[list] = None
    is_global: Optional[bool] = None
    show_in_header: Optional[bool] = None
    forked_from: Optional[str] = None


class EvaluatorSetGlobal(CamelModel):
    is_global: bool


class EvaluatorResponse(CamelORMModel):
    id: uuid.UUID
    app_id: str
    listing_id: Optional[str] = None
    name: str
    prompt: str
    model_id: Optional[str] = None
    output_schema: list = []
    is_global: bool
    show_in_header: bool
    forked_from: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    user_id: str = "default"

    @field_validator('listing_id', 'forked_from', mode='before')
    @classmethod
    def uuid_to_str(cls, v):
        return str(v) if v is not None else None

    @field_validator('output_schema', mode='before')
    @classmethod
    def none_to_list(cls, v):
        return v if v is not None else []
