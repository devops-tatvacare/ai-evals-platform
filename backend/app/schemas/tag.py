"""Tag request/response schemas."""
from typing import Optional
from datetime import datetime
from app.schemas.base import CamelModel, CamelORMModel


class TagCreate(CamelModel):
    app_id: str
    name: str
    count: int = 0


class TagUpdate(CamelModel):
    count: Optional[int] = None
    last_used: Optional[datetime] = None


class TagResponse(CamelORMModel):
    id: int
    app_id: str
    name: str
    count: int
    last_used: datetime
    user_id: str = "default"
