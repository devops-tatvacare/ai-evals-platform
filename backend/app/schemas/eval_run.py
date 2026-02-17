"""Eval run request/response schemas."""
import uuid
from typing import Optional, Literal
from datetime import datetime
from app.schemas.base import CamelModel, CamelORMModel


EvalType = Literal["custom", "full_evaluation", "human", "batch_thread", "batch_adversarial"]


class EvalRunCreate(CamelModel):
    app_id: str
    eval_type: EvalType
    listing_id: Optional[uuid.UUID] = None
    session_id: Optional[uuid.UUID] = None
    evaluator_id: Optional[uuid.UUID] = None
    job_id: Optional[uuid.UUID] = None
    status: str = "pending"
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    config: dict = {}
    result: Optional[dict] = None
    summary: Optional[dict] = None
    batch_metadata: Optional[dict] = None


class EvalRunUpdate(CamelModel):
    status: Optional[str] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: Optional[float] = None
    result: Optional[dict] = None
    summary: Optional[dict] = None


class EvalRunResponse(CamelORMModel):
    id: uuid.UUID
    app_id: str
    eval_type: str
    listing_id: Optional[uuid.UUID] = None
    session_id: Optional[uuid.UUID] = None
    evaluator_id: Optional[uuid.UUID] = None
    job_id: Optional[uuid.UUID] = None
    status: str
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: Optional[float] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    config: dict = {}
    result: Optional[dict] = None
    summary: Optional[dict] = None
    batch_metadata: Optional[dict] = None
    created_at: datetime
    user_id: str = "default"


class EvalRunListResponse(CamelORMModel):
    """Lightweight response for list views (omits full result/config)."""
    id: uuid.UUID
    app_id: str
    eval_type: str
    listing_id: Optional[uuid.UUID] = None
    session_id: Optional[uuid.UUID] = None
    evaluator_id: Optional[uuid.UUID] = None
    job_id: Optional[uuid.UUID] = None
    status: str
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: Optional[float] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    summary: Optional[dict] = None
    batch_metadata: Optional[dict] = None
    created_at: datetime
    user_id: str = "default"
