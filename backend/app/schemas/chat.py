"""Chat request/response schemas."""
import uuid
from typing import Optional
from datetime import datetime
from pydantic import Field
from app.schemas.base import CamelModel, CamelORMModel


class SessionCreate(CamelModel):
    app_id: str
    external_user_id: Optional[str] = None
    thread_id: Optional[str] = None
    server_session_id: Optional[str] = None
    last_response_id: Optional[str] = None
    title: str = "New Chat"
    status: str = "active"
    is_first_message: bool = True


class SessionUpdate(CamelModel):
    external_user_id: Optional[str] = None
    thread_id: Optional[str] = None
    server_session_id: Optional[str] = None
    last_response_id: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    is_first_message: Optional[bool] = None
    evaluator_runs: Optional[list] = None


class SessionResponse(CamelORMModel):
    id: uuid.UUID
    app_id: str
    external_user_id: Optional[str] = None
    thread_id: Optional[str] = None
    server_session_id: Optional[str] = None
    last_response_id: Optional[str] = None
    title: str
    status: str
    is_first_message: bool
    evaluator_runs: list = []
    created_at: datetime
    updated_at: datetime
    user_id: str = "default"


class MessageCreate(CamelModel):
    session_id: str
    role: str
    content: str = ""
    metadata_: Optional[dict] = Field(None, alias="metadata")
    status: str = "complete"
    error_message: Optional[str] = None


class MessageUpdate(CamelModel):
    role: Optional[str] = None
    content: Optional[str] = None
    metadata_: Optional[dict] = Field(None, alias="metadata")
    status: Optional[str] = None
    error_message: Optional[str] = None


class MessageResponse(CamelORMModel):
    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    metadata_: Optional[dict] = Field(None, serialization_alias="metadata")
    status: str
    error_message: Optional[str] = None
    created_at: datetime
    user_id: str = "default"
