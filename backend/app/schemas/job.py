"""Job request/response schemas."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class JobCreate(BaseModel):
    job_type: str
    params: dict = {}
    status: str = "queued"
    progress: dict = {"current": 0, "total": 0, "message": ""}


class JobUpdate(BaseModel):
    status: Optional[str] = None
    params: Optional[dict] = None
    result: Optional[dict] = None
    progress: Optional[dict] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class JobResponse(BaseModel):
    id: str
    job_type: str
    status: str
    params: dict
    result: Optional[dict] = None
    progress: dict
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    user_id: str = "default"

    model_config = {"from_attributes": True}
