"""Pydantic schemas for the Sherlock verified-queries admin route.

System-tenant rows (seeded from JSON) are visible read-only via the list
endpoint; only tenant-owned rows can be created/edited/disabled.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from app.schemas.base import CamelModel, CamelORMModel


VerifiedQuerySource = Literal['seed', 'admin', 'user_thumbs_up']


class VerifiedQueryRow(CamelORMModel):
    """List + detail row shape."""
    id: uuid.UUID
    tenant_id: uuid.UUID
    app_id: str
    question: str
    normalized_question: str
    sql: str
    source: str
    enabled: bool
    use_count: int
    last_used_at: Optional[datetime]
    verified_at: datetime
    verified_by: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime
    is_system: bool  # derived: tenant_id == SYSTEM_TENANT_ID


class VerifiedQueryListResponse(CamelModel):
    items: list[VerifiedQueryRow]
    total: int


class VerifiedQueryCreateRequest(CamelModel):
    app_id: str
    question: str
    sql: str
    enabled: bool = True


class VerifiedQueryUpdateRequest(CamelModel):
    question: Optional[str] = None
    sql: Optional[str] = None
    enabled: Optional[bool] = None
