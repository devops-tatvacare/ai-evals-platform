"""File request/response schemas."""
import uuid
from typing import Optional
from datetime import datetime
from app.schemas.base import CamelORMModel


class FileResponse(CamelORMModel):
    id: uuid.UUID
    original_name: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    storage_path: str
    created_at: datetime
    user_id: str = "default"
