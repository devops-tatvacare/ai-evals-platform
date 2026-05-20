"""API schemas for the typed Sherlock Part stream — admin trace + session replay."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from app.schemas.base import CamelModel


class SherlockPartRow(CamelModel):
    id: str
    seq: int
    type: str
    call_id: Optional[str] = None
    chat_session_id: str
    app_id: str
    user_id: str
    user_label: Optional[str] = None
    payload: dict[str, Any]
    created_at: datetime


class SherlockPartListResponse(CamelModel):
    items: list[SherlockPartRow] = []
    total: int = 0
    limit: int = 100
    offset: int = 0


class SherlockSessionPartsResponse(CamelModel):
    session_id: str
    last_event_seq: int
    parts: list[SherlockPartRow] = []
