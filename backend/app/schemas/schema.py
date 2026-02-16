"""Schema request/response schemas."""
from typing import Optional
from datetime import datetime
from app.schemas.base import CamelModel, CamelORMModel


class SchemaCreate(CamelModel):
    app_id: str
    prompt_type: str
    name: str
    schema_data: dict
    description: str = ""
    is_default: bool = False


class SchemaUpdate(CamelModel):
    name: Optional[str] = None
    schema_data: Optional[dict] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None


class SchemaResponse(CamelORMModel):
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
