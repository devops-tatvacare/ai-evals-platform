"""Eval run request/response schemas."""
import uuid
from typing import Optional, Literal
from datetime import datetime
from app.models.mixins.shareable import Visibility
from app.schemas.base import CamelModel, CamelORMModel
from app.schemas.visibility import VisibilityInputMixin, VisibilityOutputMixin


EvalType = Literal["custom", "full_evaluation", "call_quality", "batch_thread", "batch_adversarial"]


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


class EvalRunVisibilityUpdate(VisibilityInputMixin, CamelModel):
    visibility: Visibility


class EvalRunResponse(VisibilityOutputMixin, CamelORMModel):
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
    visibility: Visibility
    shared_by: Optional[uuid.UUID] = None
    shared_at: Optional[datetime] = None
    latest_review_id: Optional[uuid.UUID] = None
    created_at: datetime
    tenant_id: uuid.UUID
    user_id: uuid.UUID


class EvalRunListResponse(VisibilityOutputMixin, CamelORMModel):
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
    visibility: Visibility
    shared_by: Optional[uuid.UUID] = None
    shared_at: Optional[datetime] = None
    latest_review_id: Optional[uuid.UUID] = None
    created_at: datetime
    tenant_id: uuid.UUID
    user_id: uuid.UUID
