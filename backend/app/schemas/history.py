"""History request/response schemas."""
import uuid
from typing import Optional
from app.schemas.base import CamelModel, CamelORMModel


class HistoryCreate(CamelModel):
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


class HistoryUpdate(CamelModel):
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


class HistoryResponse(CamelORMModel):
    id: uuid.UUID
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


class HistoryPageResponse(CamelModel):
    entries: list[HistoryResponse]
    total_count: int
    has_more: bool
    page: int
