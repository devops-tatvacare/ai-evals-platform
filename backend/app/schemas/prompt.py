"""Prompt request/response schemas."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class PromptCreate(BaseModel):
    app_id: str
    prompt_type: str
    name: str
    prompt: str
    description: str = ""
    is_default: bool = False
    source_type: Optional[str] = None


class PromptUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None
    source_type: Optional[str] = None


class PromptResponse(BaseModel):
    id: int
    app_id: str
    prompt_type: str
    version: int
    name: str
    prompt: str
    description: str
    is_default: bool
    source_type: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    user_id: str = "default"

    model_config = {"from_attributes": True}
