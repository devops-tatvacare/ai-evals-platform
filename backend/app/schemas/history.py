"""History request/response schemas."""
from pydantic import BaseModel
from typing import Optional


class HistoryCreate(BaseModel):
    app_id: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    source_type: str
    source_id: Optional[str] = None
    status: str
    duration_ms: Optional[float] = None
    data: Optional[dict] = None
    triggered_by: str = "manual"
    schema_version: Optional[str] = None
    user_context: Optional[dict] = None
    timestamp: int


class HistoryUpdate(BaseModel):
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    source_type: Optional[str] = None
    source_id: Optional[str] = None
    status: Optional[str] = None
    duration_ms: Optional[float] = None
    data: Optional[dict] = None
    triggered_by: Optional[str] = None
    schema_version: Optional[str] = None
    user_context: Optional[dict] = None
    timestamp: Optional[int] = None


class HistoryResponse(BaseModel):
    id: str
    app_id: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    source_type: str
    source_id: Optional[str] = None
    status: str
    duration_ms: Optional[float] = None
    data: Optional[dict] = None
    triggered_by: str
    schema_version: Optional[str] = None
    user_context: Optional[dict] = None
    timestamp: int
    user_id: str = "default"

    model_config = {"from_attributes": True}
