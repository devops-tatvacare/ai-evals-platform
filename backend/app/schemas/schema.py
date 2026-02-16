"""Schema request/response schemas."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SchemaCreate(BaseModel):
    app_id: str
    prompt_type: str
    name: str
    schema_data: dict
    description: str = ""
    is_default: bool = False


class SchemaUpdate(BaseModel):
    name: Optional[str] = None
    schema_data: Optional[dict] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None


class SchemaResponse(BaseModel):
    id: int
    app_id: str
    prompt_type: str
    version: int
    name: str
    schema_data: dict
    description: str
    is_default: bool
    created_at: datetime
    updated_at: datetime
    user_id: str = "default"

    model_config = {"from_attributes": True}
