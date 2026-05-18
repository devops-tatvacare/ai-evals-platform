"""Pydantic request/response schemas for /api/orchestration/cohorts."""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import Field, field_validator

from app.models.mixins.shareable import Visibility
from app.schemas.base import CamelModel, CamelORMModel


_DATASET_PREFIX_RE = re.compile(r"^dataset\.")


def _reject_dataset_source_ref(value: Optional[str]) -> Optional[str]:
    """Saved cohorts must not reference dataset sources (D4)."""
    if value is not None and _DATASET_PREFIX_RE.match(value):
        raise ValueError(
            "source_ref must not start with 'dataset.' — use a Dataset node instead"
        )
    return value


class CohortVersionEditPayload(CamelModel):
    source_ref: str
    payload_fields: list[str] = Field(default_factory=list)
    filters: list[dict[str, Any]] = Field(default_factory=list)
    lookback_hours: Optional[int] = None
    lookback_column: Optional[str] = None
    consent_gate_channel: Optional[str] = None

    @field_validator("source_ref")
    @classmethod
    def _no_dataset_ref(cls, v: str) -> str:
        _reject_dataset_source_ref(v)
        return v


class CohortVersionResponse(CamelORMModel):
    id: uuid.UUID
    cohort_definition_id: uuid.UUID
    version: int
    source_ref: str
    filters: list[dict[str, Any]]
    payload_fields: list[str]
    lookback_hours: Optional[int]
    lookback_column: Optional[str]
    consent_gate_channel: Optional[str]
    status: str
    published_by: Optional[uuid.UUID]
    published_at: Optional[datetime]
    created_at: datetime


class CohortCreate(CamelModel):
    app_id: str
    slug: str
    name: str
    description: Optional[str] = None
    visibility: Visibility = Visibility.PRIVATE
    # The draft v1 predicate. A definition without at least one version is
    # not authorable, so creation always seeds v1.
    initial_version: CohortVersionEditPayload


class CohortUpdate(CamelModel):
    name: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[Visibility] = None
    active: Optional[bool] = None


class CohortResponse(CamelORMModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    app_id: str
    slug: str
    name: str
    description: Optional[str]
    active: bool
    visibility: Visibility
    shared_by: Optional[uuid.UUID] = None
    shared_at: Optional[datetime] = None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    current_published_version_id: Optional[uuid.UUID] = None
    # Inlined latest version for list rendering.
    latest_version: Optional[CohortVersionResponse] = None
    # Number of distinct workflows whose any version pins any version of this
    # cohort. Drives the "Used by N" badge on the cohorts list page.
    used_by_workflow_count: int = 0


class CohortDetailResponse(CohortResponse):
    versions: list[CohortVersionResponse] = Field(default_factory=list)


class WorkflowBindingResponse(CamelModel):
    workflow_id: uuid.UUID
    workflow_name: str
    workflow_version_id: uuid.UUID
    pinned_cohort_version_id: uuid.UUID
