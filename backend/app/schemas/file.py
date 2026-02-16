"""File request/response schemas."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class FileResponse(BaseModel):
    id: str
    original_name: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    storage_path: str
    created_at: datetime
    user_id: str = "default"

    model_config = {"from_attributes": True}
