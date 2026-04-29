"""BackgroundJob request/response schemas."""
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
    # Phase 7: generic submission-surface metadata round-tripped verbatim.
    # Sherlock sets ``{surface, session_id, turn_id}`` via
    # ``submit_pack_job``; other surfaces MAY leave it ``None``.
    submission_context: Optional[dict] = None


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
    app_id: str
    job_type: str
    status: str
    priority: int
    queue_class: str
    attempt_count: int
    max_attempts: int
    params: dict
    submission_context: Optional[dict] = None
    result: Optional[dict] = None
    progress: dict
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    heartbeat_at: Optional[datetime] = None
    lease_expires_at: Optional[datetime] = None
    next_retry_at: Optional[datetime] = None
    dead_lettered_at: Optional[datetime] = None
    dead_letter_reason: Optional[str] = None
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    queue_position: Optional[int] = None
    idempotency_key: Optional[str] = None

    @model_validator(mode="after")
    def strip_large_params(self):
        """Remove large payload keys (e.g. csv_content) from params to reduce response size."""
        if self.params:
            self.params = {k: v for k, v in self.params.items() if k not in _STRIPPED_PARAM_KEYS}
        return self
