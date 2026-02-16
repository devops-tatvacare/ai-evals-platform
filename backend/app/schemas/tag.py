"""Tag request/response schemas."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class TagCreate(BaseModel):
    app_id: str
    name: str
    count: int = 0


class TagUpdate(BaseModel):
    count: Optional[int] = None
    last_used: Optional[datetime] = None


class TagResponse(BaseModel):
    id: int
    app_id: str
    name: str
    count: int
    last_used: datetime
    user_id: str = "default"

    model_config = {"from_attributes": True}
