"""Evaluator request/response schemas."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class EvaluatorCreate(BaseModel):
    app_id: str
    listing_id: Optional[str] = None
    name: str
    prompt: str
    model_id: Optional[str] = None
    output_schema: list = []
    is_global: bool = False
    show_in_header: bool = False
    forked_from: Optional[str] = None


class EvaluatorUpdate(BaseModel):
    listing_id: Optional[str] = None
    name: Optional[str] = None
    prompt: Optional[str] = None
    model_id: Optional[str] = None
    output_schema: Optional[list] = None
    is_global: Optional[bool] = None
    show_in_header: Optional[bool] = None
    forked_from: Optional[str] = None


class EvaluatorResponse(BaseModel):
    id: str
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

    model_config = {"from_attributes": True}
