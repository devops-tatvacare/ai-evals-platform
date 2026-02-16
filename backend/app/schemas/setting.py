"""Setting request/response schemas."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SettingCreate(BaseModel):
    app_id: Optional[str] = None
    key: str
    value: dict = {}


class SettingUpdate(BaseModel):
    value: Optional[dict] = None


class SettingResponse(BaseModel):
    id: int
    app_id: Optional[str] = None
    key: str
    value: dict
    updated_at: datetime
    user_id: str = "default"

    model_config = {"from_attributes": True}
