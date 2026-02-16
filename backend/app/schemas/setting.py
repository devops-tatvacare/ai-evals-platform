"""Setting request/response schemas."""
from typing import Optional
from datetime import datetime
from app.schemas.base import CamelModel, CamelORMModel


class SettingCreate(CamelModel):
    app_id: Optional[str] = None
    key: str
    value: dict = {}


class SettingUpdate(CamelModel):
    value: Optional[dict] = None


class SettingResponse(CamelORMModel):
    id: int
    app_id: Optional[str] = None
    key: str
    value: dict
    updated_at: datetime
    user_id: str = "default"
