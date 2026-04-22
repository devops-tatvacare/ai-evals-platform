"""Pydantic schemas for /api/scheduled-jobs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field, field_validator

from app.schemas.base import CamelModel, CamelORMModel


VALID_ON_EXHAUST: frozenset[str] = frozenset({"wait_next_tick"})


class ScheduleOverride(CamelModel):
    """Override JSON validated on write; all fields optional."""

    skip_criteria: list[dict[str, Any]] = Field(default_factory=list)
    retry_count: int = Field(default=0, ge=0, le=20)
    retry_interval_minutes: int = Field(default=15, ge=1, le=24 * 60)
    on_exhaust: Literal["wait_next_tick"] = "wait_next_tick"

    @field_validator("skip_criteria")
    @classmethod
    def _validate_skip_criteria(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for entry in value:
            if not isinstance(entry, dict):
                raise ValueError("skip_criteria entries must be objects")
            if not entry.get("type"):
                raise ValueError("skip_criteria entry missing 'type'")
        return value


class ScheduledJobBase(CamelModel):
    app_id: str = Field(..., min_length=1, max_length=64)
    job_type: str = Field(..., min_length=1, max_length=64)
    schedule_key: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    cron: str = Field(..., min_length=1, max_length=64)
    params: dict[str, Any] = Field(default_factory=dict)
    override: ScheduleOverride = Field(default_factory=ScheduleOverride)
    enabled: bool = True


class ScheduledJobCreate(ScheduledJobBase):
    pass


class ScheduledJobUpdate(CamelModel):
    """Partial update. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    cron: str | None = Field(default=None, min_length=1, max_length=64)
    params: dict[str, Any] | None = None
    override: ScheduleOverride | None = None
    enabled: bool | None = None


class ScheduledJobRow(CamelORMModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    app_id: str
    job_type: str
    schedule_key: str
    name: str
    description: str | None = None
    cron: str
    params: dict[str, Any]
    override: ScheduleOverride
    enabled: bool
    next_check_at: datetime | None = None
    current_cycle_started_at: datetime | None = None
    current_cycle_attempts: int
    last_fire_at: datetime | None = None
    last_fire_job_id: uuid.UUID | None = None
    last_skip_reason: str | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class ScheduledJobFireSummary(CamelModel):
    """Job row summary for the schedule detail view's "last 50 fires" list."""

    id: uuid.UUID
    job_type: str
    status: str
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None


class ScheduledJobDetailResponse(CamelModel):
    schedule: ScheduledJobRow
    recent_fires: list[ScheduledJobFireSummary]


class RegisteredPredicateEntry(CamelModel):
    id: str
    label: str
    description: str
    default_scope: str | None = None
    supported_scopes: list[str] = Field(default_factory=list)


class RegisteredWorkloadEntry(CamelModel):
    app_id: str
    job_type: str
    label: str
    description: str
    launch_source: Literal["canonical_run", "canonical_config", "explicit_params"]
    source_list_endpoint: str | None = None
    default_params: dict[str, Any] = Field(default_factory=dict)


class ScheduledJobsRegistryResponse(CamelModel):
    predicates: list[RegisteredPredicateEntry]
    workloads: list[RegisteredWorkloadEntry]
    apps: list[str]
    on_exhaust_modes: list[str] = Field(default_factory=lambda: sorted(VALID_ON_EXHAUST))
