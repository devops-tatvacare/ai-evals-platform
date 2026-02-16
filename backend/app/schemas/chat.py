"""Chat request/response schemas."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SessionCreate(BaseModel):
    app_id: str
    external_user_id: Optional[str] = None
    thread_id: Optional[str] = None
    server_session_id: Optional[str] = None
    last_response_id: Optional[str] = None
    title: str = "New Chat"
    status: str = "active"
    is_first_message: bool = True


class SessionUpdate(BaseModel):
    external_user_id: Optional[str] = None
    thread_id: Optional[str] = None
    server_session_id: Optional[str] = None
    last_response_id: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    is_first_message: Optional[bool] = None


class SessionResponse(BaseModel):
    id: str
    app_id: str
    external_user_id: Optional[str] = None
    thread_id: Optional[str] = None
    server_session_id: Optional[str] = None
    last_response_id: Optional[str] = None
    title: str
    status: str
    is_first_message: bool
    created_at: datetime
    updated_at: datetime
    user_id: str = "default"

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    session_id: str
    role: str
    content: str = ""
    metadata_: Optional[dict] = None
    status: str = "complete"
    error_message: Optional[str] = None


class MessageUpdate(BaseModel):
    role: Optional[str] = None
    content: Optional[str] = None
    metadata_: Optional[dict] = None
    status: Optional[str] = None
    error_message: Optional[str] = None


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    metadata_: Optional[dict] = None
    status: str
    error_message: Optional[str] = None
    created_at: str
    user_id: str = "default"

    model_config = {"from_attributes": True}
