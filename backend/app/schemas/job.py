"""Job request/response schemas."""
import uuid
from typing import Optional
from datetime import datetime
from pydantic import model_validator
from app.schemas.base import CamelModel, CamelORMModel

# Keys stripped from job params in API responses to reduce payload size
_STRIPPED_PARAM_KEYS = {"csv_content"}


class JobCreate(CamelModel):
    job_type: str
    params: dict = {}
    status: str = "queued"
    progress: dict = {"current": 0, "total": 0, "message": ""}


class JobUpdate(CamelModel):
    status: Optional[str] = None
    params: Optional[dict] = None
    result: Optional[dict] = None
    progress: Optional[dict] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class JobResponse(CamelORMModel):
    id: uuid.UUID
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

    @model_validator(mode="after")
    def strip_large_params(self):
        """Remove large payload keys (e.g. csv_content) from params to reduce response size."""
        if self.params:
            self.params = {k: v for k, v in self.params.items() if k not in _STRIPPED_PARAM_KEYS}
        return self
