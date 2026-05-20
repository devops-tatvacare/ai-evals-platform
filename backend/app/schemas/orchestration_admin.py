"""API shapes for the orchestration administration surface (Phase 2+).

Currently scoped to communication-cap policy management. Future Phase 3/4
admin surfaces (e.g. retry policy, escalation policy) extend this module.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import CamelModel, CamelORMModel


class CommCapPolicyRead(CamelORMModel):
    id: UUID
    tenant_id: UUID
    app_id: str
    max_count: int
    window_seconds: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    updated_by_user_id: UUID | None = None


class CommCapPolicyWrite(CamelModel):
    tenant_id: UUID
    app_id: str
    max_count: int = Field(gt=0)
    window_seconds: int = Field(gt=0)
    is_active: bool = True
